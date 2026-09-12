-- Tickets — reporting wrong data from the screen it is wrong on.
--
-- Asked for directly: "Need a ticketing portal that administrative person have
-- access for edit options if any wrong data was updated. Ticketing should be
-- available for every dashboard."
--
-- The problem it solves is one the audit trail cannot. `audit_events` records
-- every change and refuses to be edited, which is exactly right for proving
-- what happened — and useless to somebody looking at a client name spelt wrong
-- on the screen in front of them. Until now their options were to ring
-- somebody or to leave it. A ticket is the third: raised from the screen,
-- carrying where it was raised from, and answerable by an administrator who
-- can actually correct the record.
--
-- Anybody may raise one. That is deliberate — the person who notices wrong
-- data is whoever happened to be using the screen, and a report queue nobody
-- can add to fills up with nothing.

-- ---------------------------------------------------------------- permission
-- Acting on somebody else's ticket. NOT required to raise one.
insert into permissions (code) values ('ticket.resolve')
on conflict (code) do nothing;

-- Administration only, per the instruction. It is not a fixed permission —
-- nothing here moves money or clears a party — so it can be granted onward if
-- the business wants a second desk answering these.
insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
cross join permissions p
where p.code = 'ticket.resolve'
  and r.code = 'ADMIN'
on conflict do nothing;

-- -------------------------------------------------------------------- table
create table tickets (
  id            uuid primary key default gen_random_uuid(),
  -- TKT-0001. Its own series so a person can quote it on the phone.
  code          text        not null unique,

  -- Where it was raised from, captured rather than typed. A report that says
  -- "the rate is wrong" is unactionable; one that arrives carrying the screen
  -- and the record is a job somebody can pick up.
  raised_on_path text       not null,
  entity_type   text,
  entity_id     text,

  subject       text        not null check (char_length(subject) between 5 and 140),
  -- The same floor the approvals engine uses for a reason. A four-word
  -- description of wrong data is a second conversation, not a report.
  detail        text        not null check (char_length(detail) >= 20),

  kind          text        not null default 'WRONG_DATA'
                            check (kind in ('WRONG_DATA','MISSING_DATA','ACCESS','HOW_DO_I','OTHER')),
  -- No numeric priority. "P1" means whatever the person typing it thinks it
  -- means; these three say what is actually true of the work.
  severity      text        not null default 'NORMAL'
                            check (severity in ('BLOCKING','NORMAL','MINOR')),
  status        text        not null default 'OPEN'
                            check (status in ('OPEN','IN_PROGRESS','RESOLVED','WONT_FIX')),

  raised_by     uuid        not null references users(id),
  branch_id     uuid        references branches(id),
  assigned_to   uuid        references users(id),

  -- What was actually done about it. Required to close one: a ticket resolved
  -- with no note tells the person who raised it nothing, and they raise it
  -- again next week.
  resolution    text,
  resolved_by   uuid        references users(id),
  resolved_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint tickets_resolution_needs_note
    check (status not in ('RESOLVED','WONT_FIX') or resolution is not null)
);

create index tickets_status_idx  on tickets (status, created_at desc);
create index tickets_raiser_idx  on tickets (raised_by, created_at desc);
create index tickets_entity_idx  on tickets (entity_type, entity_id);
create index tickets_open_idx    on tickets (created_at desc) where status in ('OPEN','IN_PROGRESS');

comment on table tickets is
  'Data problems reported from the screen they were spotted on. Raised by anyone, acted on by whoever holds ticket.resolve.';
comment on column tickets.raised_on_path is
  'The console route the reporter was looking at. Captured, never typed.';

-- ----------------------------------------------------------------- numbering
-- TKT-0001 upward, one series for the whole company rather than per branch: a
-- ticket is quoted between desks and a branch-scoped number would collide
-- across them.
-- The column is `width`, not `padding`, and the key is UPPERCASE: the
-- `20260814090400` migration re-seeded this table with uppercase keys and a
-- `(key, branch_id)` uniqueness index. A lowercase key here would look right
-- and throw "Unknown number series" on the first ticket raised — at runtime,
-- not at build.
insert into number_series (key, prefix, next_value, width, scope, branch_id)
values ('TICKET', 'TKT-', 1, 4, 'GLOBAL', null)
on conflict (key, branch_id) do nothing;
