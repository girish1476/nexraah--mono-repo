import { test, expect, Page, Locator } from '@playwright/test';
import { setRole } from './helpers';
import {
  PERMISSION_LABEL,
  ROLES,
  type Permission,
  type RoleCode,
} from '../src/lib/permissions';

/**
 * Administrator console — `/admin`, `/admin/approvals`, `/admin/roles`,
 * `/admin/import`. `admin` (lib/permissions.ts) is ADMIN=EDIT,
 * LEADERSHIP=VIEW, everyone else NONE — the lock panel for the NONE roles is
 * already covered by `rbac-nav.spec.ts`, so this file is about what ADMIN
 * can actually do, plus what LEADERSHIP's read-only view withholds.
 * `approvals` is a *different* module (OPS=VIEW, COMPLIANCE/FINANCE/
 * BRANCH_MGR/LEADERSHIP=EDIT, ADMIN=VIEW) — an administrator only gets an
 * audit view of that queue, never a decision.
 *
 * The shared mock db (`src/mocks/db.ts`) has no reset endpoint, so a few
 * tests here are designed around that constraint instead of ignoring it:
 *  - Checkbox toggles read the current state and round-trip back to it, so
 *    reruns never drift.
 *  - The numbering-series edit always *increases* the next value (the mock
 *    rejects lowering one below what's already been consumed), so it is
 *    tested against an otherwise-unused series (`ISSUE`) and never asserts
 *    an absolute value — only "one more than whatever it was."
 *  - There are only 4 seeded approvals and no way to re-open a decided one,
 *    so the approve/reject test picks whichever pending item is currently
 *    decidable and skips (rather than fails) once a long run of local
 *    iteration has decided all of them.
 */

const field = (page: Page, label: string): Locator =>
  page.locator('div.field').filter({ has: page.getByText(label, { exact: true }) });

const fieldControl = (page: Page, label: string): Locator =>
  field(page, label).locator('input, select, textarea').first();

/**
 * The matrix labels its role columns `data-label={ROLES[role].label}` and
 * prints `PERMISSION_LABEL[permission]` in the Permission column — plain
 * words, not the raw codes, because nothing in this console shows a person a
 * spec code. These helpers take the code and look the wording up from
 * `lib/permissions.ts` rather than hardcoding it, so the tests keep naming
 * the thing that has meaning (`FINANCE`, `document.verify`) and a relabelling
 * pass moves both sides at once.
 */
const roleColumn = (role: RoleCode) => `td[data-label="${ROLES[role].label}"]`;

const moduleCell = (table: Locator, rowLabel: string, role: RoleCode) =>
  table
    .locator('tr')
    .filter({ has: table.page().locator('td[data-label="Screen group"]', { hasText: rowLabel }) })
    .locator(roleColumn(role));

const permissionRow = (table: Locator, permission: Permission) =>
  table.locator('tr').filter({
    has: table.page().locator('td[data-label="Permission"]', { hasText: PERMISSION_LABEL[permission] }),
  });

test.describe('control panel', () => {
  test('ADMIN toggling a module checkbox saves and shows a toast (round trip)', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin');

    const checkbox = page.getByTestId('module-rfq');
    const initial = await checkbox.isChecked();

    await checkbox.click();
    await expect(page.getByText('Configuration saved · audited')).toBeVisible();
    await expect(checkbox).toBeChecked({ checked: !initial });

    // Revert so this test (and everything downstream) is idempotent.
    await checkbox.click();
    await expect(checkbox).toBeChecked({ checked: initial });
  });

  test('ADMIN toggling an advance document requirement saves and shows a toast (round trip)', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin');

    const checkbox = page.getByLabel('Fitness certificate', { exact: true });
    const initial = await checkbox.isChecked();

    await checkbox.click();
    await expect(page.getByText('Configuration saved · audited')).toBeVisible();
    await expect(checkbox).toBeChecked({ checked: !initial });

    await checkbox.click();
    await expect(checkbox).toBeChecked({ checked: initial });
  });

  test('numbering series table renders the seeded series with an Edit action', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin');

    const rows = page.locator('table.table tbody tr');
    const trip = rows.filter({ hasText: 'TRIP' });
    await expect(trip.locator('td[data-label="Prefix"]')).toHaveText('TRP-');
    await expect(trip.getByRole('button', { name: 'Edit' })).toBeVisible();

    const invoice = rows.filter({ hasText: 'INVOICE' });
    await expect(invoice.locator('td[data-label="Prefix"]')).toHaveText('NEX-INV-');

    const client = rows.filter({ hasText: 'CLIENT' });
    await expect(client.locator('td[data-label="Prefix"]')).toHaveText('CLT-');
  });

  test('ADMIN can edit a numbering series next value', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin');

    // ISSUE is not consumed by any other spec, so this is safe to bump.
    const row = page.locator('table.table tbody tr').filter({ hasText: 'ISSUE' });
    await expect(row).toBeVisible();

    let next = '';
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Next value for ISSUE');
      next = String(Number(dialog.defaultValue()) + 1);
      await dialog.accept(next);
    });
    await row.getByRole('button', { name: 'Edit' }).click();

    await expect(page.getByText('ISSUE updated')).toBeVisible();
    await expect(row.locator('td[data-label="Next number"]')).toHaveText(`IS-${next.padStart(4, '0')}`);
  });

  test('LEADERSHIP (VIEW) gets every control disabled', async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/admin');

    await expect(page.getByTestId('view-only')).toBeVisible();
    await expect(page.getByTestId('module-rfq')).toBeDisabled();
    await expect(page.getByLabel('Fitness certificate', { exact: true })).toBeDisabled();

    const tripRow = page.locator('table.table tbody tr').filter({ hasText: 'TRIP' });
    await expect(tripRow.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(tripRow).toContainText('—');
  });
});

test.describe('approvals inbox', () => {
  test('ADMIN sees the queue as a read-only audit view', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin/approvals');

    const itemRows = page.locator('div.surface').filter({ has: page.locator('span.tag') });
    const count = await itemRows.count();
    if (count === 0) {
      await expect(page.getByText('Nothing is waiting on a decision.')).toBeVisible();
    } else {
      // ADMIN holds every module as EDIT (the sidebar shows the full
      // console), but `approve.*` is deliberately withheld from its grants —
      // no permission ADMIN holds ever matches an approval's
      // requiredPermission, so ADMIN can see every row but decide none.
      await expect(itemRows.first().getByRole('button', { name: 'Approve' })).toHaveCount(0);
      await expect(itemRows.first().getByText(/Decided by/)).toBeVisible();
      await expect(
        page.getByText('Administrators see the queue as an audit view. Approving is not an administrator action.'),
      ).toBeVisible();
    }
  });

  test('LEADERSHIP can validate the reject note requirement and decide a pending item', async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/admin/approvals');

    const decidable = page.locator('div.surface').filter({ has: page.getByRole('button', { name: 'Approve' }) });
    const before = await decidable.count();
    test.skip(
      before === 0,
      'No pending approval left for LEADERSHIP to decide in this dev-server session — the mock db has ' +
        'no reset endpoint, and every earlier local run against this server consumes one of the 4 seeded rows.',
    );

    const row = decidable.first();
    await row.getByRole('button', { name: 'Reject' }).click();
    const dialog = page.locator('div.surface').filter({ has: page.getByRole('heading', { name: 'Reject this request' }) });
    await expect(dialog).toBeVisible();
    const confirmReject = dialog.getByRole('button', { name: 'Reject', exact: true });
    await expect(confirmReject).toBeDisabled();
    await dialog.locator('textarea').fill('e2e validation check only');
    await expect(confirmReject).toBeEnabled();

    // Close without submitting — decide via Approve below instead, so this
    // test consumes exactly one pending row per run, not two.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/^Approved · .+ — the original action has been executed$/)).toBeVisible();
    await expect(decidable).toHaveCount(before - 1);
  });
});

test.describe('roles matrix', () => {
  test('renders the module grid and the named-permission grid matching lib/permissions.ts', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin/roles');

    const modules = page.locator('table.table').nth(0);
    await expect(moduleCell(modules, 'Client bills', 'FINANCE')).toHaveText('✓');
    await expect(moduleCell(modules, 'Client bills', 'BRANCH_MGR')).toHaveText('◐');
    await expect(moduleCell(modules, 'Client bills', 'ADMIN')).toHaveText('✓');
    await expect(moduleCell(modules, 'Settings', 'ADMIN')).toHaveText('✓');
    await expect(moduleCell(modules, 'Settings', 'LEADERSHIP')).toHaveText('◐');
    await expect(moduleCell(modules, 'Settings', 'OPS')).toHaveText('—');
    await expect(moduleCell(modules, 'Document checks', 'COMPLIANCE')).toHaveText('✓');
    await expect(moduleCell(modules, 'Document checks', 'FINANCE')).toHaveText('◐');

    const permissions = page.locator('table.table').nth(1);
    const paymentRelease = permissionRow(permissions, 'payment.release');
    await expect(paymentRelease.locator(roleColumn("FINANCE") + " input")).toBeChecked();
    await expect(paymentRelease.locator(roleColumn("OPS") + " input")).not.toBeChecked();
    await expect(paymentRelease.locator(roleColumn("FINANCE") + " input")).toBeDisabled(); // fixed, BR-40
    await expect(paymentRelease.locator('td[data-label="Movable"]')).toHaveText('Fixed');

    const rfqSubmit = permissionRow(permissions, 'rfq.submit');
    await expect(rfqSubmit.locator(roleColumn("LEADERSHIP") + " input")).toBeChecked();
    await expect(rfqSubmit.locator(roleColumn("OPS") + " input")).not.toBeChecked();
    await expect(rfqSubmit.locator('td[data-label="Movable"]')).toHaveText('Fixed');

    const indentCreate = permissionRow(permissions, 'indent.create');
    await expect(indentCreate.locator(roleColumn("BRANCH_MGR") + " input")).toBeChecked();
    await expect(indentCreate.locator(roleColumn("FINANCE") + " input")).not.toBeChecked();
    await expect(indentCreate.locator('td[data-label="Movable"]')).toHaveText('Any role');
  });

  test('ADMIN can grant and revoke a non-fixed permission (round trip)', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin/roles');

    const permissions = page.locator('table.table').nth(1);
    // document.verify on BRANCH_MGR is untouched by every other test in this
    // suite, so this toggle cannot race the cross-check assertions above.
    const cell = permissionRow(permissions, 'document.verify').locator(roleColumn("BRANCH_MGR") + " input");
    await expect(cell).not.toBeChecked();

    // The toast names both in plain words now, so it is built from the same
    // maps the page renders from rather than restating them.
    const verifyDocs = PERMISSION_LABEL['document.verify'];
    const branchMgr = ROLES.BRANCH_MGR.label;

    await cell.click();
    await expect(page.getByText(`${verifyDocs} granted to ${branchMgr} · audited`)).toBeVisible();
    await expect(cell).toBeChecked();

    await cell.click();
    await expect(page.getByText(`${verifyDocs} removed from ${branchMgr} · audited`)).toBeVisible();
    await expect(cell).not.toBeChecked();
  });

  test('LEADERSHIP (VIEW) gets a read-only matrix', async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/admin/roles');

    await expect(page.getByText('Read-only. Editing the matrix is an administrator action.')).toBeVisible();
    const permissions = page.locator('table.table').nth(1);
    await expect(permissionRow(permissions, 'indent.create').locator(roleColumn("OPS") + " input")).toBeDisabled();
  });
});

test.describe('go-live import', () => {
  test('ADMIN sees the three ordered sets and the seeded import history', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin/import');

    const setOptions = fieldControl(page, 'Set').locator('option');
    await expect(setOptions).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Run dry run' })).toBeEnabled();

    const row = page.locator('table.table tbody tr').filter({ hasText: 'clients-2026-08.csv' });
    await expect(row.locator('td[data-label="Rows"]')).toHaveText('38');
    await expect(row.locator('td[data-label="Rejected"]')).toHaveText('0');
    await expect(row.locator('td[data-label="Actor"]')).toHaveText('S. Krishnan');
    await expect(row.locator('td[data-label="Status"]')).toContainText('COMMITTED');
  });

  test('LEADERSHIP (VIEW) cannot start an import', async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/admin/import');

    await expect(fieldControl(page, 'Set')).toBeDisabled();
    await expect(fieldControl(page, 'CSV file')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Run dry run' })).toBeDisabled();
  });
});
