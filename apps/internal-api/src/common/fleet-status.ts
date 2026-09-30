import { sql } from 'kysely';
import type { DbExecutor } from '../db/kysely';

/**
 * A transporter's own fleet row follows its truck through a trip.
 *
 * Nothing moved `vendor_fleet.status` when a truck was put on a load, so a
 * vehicle driving a load read AVAILABLE on the transporter's own Fleet tab and
 * in the console. Now: allocated → ON_TRIP; delivered, swapped out or the load
 * set aside → AVAILABLE again (at the delivery city, when delivered).
 *
 * DOCS_DUE and MAINTENANCE are never overwritten — each is set for a reason
 * this code knows nothing about. A plate that is not in the transporter's
 * fleet (a truck they never listed) matches no row and changes nothing.
 * Plates are compared ignoring spaces and case, the way they are typed.
 */
export async function setFleetVehicleStatus(
  db: DbExecutor,
  vendorId: string | null | undefined,
  vehicleNo: string | null | undefined,
  status: 'AVAILABLE' | 'ON_TRIP',
  currentCity?: string | null,
): Promise<void> {
  if (!vendorId || !vehicleNo || !vehicleNo.trim()) return;
  const plate = vehicleNo.replace(/\s/g, '').toUpperCase();
  await db
    .updateTable('vendor_fleet')
    .set({
      status,
      ...(currentCity ? { current_city: currentCity } : {}),
      ...(status === 'AVAILABLE' ? { free_from: null } : {}),
    })
    .where('vendor_id', '=', vendorId)
    .where(sql<string>`upper(replace(registration, ' ', ''))`, '=', plate)
    .where('status', 'in', ['AVAILABLE', 'ON_TRIP'])
    .execute();
}
