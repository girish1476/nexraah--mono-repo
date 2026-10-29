import { describe, expect, it } from 'vitest';
import { EVENTS, renderEvent } from './notification-events';
import { renderNotificationEmail } from './notification-email';
import { podRemindersDue } from './pod-reminders';
import { smsTemplates } from './sms';

describe('what each notification says', () => {
  it('every event renders a subject, a title, a body, a link and SMS values', () => {
    for (const event of EVENTS) {
      const r = renderEvent(event, {});
      expect(r.subject.length, event).toBeGreaterThan(5);
      expect(r.title.length, event).toBeGreaterThan(3);
      expect(r.body.length, event).toBeGreaterThan(3);
      expect(r.path.startsWith('/'), event).toBe(true);
      expect(Array.isArray(r.sms), event).toBe(true);
    }
  });

  it('an award names the load, the route, the rate and the pickup, and opens the trip', () => {
    const r = renderEvent('quote.awarded', {
      loadCode: '4471',
      route: 'Bengaluru → Chennai',
      amountPaise: 3_050_000,
      pickupDate: '2026-10-31',
      tripId: 't-1',
    });
    expect(r.title).toBe('Load 4471 awarded to you');
    expect(r.body).toContain('Bengaluru → Chennai at ₹30,500');
    expect(r.body).toContain('31 Oct 2026');
    expect(r.path).toBe('/trips/t-1');
  });

  it('a payment gives the amount and the UTR', () => {
    const r = renderEvent('payment.released', { kind: 'BALANCE', amountPaise: 1_830_000, tripCode: '120881', utr: 'HDFC26103012', valueDate: '2026-10-29', tripId: 't-9' });
    expect(r.title).toBe('Balance paid: ₹18,300');
    expect(r.body).toContain('UTR HDFC26103012');
    expect(r.sms).toEqual(['Balance', '₹18,300', '120881', 'HDFC26103012']);
  });

  it('the email carries the message and one link, and escapes what it is given', () => {
    const r = renderEvent('pod.rejected', { tripCode: '120881', reason: 'Seal <broken>', tripId: 't-9' });
    const email = renderNotificationEmail({ rendered: r, url: 'https://portal.example/trips/t-9/pod', to: 'raj@sharma.in', place: 'Transporter portal' });
    expect(email.subject).toBe('Proof of delivery not accepted — trip 120881');
    expect(email.html).toContain('href="https://portal.example/trips/t-9/pod"');
    expect(email.html).toContain('Seal &lt;broken&gt;');
    expect(email.html).not.toContain('<broken>');
    expect(email.text).toContain('Open: https://portal.example/trips/t-9/pod');
  });

  it('without a site address the email has no button rather than a broken link', () => {
    const email = renderNotificationEmail({ rendered: renderEvent('vendor.activated', {}), url: null, to: 'a@b.in', place: 'Transporter portal' });
    expect(email.html).not.toContain('href=');
    expect(email.text).not.toContain('Open:');
  });
});

describe('POD reminders', () => {
  const clock = { tatDays: 20, forfeitDays: 40 };
  const trip = { id: 't-1', deliveredAt: '2026-10-01T10:00:00+05:30' };
  const on = (date: string) => new Date(`${date}T09:00:00+05:30`);
  const events = (date: string) => podRemindersDue(trip, on(date), clock).map((r) => r.key);

  it('nothing before day 15', () => {
    expect(events('2026-10-14')).toEqual([]);
  });

  it('due on day 15, and still due up to the deadline — a missed sweep catches up, a repeated one adds nothing', () => {
    expect(events('2026-10-16')).toEqual(['pod.due:t-1']);
    expect(events('2026-10-20')).toEqual(['pod.due:t-1']);
    expect(podRemindersDue(trip, on('2026-10-16'), clock)[0].dueOn).toBe('2026-10-21');
  });

  it('on the deadline itself, nothing new; overdue from the day after, a fresh reminder each week', () => {
    expect(events('2026-10-21')).toEqual([]);
    expect(events('2026-10-22')).toEqual(['pod.breached:t-1:0']);
    expect(events('2026-10-28')).toEqual(['pod.breached:t-1:0']);
    expect(events('2026-10-29')).toEqual(['pod.breached:t-1:1']);
  });

  it('the forfeit warning from day 35, and nothing once forfeited', () => {
    expect(events('2026-11-05')).toEqual(['pod.breached:t-1:2', 'pod.forfeit_warning:t-1']);
    expect(podRemindersDue(trip, on('2026-11-05'), clock)[1].forfeitOn).toBe('2026-11-10');
    expect(events('2026-11-10')).toEqual([]);
  });
});

describe('SMS templates', () => {
  it('only events with a registered template, and bad settings count as none', () => {
    expect(smsTemplates({ SMS_TEMPLATES: '{"payment.released":"1207161234","pod.due":""}' })).toEqual({ 'payment.released': '1207161234' });
    expect(smsTemplates({ SMS_TEMPLATES: 'not json' })).toEqual({});
    expect(smsTemplates({})).toEqual({});
  });
});
