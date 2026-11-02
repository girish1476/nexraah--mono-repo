import { describe, expect, it } from 'vitest';
import { codeRequestMessage } from './auth';

/**
 * What the sign-in screen says when Supabase will not send a code.
 *
 * Found on the first real backend: an allowed administrator was told "not
 * allowed to sign in" because the project's hourly email limit had been
 * reached, and every 400/422 was read as "no login for this email".
 */
describe('why a sign-in code was not sent', () => {
  const NOT_ALLOWED = /not allowed to sign in/i;

  it('says "not allowed" only when there is no login for the email', () => {
    expect(codeRequestMessage(422, 'otp_disabled', { msg: 'Signups not allowed for otp' })).toMatch(NOT_ALLOWED);
    expect(codeRequestMessage(400, 'user_not_found', null)).toMatch(NOT_ALLOWED);
    expect(codeRequestMessage(422, 'signup_disabled', null)).toMatch(NOT_ALLOWED);
  });

  it('gives the one-a-minute wait Supabase names', () => {
    const msg = codeRequestMessage(429, 'over_email_send_rate_limit', {
      msg: 'For security purposes, you can only request this after 42 seconds.',
    });
    expect(msg).toBe('A code was sent very recently. Wait 42 seconds, then ask for another.');
  });

  it('does not blame the person for the project-wide email limit', () => {
    const msg = codeRequestMessage(429, 'over_email_send_rate_limit', { msg: 'Email rate limit exceeded' });
    expect(msg).not.toMatch(NOT_ALLOWED);
    expect(msg).toMatch(/wait a few minutes/i);
  });

  it('reads a failed email hook as a sending problem, not a permission one', () => {
    expect(codeRequestMessage(422, 'hook_timeout', { msg: 'Failed to reach hook within maximum time' })).toMatch(
      /could not be sent just now/i,
    );
    expect(codeRequestMessage(500, 'unexpected_failure', null)).toMatch(/could not be sent just now/i);
  });

  it('passes any other refusal through in Supabase’s own words', () => {
    expect(codeRequestMessage(400, 'validation_failed', { msg: 'Unable to validate email address: invalid format' })).toBe(
      'Unable to validate email address: invalid format',
    );
  });
});
