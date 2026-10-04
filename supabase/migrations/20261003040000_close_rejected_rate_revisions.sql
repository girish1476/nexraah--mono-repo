-- Close rate changes whose approval was turned down.
--
-- Rejecting a RATE_REVISION approval used to leave its `rate_revisions` row
-- PENDING. The lane then read "change waiting for sign-off" for good, and
-- refused every later change, because a lane takes one waiting change at a
-- time. The API now closes the row with its approval; this closes the ones
-- left behind before it did.
--
-- Forward-only and idempotent.

update rate_revisions r
   set status = 'REJECTED',
       updated_at = now()
  from approvals a
 where a.id = r.approval_id
   and r.status = 'PENDING'
   and a.status = 'REJECTED';
