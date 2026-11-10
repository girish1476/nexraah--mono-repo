import { describe, expect, it, vi } from 'vitest';
import { DomainException } from '../../common/domain-exception';
import { asPortalLoginRefusal, temporaryPassword, VendorPortalAccountService } from './vendor-portal-account.service';

describe('a transporter’s portal login', () => {
  it('gets a twelve-character password with nothing that reads two ways', () => {
    for (let i = 0; i < 50; i++) {
      const p = temporaryPassword();
      expect(p).toMatch(/^[a-zA-Z2-9]{12}$/);
      expect(p).not.toMatch(/[01lIoO]/);
    }
  });

  it('answers the database’s refusals in words, and lets anything else through', () => {
    const refused = (message: string) => {
      try {
        asPortalLoginRefusal(new Error(message));
      } catch (e) {
        return e;
      }
    };
    const taken = refused('error: PORTAL_LOGIN_EMAIL_TAKEN') as DomainException;
    expect(taken).toBeInstanceOf(DomainException);
    expect(taken.getStatus()).toBe(409);
    expect(taken.getResponse()).toMatchObject({ code: 'PORTAL_LOGIN_EMAIL_TAKEN', message: expect.stringMatching(/already signs in/) });
    expect((refused('error: PORTAL_LOGIN_NONE') as DomainException).getResponse()).toMatchObject({ code: 'PORTAL_LOGIN_NONE' });
    const other = refused('connection reset');
    expect(other).not.toBeInstanceOf(DomainException);
  });

  describe('on activation', () => {
    const withVendor = (email: string | null) => {
      const db = {
        selectFrom: () => ({ select: () => ({ where: () => ({ executeTakeFirst: async () => ({ email }) }) }) }),
      };
      const svc = new VendorPortalAccountService(db as never, { record: vi.fn() } as never);
      return svc;
    };
    const actor = { userId: 'u', role: 'COMPLIANCE' } as never;

    it('leaves a transporter that already has a login alone', async () => {
      const svc = withVendor('a@b.in');
      vi.spyOn(svc, 'loginEmail').mockResolvedValue('a@b.in');
      const create = vi.spyOn(svc, 'create');
      expect(await svc.provision('v1', actor)).toEqual({ provisioned: true, reason: 'ALREADY_HAS_LOGIN' });
      expect(create).not.toHaveBeenCalled();
    });

    it('says so when there is no email to make one with — the console makes it then', async () => {
      const svc = withVendor(null);
      vi.spyOn(svc, 'loginEmail').mockResolvedValue(null);
      expect(await svc.provision('v1', actor)).toEqual({ provisioned: false, reason: 'NO_EMAIL' });
    });

    it('makes one from the transporter’s email, and reports whether it was emailed', async () => {
      const svc = withVendor('ops@roadlines.in');
      vi.spyOn(svc, 'loginEmail').mockResolvedValue(null);
      vi.spyOn(svc, 'create').mockResolvedValue({ email: 'ops@roadlines.in', temporaryPassword: 'x', emailed: false });
      expect(await svc.provision('v1', actor)).toEqual({ provisioned: true, email: 'ops@roadlines.in', emailed: false });
    });

    it('never fails the activation: a refusal is reported, not thrown', async () => {
      const svc = withVendor('staff@nexraah.com');
      vi.spyOn(svc, 'loginEmail').mockResolvedValue(null);
      vi.spyOn(svc, 'create').mockRejectedValue(new DomainException(409, 'PORTAL_LOGIN_STAFF_EMAIL', 'staff'));
      expect(await svc.provision('v1', actor)).toEqual({ provisioned: false, reason: 'PORTAL_LOGIN_STAFF_EMAIL' });
    });
  });
});
