import { Injectable } from '@nestjs/common';
import { ComplianceRepository } from './compliance.repository';

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

    return [
      {
        key: 'VENDOR_FILES',
        name: 'Vendor files awaiting verification',
        rows: vendorFiles.map((v) => {
          const pending = Number(v.kycPending) + Number(v.docsPending);
          const ageDays = ageDaysSince(String(v.createdAt));
          return {
            ref: v.code,
            subject: v.legalName,
            note: `${pending} item${pending === 1 ? '' : 's'} pending verification`,
            ageDays,
            flag: ageDays > 3 ? 'Ageing' : null,
            tone: ageDays > 3 ? 'red' : 'flag',
            href: `/vendors/${v.id}`,
            action: 'Verify',
          };
        }),
      },
      {
        key: 'CLIENT_CONTRACTS',
        name: 'Client contracts',
        rows: clients.map((c) => ({
          ref: c.code,
          subject: c.name,
          note: 'No rate card lanes priced yet',
          ageDays: ageDaysSince(String(c.createdAt)),
          flag: 'No rate card lanes',
          tone: 'blue' as const,
          href: `/clients/${c.id}`,
          action: 'Approve',
        })),
      },
      {
        key: 'TRIP_DOCUMENTS',
        name: 'Trip documents awaiting verification',
        rows: tripDocs.map((t) => {
          const ageDays = ageDaysSince(String(t.oldestAt));
          return {
            ref: t.tripCode,
            subject: t.lane ?? t.tripCode,
            note: `${t.pendingCount} document${Number(t.pendingCount) === 1 ? '' : 's'} awaiting verification`,
            ageDays,
            flag: ageDays > 1 ? 'Blocking money' : null,
            tone: ageDays > 1 ? 'red' : ('grey' as const),
            href: `/trips/${t.tripId}/documents`,
            action: 'Verify',
          };
        }),
      },
    ];
  }
}
