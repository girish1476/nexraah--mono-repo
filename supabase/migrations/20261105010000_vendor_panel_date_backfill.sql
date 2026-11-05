-- "On panel since" for transporters already cleared.
--
-- Activation never recorded `panel_date`, so on a real database every active
-- transporter showed "On panel since —". Activation now stamps it; this fills
-- the ones cleared before that, from the day the audit trail shows them first
-- turned ACTIVE. A transporter with no such record keeps a blank date rather
-- than a guessed one.

update vendors v
   set panel_date = first_active.on_day
  from (
    select entity_id, min(at)::date as on_day
      from audit_events
     where entity_type = 'vendors'
       and action = 'STATUS_CHANGE'
       and after ->> 'status' = 'ACTIVE'
     group by entity_id
  ) first_active
 where v.id = first_active.entity_id
   and v.panel_date is null;
