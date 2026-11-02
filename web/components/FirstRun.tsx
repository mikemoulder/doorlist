'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Mark } from './Logo';
import { useWallet } from '@/lib/wallet';

/** A whole-screen empty state: the doorway, what this screen will hold, the first action, and the real
 *  steps that lead to it. Keeps the frame and the title; never shows sample data. */
export function FirstRun({ title, line, actions, steps }: { title: string; line: ReactNode; actions: ReactNode; steps: { title: string; line: string }[] }) {
  return (
    <section className="card first" aria-labelledby="first-h">
      <div className="first-main">
        <span className="first-door" aria-hidden="true">
          <Mark size={34} />
        </span>
        <h2 id="first-h">{title}</h2>
        <p>{line}</p>
        <div className="first-actions">{actions}</div>
      </div>
      <ol className="first-steps" aria-label="How it goes">
        {steps.map((s) => (
          <li key={s.title}>
            <span className="first-bullet" aria-hidden="true" />
            <span>
              <strong>{s.title}</strong>
              <span>{s.line}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Sign in, or, with no wallet in this browser, where to get one. */
export function SignInAction({ label = 'Sign in' }: { label?: string }) {
  const { wallets, connect, connecting } = useWallet();
  if (!wallets.length)
    return (
      <a className="pill pill-primary pill-lg" href="https://www.subwallet.app/" target="_blank" rel="noreferrer">
        Get SubWallet to sign in
      </a>
    );
  return (
    <button className="pill pill-primary pill-lg" onClick={() => connect()} disabled={connecting}>
      {connecting ? 'Opening wallet…' : label}
    </button>
  );
}

export function GhostLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="pill pill-ghost pill-lg" href={href}>
      {children}
    </Link>
  );
}

export const ORGANIZER_STEPS = [
  { title: 'Create the event', line: 'Name, date, price in dUSD or POT, capacity and a picture. About two minutes.' },
  { title: 'Approve your door phones', line: 'Any phone with a camera becomes a scanner for this one event.' },
  { title: 'Get paid after the show', line: 'Ticket money is released 24 hours after doors open, less 3%. Cancel before then and every buyer is refunded.' },
];

export const GUEST_STEPS = [
  { title: 'Buy from your wallet', line: 'Pay in dUSD. The ticket is issued to your wallet on Portaldot.' },
  { title: 'Approve this phone, once', line: 'After that it shows a code that signs itself again every 10 seconds.' },
  { title: 'Show it at the door', line: 'The door checks Portaldot and lets each ticket in once. Screenshots are refused.' },
];
