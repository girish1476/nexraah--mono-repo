import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PortalDbModule } from '../../db/portal-db.module';
import { PortalAudienceGuard } from '../../common/guards/portal-audience.guard';
import { PortalIdentityRepository } from './portal-identity.repository';
import { PortalIdempotencyRepository } from './portal-idempotency.repository';
import { PortalAttachmentsRepository } from './portal-attachments.repository';
import { PortalStorageService } from './portal-storage.service';
import { PortalVendorGuard } from './portal-vendor.guard';
import { PortalWriteGuard } from './portal-write.guard';
import { PortalWriteInterceptor } from './portal-write.interceptor';
import { PortalLoadsController } from './portal-loads.controller';
import { PortalLoadsRepository } from './portal-loads.repository';
import { PortalLoadsService } from './portal-loads.service';
import { PortalTripsController } from './portal-trips.controller';
import { PortalTripsRepository } from './portal-trips.repository';
import { PortalTripsService } from './portal-trips.service';
import { PortalFleetController } from './portal-fleet.controller';
import { PortalFleetRepository } from './portal-fleet.repository';
import { PortalFleetService } from './portal-fleet.service';
import { PortalProfileController } from './portal-profile.controller';
import { PortalProfileRepository } from './portal-profile.repository';
import { PortalProfileService } from './portal-profile.service';

/**
 * The transporter surface, `docs/api/11-portal.md`.
 *
 * **`PortalDbModule` is the only database import here and that is the whole
 * design.** `InternalDbModule` is `@Global()`, so every other module gets `DB`
 * bound to `internalPool` for free; this module's own `imports` entry binds the
 * same token to `portalPool` (role `vendor_api`) and wins for everything
 * constructed in this module's context. `ADR-02` §3.1 — layer one of the
 * redaction contract used to be a process boundary and is now this line.
 *
 * Adding `InternalDbModule` here, or importing any module whose repositories it
 * feeds, voids that layer silently: the queries keep working, and the columns
 * that were supposed to raise start returning data.
 *
 * The JSON writes (`POST /portal/loads/:code/quote`, `DELETE /portal/quotes/:id`,
 * `POST /portal/fleet`, `PATCH /portal/fleet/:id`) are here too, and they change
 * nothing about the rule above: every one of them runs on the SAME `DB` binding
 * as the reads, and `vendor_api`'s `insert`/`update` grants are as narrow as its
 * `select` grants (`update (status)` on `quotes`, no `delete` anywhere).
 * `AuditService` is injected rather than imported — it is `@Global()` and takes
 * the executor as an argument, so it carries no pool of its own and cannot
 * smuggle `internalPool` in behind it.
 *
 * The multipart writes — POD, vendor bill, KYC document (`11-portal.md` §4) —
 * are still to come; they need the upload pipeline, which no route here
 * touches.
 */
@Module({
  imports: [PortalDbModule],
  controllers: [
    PortalLoadsController,
    PortalTripsController,
    PortalFleetController,
    PortalProfileController,
  ],
  providers: [
    PortalIdentityRepository,
    PortalIdempotencyRepository,
    // The multipart pair. `PortalStorageService` talks to Supabase Storage
    // directly rather than reusing `AttachmentsService`, which is constructed
    // against `internalPool` — importing its module here would rebind `DB` and
    // void the redaction layer this module exists to hold.
    PortalAttachmentsRepository,
    PortalStorageService,
    PortalVendorGuard,
    PortalWriteGuard,
    PortalWriteInterceptor,
    PortalLoadsRepository,
    PortalLoadsService,
    PortalTripsRepository,
    PortalTripsService,
    PortalFleetRepository,
    PortalFleetService,
    PortalProfileRepository,
    PortalProfileService,
    // The outward half of `ADR-02` §4's two-way lock. `APP_GUARD` is global
    // wherever it is declared, and it is declared here so that the guard and
    // the surface it protects arrive together — a deployment that ships
    // `PortalModule` cannot ship without the guard that keeps the edge's key
    // out of `/api/v1/pnl`.
    { provide: APP_GUARD, useClass: PortalAudienceGuard },
  ],
})
export class PortalModule implements OnModuleInit {
  private readonly logger = new Logger('PortalModule');

  constructor(private readonly identity: PortalIdentityRepository) {}

  /**
   * The runtime half of `02-redaction-contract.md` §4 assertion 6b: "`6a`
   * proves the grant; `6b` proves the binding. Without 6b the whole layer can
   * be voided by one `internalPool` injection and every other assertion still
   * passes."
   *
   * Logged rather than thrown: a database that is not up yet at boot is an
   * operational condition, and failing to start over it would turn a slow
   * Postgres into an outage. A binding that resolves to the WRONG role is a
   * different thing entirely and says so at error level.
   */
  async onModuleInit(): Promise<void> {
    try {
      const role = await this.identity.currentDatabaseUser();
      if (role === 'vendor_api') {
        this.logger.log(`portal pool authenticated as ${role}`);
      } else {
        this.logger.error(
          `portal pool authenticated as ${role ?? 'unknown'}, expected vendor_api — ` +
            'layer one of the redaction contract (ADR-02 §3.1) is NOT in force.',
        );
      }
    } catch (error) {
      this.logger.warn(
        `could not confirm the portal pool's database role: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
