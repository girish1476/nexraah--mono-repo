-- Part 12 · Go-live import (wave C11) — the batch ledger.
--
-- `upload -> dry-run -> confirm -> commit` needs somewhere to hold the dry run
-- between the two requests. Storing the *accepted rows* alongside the report is
-- deliberate: the alternative is asking the operator to upload the same file a
-- second time to commit it, which means the thing committed is not provably the
-- thing that was reviewed.
--
-- `file_hash` is the sha256 of the uploaded bytes, so re-running the same file
-- is recognisable rather than silently duplicated (part 12 §2, and the reason
-- `attachments.sha256` exists at all).

create table import_batches (
  id            uuid        primary key default gen_random_uuid(),
  set_name      text        not null check (set_name in ('clients','vendors','opening-balances')),
  file_name     text        not null,
  file_hash     text        not null check (file_hash ~ '^[0-9a-f]{64}$'),
  row_count     integer     not null check (row_count     >= 0),
  rejected_count integer    not null check (rejected_count >= 0),
  actor_id      uuid        not null references users(id),
  -- Denormalised so history stays readable after a user row is renamed or
  -- disabled; the id above is still the join for anything that needs it.
  actor_name    text        not null,
  status        text        not null default 'DRY_RUN'
                            check (status in ('DRY_RUN','COMMITTED','ABORTED')),
  -- The dry-run report exactly as the screen rendered it.
  report        jsonb       not null,
  -- The rows that passed validation, ready to write on commit. Never the
  -- rejected ones — a partial import is not a state this system has.
  payload       jsonb       not null,
  committed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A committed batch must say when; a batch that is not committed must not.
  constraint import_batches_committed_at_matches_status
    check ((status = 'COMMITTED') = (committed_at is not null))
);

create index import_batches_file_hash_idx on import_batches (file_hash);
create index import_batches_created_at_idx on import_batches (created_at desc);
