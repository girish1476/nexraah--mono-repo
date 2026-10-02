-- Who uploaded each trip document, and when it was last uploaded.
--
-- The order's Details page lists every document with who uploaded it and who
-- verified it. `created_at` stays the first upload; a re-upload after a
-- rejection moves `uploaded_at` and `uploaded_by` on.
--
-- Forward-only and idempotent.

alter table trip_documents add column if not exists uploaded_by uuid references users(id);
alter table trip_documents add column if not exists uploaded_at timestamptz;

update trip_documents set uploaded_at = created_at where uploaded_at is null and attachment_id is not null;
