-- Add the business development role, and make Leadership's oversight real.
--
-- Two changes the owner asked for on 2026-08-26, in one migration because they
-- are one decision about who does what:
--
-- 1 · BD is a new role whose subject is *price* rather than a stage of the
--     shipment. Every other role owns a step — Operations moves the truck,
--     Compliance clears the papers, Finance moves the money. BD owns what the
--     lane is worth: the RFQ build-up, the rate card it lands on, and the
--     client relationship the rate belongs to.
--
--     It does NOT get `rfq.submit`. That is a fixed permission held by
--     Leadership, and keeping it there means the desk that proposes a price is
--     never the desk that commits it to the client. BD raising an above-band
--     price and BD approving one would be the same signature twice.
--
-- 2 · Leadership was, in practice, a reporting role: six permissions, view-only
--     on every operating screen, and `NONE` on the compliance queue — the one
--     screen in the console it could not open at all. The owner's position is
--     that Leadership oversees Operations, Compliance and Finance, so it now
--     holds their operating permissions rather than a read-only window onto
--     them.
--
--     `payment.release` is still not granted, and that is the deliberate line.
--     It sits in the fixed set with `pod.waive` and `config.manage` —
--     permissions that never belong to two roles at once. Oversight of the
--     money is a different thing from being a second pair of hands able to
--     move it, and the payment audit trail is only worth reading while exactly
--     one desk can pay.
--
--     Stated cost: vendor clearance no longer *forces* two desks. Compliance
--     normally does it; Leadership can now do it alone. BR-50's two-person POD
--     rule is unaffected — it keys on the acting user, not the role, so nobody
--     approves what they themselves verified whatever role they hold.

begin;

-- 1 · The role itself. `on conflict do nothing` so a re-run is harmless.
insert into roles (code, label)
values ('BD', 'Business development')
on conflict (code) do nothing;

-- 2 · BD's grants — rate management, and nothing that spends money or moves a
--     truck. `pnl.view_own` is here because a desk that sets prices with no
--     sight of the margin they produce is guessing.
insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
join permissions p on p.code in ('rfq.edit', 'client.manage', 'indent.view', 'pnl.view_own')
where r.code = 'BD'
on conflict (role_id, permission_id) do update
  set level = 'EDIT', updated_at = now();

-- 3 · Leadership gains the operating permissions of the desks it oversees.
--     `payment.release`, `pod.waive` and `config.manage` are absent by
--     design — see the header.
insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
join permissions p on p.code in (
  'indent.create',
  'indent.manage',
  'document.verify',
  'vendor.edit',
  'vendor.verify',
  'vendor.activate',
  'vendor.advance_policy',
  'client.manage',
  'client.onboard',
  'rfq.edit',
  'pod.receive',
  'pod.verify',
  'pod.approve',
  'approve.contract'
)
where r.code = 'LEADERSHIP'
on conflict (role_id, permission_id) do update
  set level = 'EDIT', updated_at = now();

-- 4 · Guard the line this migration exists to hold. If a later change ever
--     grants `payment.release`, `pod.waive` or `config.manage` to a second
--     role, this fails loudly at deploy rather than quietly widening who can
--     move money.
do $$
declare
  offender text;
begin
  select string_agg(p.code || ' → ' || cnt::text || ' roles', ', ')
  into offender
  from (
    select rp.permission_id, count(*) as cnt
    from role_permissions rp
    where rp.level <> 'NONE'
    group by rp.permission_id
    having count(*) > 1
  ) dup
  join permissions p on p.id = dup.permission_id
  where p.code in ('payment.release', 'pod.waive', 'config.manage');

  if offender is not null then
    raise exception 'Fixed permission held by more than one role: %', offender;
  end if;
end $$;

commit;
