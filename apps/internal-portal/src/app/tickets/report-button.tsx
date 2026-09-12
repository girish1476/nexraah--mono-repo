'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/apis';
import { Dialog, Field, Stack, useToast } from '@/lib/ui';
import { raiseTicket } from './apis';
import {
  MIN_DETAIL,
  MIN_SUBJECT,
  TICKET_KIND_LABEL,
  TICKET_SEVERITY_LABEL,
  TicketKind,
  TicketSeverity,
} from './types';

const KINDS = Object.keys(TICKET_KIND_LABEL) as TicketKind[];
const SEVERITIES = Object.keys(TICKET_SEVERITY_LABEL) as TicketSeverity[];

/**
 * "Report a problem" — the same control on every screen in the console.
 *
 * Asked for directly: "Ticketing should be available for every dashboard."
 * It sits in the shell rather than being added page by page, because a screen
 * that forgot it is exactly the screen somebody will be standing on when they
 * find something wrong.
 *
 * The one thing it does that a support email cannot: it captures **where the
 * person was**. A report that says "the rate is wrong" is unactionable; one
 * that arrives carrying `/clients/rate-changes` and the record id is a job an
 * administrator can pick up. The reporter never types it.
 */
export function ReportProblemButton({
  entityType,
  entityId,
}: {
  entityType?: string;
  entityId?: string;
}) {
  const pathname = usePathname() ?? '';
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const [kind, setKind] = useState<TicketKind>('WRONG_DATA');
  const [severity, setSeverity] = useState<TicketSeverity>('NORMAL');

  const problem = (() => {
    if (subject.trim().length < MIN_SUBJECT) return 'Give it a short title.';
    if (detail.trim().length < MIN_DETAIL) {
      return `Say what is wrong in at least ${MIN_DETAIL} characters — enough for somebody who was not looking at your screen.`;
    }
    return null;
  })();

  const submit = async () => {
    setBusy(true);
    try {
      const ticket = await raiseTicket({
        subject: subject.trim(),
        detail: detail.trim(),
        kind,
        severity,
        raisedOnPath: pathname,
        entityType,
        entityId,
      });
      toast(`Reported as ${ticket.code}. You can follow it on Tickets.`);
      setOpen(false);
      setSubject('');
      setDetail('');
      setKind('WRONG_DATA');
      setSeverity('NORMAL');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        🎫 Report a problem
      </button>

      <Dialog
        open={open}
        title="Report a problem with this screen"
        confirmLabel="Send report"
        confirmDisabled={Boolean(problem)}
        busy={busy}
        onConfirm={submit}
        onClose={() => setOpen(false)}
      >
        <Stack gap={14}>
          <div className="hint">
            This goes to Administration with the screen you are on — <code>{pathname}</code> — so
            they can find what you are looking at. You do not need to describe where you are.
          </div>

          <Field label="What kind of problem?">
            <select value={kind} onChange={(e) => setKind(e.target.value as TicketKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {TICKET_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="In one line" required>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Client name is spelt wrong on this bill"
              autoFocus
            />
          </Field>

          <Field
            label="What is wrong, and what should it say?"
            required
            hint="Whoever picks this up cannot see your screen. The record, the field and the right value is usually enough."
            error={problem ?? undefined}
          >
            <textarea
              rows={4}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="e.g. On invoice NEX-INV-000214 the client reads Bergar Paints. It should be Berger Paints, as on CLT-0092."
            />
          </Field>

          <Field label="How much is it holding you up?">
            <select value={severity} onChange={(e) => setSeverity(e.target.value as TicketSeverity)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {TICKET_SEVERITY_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        </Stack>
      </Dialog>
    </>
  );
}
