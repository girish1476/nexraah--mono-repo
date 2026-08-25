import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  CLIENT_DOCUMENT_LABEL,
  onboardingGate,
  requiredDocumentKinds,
  type ClientDocumentKind,
  type ClientStatus,
  type DocStatus,
} from './client-onboarding';

/**
 * Client onboarding — Compliance's side of a client record.
 *
 * Kept in its own service rather than added to `ClientsService` for two
 * reasons. It is a different job with a different owner: `ClientsService`
 * is Finance's commercial record, gated on `client.manage`, and this is
 * Compliance's clearance pipeline, gated on `client.onboard`. And another
 * session is actively editing that file, so a separate one is also the
 * neighbourly choice.
 */
@Injectable()
export class ClientOnboardingService {
  constructor(
    @Inject(DB) private readonly db: InternalDb,
    private readonly auditService: AuditService,
  ) {}

  private async loadClient(id: string) {
    const client = await this.db
      .selectFrom('clients')
      .select(['id', 'code', 'name', 'billing_city', 'gstin', 'engagement', 'status', 'rejection_reason'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  private async documentsFor(clientId: string) {
    return this.db
      .selectFrom('client_documents')
      .leftJoin('users', 'users.id', 'client_documents.verified_by')
      .select([
        'client_documents.id as id',
        'client_documents.kind as kind',
        'client_documents.status as status',
        'client_documents.reference as reference',
        'client_documents.attachment_id as attachmentId',
        'client_documents.valid_from as validFrom',
        'client_documents.valid_to as validTo',
        'client_documents.reject_reason as rejectReason',
        'client_documents.verified_at as verifiedAt',
        'users.name as verifiedByName',
      ])
      .where('client_documents.client_id', '=', clientId)
      .execute();
  }

  /**
   * The onboarding queue — every client not yet cleared.
   *
   * Ordered oldest first: a client who has been waiting three weeks for a
   * decision is a worse problem than one who arrived this morning, and a
   * queue sorted newest-first hides exactly that.
   */
  async queue() {
    const rows = await this.db
      .selectFrom('clients')
      .select(['id', 'code', 'name', 'billing_city as billingCity', 'engagement', 'status', 'created_at as createdAt'])
      .where('status', 'in', ['DRAFT', 'PENDING_VERIFICATION', 'REJECTED'])
      .orderBy('created_at', 'asc')
      .execute();

    // One query for every document rather than one per client.
    const docs =
      rows.length === 0
        ? []
        : await this.db
            .selectFrom('client_documents')
            .select(['client_id as clientId', 'kind', 'status'])
            .where(
              'client_id',
              'in',
              rows.map((r) => r.id),
            )
            .execute();

    const byClient = new Map<string, Map<ClientDocumentKind, DocStatus>>();
    for (const d of docs) {
      const m = byClient.get(d.clientId) ?? new Map();
      m.set(d.kind as ClientDocumentKind, d.status as DocStatus);
      byClient.set(d.clientId, m);
    }

    return rows.map((r) => {
      const gate = onboardingGate(r.engagement, byClient.get(r.id) ?? new Map());
      return {
        ...r,
        required: requiredDocumentKinds(r.engagement).length,
        cleared: gate.cleared.length,
        unmetCount: gate.unmet.length,
        canActivate: gate.canActivate,
      };
    });
  }

  /** One client's whole onboarding picture: papers, checklist, decision. */
  async detail(id: string) {
    const client = await this.loadClient(id);
    const documents = await this.documentsFor(id);

    const byKind = new Map<ClientDocumentKind, DocStatus>(
      documents.map((d) => [d.kind as ClientDocumentKind, d.status as DocStatus]),
    );
    const gate = onboardingGate(client.engagement, byKind);

    return {
      id: client.id,
      code: client.code,
      name: client.name,
      billingCity: client.billing_city,
      gstin: client.gstin,
      engagement: client.engagement,
      status: client.status as ClientStatus,
      rejectionReason: client.rejection_reason,
      // Every required kind, present or not — a checklist has to show the
      // gaps, so this is built from what is required rather than from what
      // happens to have been uploaded.
      documents: requiredDocumentKinds(client.engagement).map((kind) => {
        const existing = documents.find((d) => d.kind === kind);
        return {
          kind,
          label: CLIENT_DOCUMENT_LABEL[kind],
          status: existing?.status ?? 'MISSING',
          reference: existing?.reference ?? null,
          attachmentId: existing?.attachmentId ?? null,
          validFrom: existing?.validFrom ?? null,
          validTo: existing?.validTo ?? null,
          rejectReason: existing?.rejectReason ?? null,
          verifiedAt: existing?.verifiedAt ?? null,
          verifiedByName: existing?.verifiedByName ?? null,
        };
      }),
      gate,
    };
  }

  /** Record a paper against a client. Re-submitting replaces. */
  async submitDocument(
    clientId: string,
    dto: { kind: ClientDocumentKind; attachmentId?: string; reference?: string; validFrom?: string; validTo?: string },
    actor: AuthenticatedUser,
  ) {
    const client = await this.loadClient(clientId);
    if (!requiredDocumentKinds(client.engagement).includes(dto.kind)) {
      throw new BadRequestException(
        `${CLIENT_DOCUMENT_LABEL[dto.kind]} is not required for a ${client.engagement.toLowerCase()} client.`,
      );
    }

    await this.db
      .insertInto('client_documents')
      .values({
        client_id: clientId,
        kind: dto.kind,
        attachment_id: dto.attachmentId ?? null,
        reference: dto.reference ?? null,
        valid_from: dto.validFrom ?? null,
        valid_to: dto.validTo ?? null,
        status: 'PENDING',
      })
      .onConflict((oc) =>
        // Replacing resets the decision: a fresh paper has not been checked,
        // so it must not inherit the previous one's VERIFIED.
        oc.columns(['client_id', 'kind']).doUpdateSet({
          attachment_id: dto.attachmentId ?? null,
          reference: dto.reference ?? null,
          valid_from: dto.validFrom ?? null,
          valid_to: dto.validTo ?? null,
          status: 'PENDING',
          reject_reason: null,
          verified_by: null,
          verified_at: null,
          updated_at: new Date().toISOString(),
        }),
      )
      .execute();

    // A client sitting in DRAFT moves to the queue the moment somebody starts
    // producing papers — otherwise it would wait on an explicit "submit" step
    // that nobody would remember to press.
    if (client.status === 'DRAFT') {
      await this.setStatus(clientId, 'PENDING_VERIFICATION', null, actor);
    }

    await this.auditService.record(this.db, actor, {
      action: 'CLIENT_DOCUMENT_SUBMITTED',
      entityType: 'clients',
      entityId: clientId,
      after: { kind: dto.kind },
    });
    return this.detail(clientId);
  }

  async decideDocument(
    clientId: string,
    kind: ClientDocumentKind,
    decision: { status: 'VERIFIED' | 'REJECTED'; reason?: string },
    actor: AuthenticatedUser,
  ) {
    if (decision.status === 'REJECTED' && !decision.reason?.trim()) {
      throw new BadRequestException('Say why the document was rejected — the client has to be told what to fix.');
    }

    const existing = await this.db
      .selectFrom('client_documents')
      .select(['id', 'status'])
      .where('client_id', '=', clientId)
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (!existing) throw new NotFoundException('That document has not been uploaded yet');

    await this.db
      .updateTable('client_documents')
      .set({
        status: decision.status,
        reject_reason: decision.status === 'REJECTED' ? (decision.reason ?? null) : null,
        verified_by: actor.userId,
        verified_at: new Date(),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', existing.id)
      .execute();

    await this.auditService.record(this.db, actor, {
      action: decision.status === 'VERIFIED' ? 'CLIENT_DOCUMENT_VERIFIED' : 'CLIENT_DOCUMENT_REJECTED',
      entityType: 'clients',
      entityId: clientId,
      before: { kind, status: existing.status },
      after: { kind, status: decision.status, reason: decision.reason ?? null },
    });

    return this.detail(clientId);
  }

  /**
   * Clear the client. Refuses unless every required paper is verified.
   *
   * The refusal is the point: an activation that could be forced past its own
   * checklist would make the checklist decorative.
   */
  async activate(clientId: string, actor: AuthenticatedUser) {
    const detail = await this.detail(clientId);
    if (!detail.gate.canActivate) {
      throw new BadRequestException({
        code: 'ONBOARDING_INCOMPLETE',
        message: 'This client cannot be cleared yet — some papers are still outstanding.',
        details: { unmet: detail.gate.unmet },
      });
    }
    await this.setStatus(clientId, 'ACTIVE', null, actor);
    return this.detail(clientId);
  }

  async reject(clientId: string, reason: string, actor: AuthenticatedUser) {
    if (!reason?.trim()) {
      throw new BadRequestException('Say why the client was declined — it is recorded against them.');
    }
    await this.setStatus(clientId, 'REJECTED', reason.trim(), actor);
    return this.detail(clientId);
  }

  private async setStatus(
    clientId: string,
    status: ClientStatus,
    rejectionReason: string | null,
    actor: AuthenticatedUser,
  ) {
    const before = await this.loadClient(clientId);
    await this.db
      .updateTable('clients')
      .set({
        status,
        rejection_reason: rejectionReason,
        verified_by: status === 'ACTIVE' || status === 'REJECTED' ? actor.userId : null,
        verified_at: status === 'ACTIVE' || status === 'REJECTED' ? new Date() : null,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', clientId)
      .execute();

    await this.auditService.record(this.db, actor, {
      action: 'CLIENT_STATUS_CHANGED',
      entityType: 'clients',
      entityId: clientId,
      before: { status: before.status },
      after: { status, rejectionReason },
    });
  }
}
