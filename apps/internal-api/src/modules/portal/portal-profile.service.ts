import { Injectable } from '@nestjs/common';
import { parseGeo } from '../attachments/geo';
import { AuditService } from '../audit/audit.service';
import { portalError } from './portal.errors';
import {
  BUSINESS_DOCUMENT_KINDS,
  CAPTURE_KINDS,
  DOCUMENT_LABEL,
  GEOTAGGED_KINDS,
  IDENTITY_KINDS,
  PORTAL_ENDPOINT,
} from './portal.constants';
import { PortalProfileRepository } from './portal-profile.repository';
import { PortalAttachmentsRepository } from './portal-attachments.repository';
import { PortalIdentityRepository } from './portal-identity.repository';
import {
  PortalIdempotencyRepository,
  checkIdempotentReplay,
  runIdempotentWrite,
} from './portal-idempotency.repository';
import { PortalStorageService, type PortalUploadFile } from './portal-storage.service';
import { PortalDocumentUploadedDto, PortalProfileDto, expose } from './portal.dto';
import type { UploadDocumentDto } from './portal-write.dto';
import { PortalWriteResult, type PortalVendor } from './portal.types';

const IDENTITY_GROUP = 'Identity — verified once, not per load';
const BUSINESS_GROUP = 'Company & banking';

@Injectable()
export class PortalProfileService {
  constructor(
    private readonly repository: PortalProfileRepository,
    private readonly attachments: PortalAttachmentsRepository,
    private readonly storage: PortalStorageService,
    private readonly identity: PortalIdentityRepository,
    private readonly idempotency: PortalIdempotencyRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * `POST /portal/profile/documents/:kind` — `BR-23`.
   *
   * One endpoint for both tables: `vendor_kyc` for the four identity kinds,
   * `vendor_documents` for the business papers. Which one a kind lands in is a
   * server-side detail — a transporter uploading their trade licence should
   * not have to know we file it somewhere else from their PAN.
   *
   * Every upload resets the document to `PENDING`. A previous `VERIFIED` is
   * never carried forward: that decision was about the previous file.
   */
  async uploadDocument(
    vendor: PortalVendor,
    kind: string,
    dto: UploadDocumentDto,
    file: PortalUploadFile | undefined,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<PortalWriteResult<PortalDocumentUploadedDto>> {
    const endpoint = PORTAL_ENDPOINT.DOCUMENT_UPLOAD;
    const upper = (kind ?? '').trim().toUpperCase();

    const isIdentity = (IDENTITY_KINDS as readonly string[]).includes(upper);
    const isBusiness = (BUSINESS_DOCUMENT_KINDS as readonly string[]).includes(upper);
    // An unknown kind is a 404 on the kind, not a validation error on the body:
    // the path segment names a document that does not exist here.
    if (!isIdentity && !isBusiness) {
      throw portalError('NOT_FOUND', 'That document type is not one we collect.');
    }
    if (!file) throw portalError('VALIDATION_ERROR', 'Attach a photo or PDF of the document.');

    // The selfie is the only geotagged kind, and the coordinates are the point
    // of it — a selfie without them proves presence nowhere.
    const latitude = dto.latitude ?? dto.lat ?? null;
    const longitude = dto.longitude ?? dto.lng ?? null;
    if (GEOTAGGED_KINDS.includes(upper) && (!latitude || !longitude)) {
      throw portalError(
        'VALIDATION_ERROR',
        'This photo needs your location. Allow location access and take it again.',
      );
    }
    // Range-checked and KEPT — this service used to validate the coordinates
    // were present and then write neither of them anywhere (geo.ts).
    const geo = parseGeo(latitude, longitude);

    const idempotencyCtx = {
      idempotency: this.idempotency,
      vendorId: vendor.vendorId,
      endpoint,
      key: idempotencyKey,
      dto: PortalDocumentUploadedDto,
    };

    // Same ordering fix as the trip endpoints: check for a replay before the
    // document is uploaded, not after — a retried upload must cost one
    // SELECT, not a second file in storage.
    const replay = await checkIdempotentReplay(idempotencyCtx);
    if (replay) return replay;

    const prepared = this.storage.prepare(file);
    const stored = await this.storage.put(isIdentity ? 'kyc' : 'documents', vendor.vendorId, prepared);

    return runIdempotentWrite(
      idempotencyCtx,
      () =>
        this.repository.transaction().execute(async (trx) => {
          const systemUserId = await this.identity.systemUploaderId();
          const attachmentId = await this.attachments.insert(trx, stored, {
            kind: upper,
            entityType: isIdentity ? 'vendor_kyc' : 'vendor_documents',
            entityId: vendor.vendorId,
            uploadedBy: systemUserId,
            geoLat: geo?.lat ?? null,
            geoLng: geo?.lng ?? null,
          });

          const saved = isIdentity
            ? await this.repository.upsertKyc(trx, {
                vendorId: vendor.vendorId,
                kind: upper,
                attachmentId,
              })
            : await this.repository.upsertDocument(trx, {
                vendorId: vendor.vendorId,
                kind: upper,
                attachmentId,
                reference: dto.reference?.trim() || null,
                validFrom: dto.validFrom ?? null,
                validTo: dto.validTo ?? null,
              });

          const payload = {
            kind: upper,
            label: DOCUMENT_LABEL[upper] ?? upper,
            status: 'PENDING',
            uploadedAt: saved.updatedAt,
            file: { id: stored.id, mime: stored.mime, bytes: stored.bytes, url: null },
            needsGeotag: GEOTAGGED_KINDS.includes(upper),
            capture: CAPTURE_KINDS.includes(upper),
            message:
              'Received. Our compliance team will check it — you do not need to send it again ' +
              'unless we ask you to.',
          };

          await this.auditService.recordPortalEvent(trx, vendor.vendorId, {
            action: 'PORTAL_DOCUMENT_UPLOADED',
            entityType: isIdentity ? 'vendor_kyc' : 'vendor_documents',
            entityId: saved.id,
            after: { kind: upper, status: 'PENDING' },
            requestId,
          });

          await this.idempotency.record(trx, vendor.vendorId, endpoint, idempotencyKey, payload);
          return new PortalWriteResult(expose(PortalDocumentUploadedDto, payload), false);
        }),
    );
  }

  async getProfile(vendor: PortalVendor): Promise<PortalProfileDto> {
    const [row, kyc, documents, business] = await Promise.all([
      this.repository.findVendor(vendor.vendorId),
      this.repository.findKyc(vendor.vendorId),
      this.repository.findDocuments(vendor.vendorId),
      this.repository.business(vendor.vendorId),
    ]);

    // Unreachable in practice — the guard resolved this vendor from
    // `vendor_users` a moment ago — but a missing row must not become a 500
    // that logs the id back out.
    if (!row) throw portalError('NOT_FOUND', 'That profile could not be found.');

    const today = new Date().toISOString().slice(0, 10);
    const aadhaar = kyc.find((k) => k.kind === 'AADHAAR');

    return expose(PortalProfileDto, {
      vendorCode: row.code,
      companyName: row.legalName,
      // No contact-person column exists on `vendors`; the bank account holder
      // is the nearest true name on the file, and null when it is not set.
      contactName: row.accountHolder,
      phone: row.phone,
      city: row.baseCity,
      gstin: row.gstin,
      panMasked: maskPan(row.pan),
      // `BR-04` / `NFR-04`: four characters at most, ever. The column CHECK
      // enforces it too; the slice is here so a widened column cannot widen
      // this payload.
      aadhaarLast4: aadhaar?.valueMasked ? aadhaar.valueMasked.slice(-4) : null,
      bankAccountMasked: maskAccount(row.bankAccount),
      bankIfsc: row.ifsc,
      advancePolicyPct: row.advancePct,
      business,
      documents: [
        {
          group: IDENTITY_GROUP,
          documents: IDENTITY_KINDS.map((kind) => {
            const found = kyc.find((k) => k.kind === kind);
            return this.toDocument(kind, {
              status: found?.status,
              decidedAt: found?.decidedAt ?? null,
              validTo: null,
              rejectReason: found?.rejectReason ?? null,
              today,
            });
          }),
        },
        {
          group: BUSINESS_GROUP,
          documents: BUSINESS_DOCUMENT_KINDS.map((kind) => {
            const found = documents.find((d) => d.kind === kind);
            return this.toDocument(kind, {
              status: found?.status,
              decidedAt: null,
              validTo: found?.validTo ?? null,
              rejectReason: found?.rejectReason ?? null,
              today,
            });
          }),
        },
      ],
    });
  }

  private toDocument(
    kind: string,
    input: {
      status?: string;
      decidedAt: string | null;
      validTo: string | null;
      rejectReason: string | null;
      today: string;
    },
  ) {
    const expired =
      input.status === 'VERIFIED' && input.validTo !== null && input.validTo < input.today;
    const status = input.status ? (expired ? 'EXPIRED' : input.status) : 'MISSING';

    return {
      kind,
      label: DOCUMENT_LABEL[kind] ?? kind,
      status,
      // `08-P7` §1 calls the rejection reason "the whole point of this screen".
      // `20260830000000_c2_vendor_document_reject_reason.sql` added the column
      // that `vendor_kyc` and `vendor_documents` were the only document tables
      // to lack, so this is a real sentence now rather than an honest blank.
      //
      // Scoped to REJECTED, matching `rejectedOn` below: a re-upload clears the
      // column, but reading a stale reason against any other status would
      // describe a decision that no longer stands.
      rejectionReason: input.status === 'REJECTED' ? input.rejectReason : null,
      rejectedOn: input.status === 'REJECTED' ? dateOnly(input.decidedAt) : null,
      expiredOn: expired ? input.validTo : null,
      // No `vendor_documents` row names a vehicle — see portal-fleet.service.ts.
      groundsVehicleRegistrationNo: null,
      capture: CAPTURE_KINDS.includes(kind),
      needsGeotag: GEOTAGGED_KINDS.includes(kind),
    };
  }
}

/** `AABCR1234M` → `AABCR****M`, the shape `FE.md` §5 prints. */
function maskPan(pan: string | null): string | null {
  if (!pan) return null;
  if (pan.length < 6) return '*'.repeat(pan.length);
  return `${pan.slice(0, 5)}${'*'.repeat(pan.length - 6)}${pan.slice(-1)}`;
}

function maskAccount(account: string | null): string | null {
  if (!account) return null;
  return `${'•'.repeat(Math.max(0, account.length - 4))}${account.slice(-4)}`;
}

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}
