'use client';

import Link from 'next/link';

/**
 * The two things "Check POD status" narrows down to, shared by both pages
 * behind it (`/pod/pending`, `/pod/receiving`) so either one is a click away
 * from the other. Real navigation, not a same-page filter switch — the two
 * registers are backed by different endpoints (`getPending` vs
 * `getReceiving`), so this is a `.stage-tabs`-styled pair of links rather
 * than `StageTabs`, which only ever changes local state.
 *
 * "Hard copy pending" is every delivered trip whose signed paper has not been
 * logged as received, of any age — the overdue ones are the same list read
 * with the ageing filter, not a different screen. It was "Delivery proof past
 * due" and showed only the overdue slice, which nobody could tell from its
 * name was about paper.
 *
 * Neither tab is `is-active` on the bare, unfiltered `/pod/pending` — that
 * view is "Check POD status" itself, the landing page these two narrow from.
 */
export function PodTabs({ active }: { active: 'hard-copy' | 'epod' | null }) {
  return (
    <div className="stage-tabs" role="tablist">
      <Link
        href="/pod/pending?copy=pending"
        role="tab"
        aria-selected={active === 'hard-copy'}
        className={active === 'hard-copy' ? 'stage-tab is-active' : 'stage-tab'}
      >
        <span className="glyph" aria-hidden>
          📄
        </span>
        Hard copy pending
      </Link>
      <Link
        href="/pod/receiving?attached=1"
        role="tab"
        aria-selected={active === 'epod'}
        className={active === 'epod' ? 'stage-tab is-active' : 'stage-tab'}
      >
        <span className="glyph" aria-hidden>
          📸
        </span>
        E-POD pending
      </Link>
    </div>
  );
}
