-- One loading supervisor per trip, and loading as a recorded event.
--
-- The loading supervisor is an existing Operations user assigned to a trip —
-- not a new role. They run the loading, record when it started and finished,
-- and upload the loading documents and the vehicle documents. Compliance then
-- verifies those, and the advance is processed only after that.
--
-- The loading slip joins the documents that gate the advance. The weighment
-- slip is a recorded document but does not gate anything. The set lives in
-- `config.advance_document_set`, read live by the payment and trip services.
--
-- Forward-only and idempotent.

alter table trips
  add column if not exists loading_supervisor_id uuid references users(id),
  add column if not exists loading_started_at    timestamptz,
  add column if not exists loading_completed_at  timestamptz;

create index if not exists trips_loading_supervisor_idx on trips (loading_supervisor_id)
  where loading_supervisor_id is not null;

update config
   set value = value || '["LOADING_SLIP"]'::jsonb
 where key = 'advance_document_set'
   and jsonb_typeof(value) = 'array'
   and not (value ? 'LOADING_SLIP');
