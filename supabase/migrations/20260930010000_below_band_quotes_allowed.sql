-- A quote below the lane's floor is accepted and flagged, no longer refused.
--
-- The floor (`bid_min`) used to be a barrier: a transporter quoting under it
-- was turned away and nothing was stored. A cheaper truck is more margin, so
-- the business asked for the barrier to go. The quote is now kept with
-- `band_position = 'BELOW_BAND'` so Operations sees at a glance that it is
-- under the usual market rate and can judge whether to trust it. Awarding it
-- needs no approval; only above-band awards still do.
--
-- Forward-only and idempotent.

alter table quotes drop constraint if exists quotes_band_position_check;
alter table quotes
  add constraint quotes_band_position_check
  check (band_position in ('BELOW_BAND', 'IN_BAND', 'ABOVE_BAND'));
