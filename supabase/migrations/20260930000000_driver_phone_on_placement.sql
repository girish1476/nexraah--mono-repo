-- Vehicle allocation asks for the driver's mobile number.
--
-- Operations reaches the truck by phoning the driver, so the mobile number is
-- the one contact detail allocation needs. The driver's name and licence were
-- required and are now optional: they are often not known when the vehicle is
-- confirmed, and the licence is checked later with the advance documents.
-- Both columns were already nullable; only the form and the API required them.
--
-- Forward-only and idempotent.

alter table indents add column if not exists driver_phone text;
alter table trips   add column if not exists driver_phone text;
