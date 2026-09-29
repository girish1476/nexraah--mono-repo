-- The loading supervisor is a login of its own.
--
-- They run the loading of the trips they are assigned and upload the loading,
-- vehicle and client documents an advance needs (loading slip, weighment slip,
-- e-way bill, client invoice, vehicle papers). They hold no permission codes:
-- what they may do is decided per trip — the person assigned as its loading
-- supervisor may upload documents to it and start and finish its loading —
-- rather than by a blanket grant that would reach every trip.
--
-- Forward-only and idempotent.

insert into roles (code, name)
values ('LOADING_SUPERVISOR', 'Loading supervisor')
on conflict (code) do nothing;
