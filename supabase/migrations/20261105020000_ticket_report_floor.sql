-- A problem can be reported in a few words — in the database too.
--
-- 3b1430e (10 Oct 2026) lowered the floor for what a report says is wrong from
-- 20 characters to 5 (`MIN_REPORT`, ticket-rules.ts): the form and the API both
-- accept "Rate is wrong". This check was left at 20, so on a real database every
-- report of 5–19 characters was refused after the form had let it through
-- (seen five times on pre-prod, 4 Nov 2026). The in-browser demo checked 20 as
-- well, so the two disagreed with the form in the same way.
--
-- How a ticket was resolved keeps its 20-character floor (`MIN_DETAIL`); that
-- is checked by the API, not here.

alter table tickets drop constraint if exists tickets_detail_check;
alter table tickets add constraint tickets_detail_check check (char_length(btrim(detail)) >= 5);
