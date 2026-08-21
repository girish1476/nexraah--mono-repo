-- C5 · pod_receipts.received_by is free text, not a users FK
--
-- docs/api/05-pod.md `POST /pod/:tripId/receive` documents the field with a
-- literal example — `"receivedBy": "Sunita Rao"` — as the name of whoever
-- physically signed for the courier packet at the branch. That is very often
-- not an internal_api user at all (a security guard, a front-desk temp), and
-- the caller (an internal user, checked by `pod.receive`) is already recorded
-- separately by the audit trail. 090100 typed the column
-- `uuid references users(id)` instead — every real `receive()` call raises
-- "invalid input syntax for type uuid" the moment a name is supplied,
-- because a name is exactly what the documented contract asks for. Caught by
-- running the POD flow end-to-end against a live database.

alter table pod_receipts drop constraint pod_receipts_received_by_fkey;
alter table pod_receipts alter column received_by type text using received_by::text;
