import { Page } from '@playwright/test';
import { RoleCode } from '../src/lib/permissions';

/** Sets the prototype role switcher's localStorage key before first navigation. */
export async function setRole(page: Page, role: RoleCode) {
  await page.addInitScript((r) => window.localStorage.setItem('role', r), role);
}
