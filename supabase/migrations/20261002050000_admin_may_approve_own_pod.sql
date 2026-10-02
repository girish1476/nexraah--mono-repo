-- An administrator may approve a POD they verified (owner's direction, 2026-10-02).
--
-- BR-50 said the approver is never the verifier, for everyone, and
-- pod_approver_not_verifier enforced it as a CHECK. The owner asked for an
-- administrator who can approve anything, including the proof they checked
-- themselves. Every other role still needs a second person.
--
-- A CHECK cannot see the approver's role, so the constraint becomes a trigger
-- that looks it up. It raises the same SQLSTATE and constraint name the CHECK
-- did, so nothing that reads the error has to change.
--
-- Forward-only and idempotent.

alter table pod_receipts drop constraint if exists pod_approver_not_verifier;

create or replace function public.pod_approver_not_verifier() returns trigger
language plpgsql as $$
begin
  if new.approved_by is not null
     and new.approved_by = new.verified_by
     and not exists (
       select 1
       from users u
       join roles r on r.id = u.role_id
       where u.id = new.approved_by and r.code = 'ADMIN'
     )
  then
    raise exception 'The verifier cannot approve their own POD (BR-50)'
      using errcode = 'check_violation', constraint = 'pod_approver_not_verifier';
  end if;
  return new;
end
$$;

drop trigger if exists pod_approver_not_verifier on pod_receipts;
create trigger pod_approver_not_verifier
  before insert or update of approved_by, verified_by on pod_receipts
  for each row execute function public.pod_approver_not_verifier();
