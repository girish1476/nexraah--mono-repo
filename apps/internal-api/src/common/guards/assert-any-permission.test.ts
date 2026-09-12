import { describe, it, expect } from 'vitest';
import { assertAnyPermission } from './assert-any-permission';
import { DomainException } from '../domain-exception';
import type { AuthenticatedUser, PermissionLevel } from '../interfaces/authenticated-user.interface';

const user = (grants: Record<string, PermissionLevel>): AuthenticatedUser => ({
  userId: 'u1',
  authUserId: 'a1',
  name: 'Test',
  email: 't@example.com',
  role: 'OPS',
  branch: null,
  permissions: new Map(Object.entries(grants)),
});

describe('assertAnyPermission — the "any one of these" the decorator cannot say', () => {
  it('passes when one of the codes is held at EDIT', () => {
    expect(() =>
      assertAnyPermission(user({ 'pod.verify': 'EDIT' }), ['document.verify', 'pod.verify', 'indent.manage']),
    ).not.toThrow();
  });

  it('refuses with PERMISSION_DENIED when none is held', () => {
    let caught: unknown;
    try {
      assertAnyPermission(user({ 'indent.view': 'EDIT' }), ['document.verify', 'indent.manage']);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DomainException);
    expect((caught as DomainException).getStatus()).toBe(403);
    expect((caught as DomainException).getResponse()).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('treats VIEW as not enough for an EDIT gate, the way PermissionsGuard does', () => {
    expect(() => assertAnyPermission(user({ 'indent.manage': 'VIEW' }), ['indent.manage'])).toThrow(DomainException);
    expect(() => assertAnyPermission(user({ 'indent.manage': 'VIEW' }), ['indent.manage'], 'VIEW')).not.toThrow();
  });

  it('names every code it looked for, so the refusal is actionable', () => {
    expect(() => assertAnyPermission(user({}), ['document.verify', 'indent.manage'])).toThrow(
      /document\.verify or indent\.manage/,
    );
  });
});
