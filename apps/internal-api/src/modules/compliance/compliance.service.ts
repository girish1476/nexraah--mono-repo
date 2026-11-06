import { Injectable } from '@nestjs/common';
import { ComplianceRepository } from './compliance.repository';
import {
  ALWAYS_MANDATORY_DOCUMENT_KINDS,
  KYC_KINDS,
  LEGAL_DOCUMENT_KINDS,
  MANDATORY_KYC_KINDS,
} from '../vendors/vendors.constants';

export interface QueueRow {
  ref: string;
  subject: string;
  note: string;
  ageDays: number;
  flag: string | null;
  tone: 'mint' | 'flag' | 'red' | 'blue' | 'grey';
  href: string;
  action: string;
}

export interface Queue {
  key: 'VENDOR_FILES' | 'CLIENT_CONTRACTS' | 'TRIP_DOCUMENTS';
  name: string;
  rows: QueueRow[];
}

function ageDaysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

type Paper = { kind: string; status: string };

/**
 * How far a transporter's file has got, in the words the queue shows, and
 * whether it would pass activation (BR-01) — the same rule
 * `VendorsService.unmetForSubmit(…, 'verified')` applies.
 */
export function vendorFileProgress(partyType: string, kyc: Paper[], documents: Paper[]) {
  const verified = (p: Paper | undefined) => p?.status === 'VERIFIED';
  const kycOf = new Map(kyc.map((k) => [k.kind, k]));
  const docOf = new Map(documents.map((d) => [d.kind, d]));
  const kycVerified = KYC_KINDS.filter((k) => verified(kycOf.get(k))).length;
  const docsVerified = documents.filter(verified).length;
  const ready =
    MANDATORY_KYC_KINDS.every((k) => verified(kycOf.get(k))) &&
    ALWAYS_MANDATORY_DOCUMENT_KINDS.every((k) => verified(docOf.get(k))) &&
    (partyType === 'OWNER' ? verified(docOf.get('RC')) : LEGAL_DOCUMENT_KINDS.some((k) => verified(docOf.get(k))));
  return {
    note: `${kycVerified} of ${KYC_KINDS.length} identity checks verified · ${docsVerified} of ${documents.length} documents verified`,
    ready,
  };
}

/** internal-spec/03-C2 §4: one queue, three segments, each renderable without a second call. */
@Injectable()
export class ComplianceService {
  constructor(private readonly complianceRepository: ComplianceRepository) {}

  async queues(): Promise<Queue[]> {
    const [vendorFiles, clients, tripDocs] = await Promise.all([
      this.complianceRepository.pendingVendorFiles(),
      this.complianceRepository.clientsWithoutRateCards(),
      this.complianceRepository.pendingTripDocuments(),
    ]);
    const papers = await this.complianceRepository.papersFor(vendorFiles.map((v) => v.id));

    return [
      {
        key: 'VENDOR_FILES',
        name: 'Vendor files',
        // A count of "items pending" read 0 for a file whose papers were never
        // uploaded at all. What is verified out of what is on file says where
        // it stands, and Ready/Blocked whether it can be activated.
        rows: vendorFiles.map((v) => {
          const { note, ready } = vendorFileProgress(
            String(v.partyType),
            papers.kyc.filter((k) => k.vendorId === v.id),
            papers.documents.filter((d) => d.vendorId === v.id),
          );
          return {
            ref: v.code,
            subject: v.legalName,
            note,
            ageDays: ageDaysSince(String(v.createdAt)),
            flag: ready ? 'Ready' : 'Blocked',
            tone: ready ? 'mint' : 'flag',
            href: `/vendors/${v.id}`,
            action: 'Open file',
          };
        }),
      },
      {
        key: 'CLIENT_CONTRACTS',
        name: 'Client contracts',
        rows: clients.map((c) => ({
          ref: c.code,
          subject: c.name,
          // Worded as the console explains it (FLAG_REASON keys on the flag).
          note: 'No rate card lanes exist for this contract',
          ageDays: ageDaysSince(String(c.createdAt)),
          flag: 'No lanes priced',
          tone: 'flag' as const,
          href: `/clients/${c.id}`,
          action: 'Decide',
        })),
      },
      {
        key: 'TRIP_DOCUMENTS',
        name: 'Trip documents awaiting verification',
        // Unverified trip papers hold the advance back from the first day, so
        // the pill says so from the first day — it used to stay blank for one.
        rows: tripDocs.map((t) => ({
          ref: t.tripCode,
          subject: t.lane ?? t.tripCode,
          note: `${t.pendingCount} document(s) uploaded and waiting · blocking the advance`,
          ageDays: ageDaysSince(String(t.oldestAt)),
          flag: 'Blocking money',
          tone: 'red' as const,
          href: `/trips/${t.tripId}/documents`,
          action: 'Verify',
        })),
      },
    ];
  }
}
