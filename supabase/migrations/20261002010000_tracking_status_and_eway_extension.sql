-- Tracking in transit: a status on each update, and the e-way bill extended
-- while the truck is still on the road.
--
-- Tracking is mandatory partly because of the e-way bill: when it expires
-- before the truck is unloaded it has to be extended, and the tracking sheet
-- is where that is done and recorded.
--
-- Forward-only and idempotent.

alter table trip_tracking_updates add column if not exists status text
  check (status is null or status in ('MOVING', 'HALTED', 'CHECKPOST', 'TRAFFIC', 'BREAKDOWN', 'ACCIDENT', 'WAITING_TO_UNLOAD', 'OTHER'));

alter table trip_tracking_updates drop constraint if exists trip_tracking_updates_kind_check;
alter table trip_tracking_updates add constraint trip_tracking_updates_kind_check
  check (kind in ('UPDATE', 'REACHED_LOADING', 'LOADED', 'DEPARTED', 'REACHED', 'UNLOADED', 'EWAY_EXTENDED'));
