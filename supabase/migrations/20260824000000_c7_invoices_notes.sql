-- C7 · invoices.notes was documented and built on the frontend but never added to the schema
--
-- docs/api/07-invoicing.md and the `Invoice` type (apps/internal-portal/src/
-- app/invoices/types.ts) both carry `notes: string`, and the create-invoice
-- form (apps/internal-portal/src/app/invoices/new/page.tsx) collects it and
-- sends it on `POST /invoices` — but 20260814090100_c1_schema.sql never gave
-- `invoices` a column for it. Caught while building the real InvoicingModule
-- against the existing schema: without this, a user's freeform note on an
-- invoice would silently vanish on every save.

alter table invoices add column notes text;
