-- An agreed rate typed wrongly can be put right in place (`PATCH
-- /clients/:id/rate-card/:laneId`), where before it could only be deleted by
-- Leadership and entered again. The correction is not a revision: nothing was
-- re-agreed with the client, a figure was mistyped. So the lane keeps its id and
-- its history of loads, and carries who corrected it, when, why, and what it
-- said before — the last correction; every one is also in the audit log.
alter table rate_card_lanes add column if not exists corrected_at      timestamptz;
alter table rate_card_lanes add column if not exists corrected_by      uuid references users(id);
alter table rate_card_lanes add column if not exists correction_reason text;
alter table rate_card_lanes add column if not exists corrected_from    jsonb;
