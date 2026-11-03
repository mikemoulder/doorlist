'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { isAddress, parseEther, type Address } from 'viem';
import { AppShell } from '@/components/AppShell';
import { FirstRun, GhostLink, ORGANIZER_STEPS, SignInAction } from '@/components/FirstRun';
import { Cover, DoorsBar, StatusTag, useMedia } from '@/components/EventBits';
import { CreateEvent } from '@/components/CreateEvent';
import { getCheckIns, getEvents, isDoor, PAYOUT_DELAY, FEE_BPS, type DoorEvent } from '@/lib/doorlist';
import { money, relative, when } from '@/lib/format';
import { explain, useWallet } from '@/lib/wallet';

export default function OrganizePage() {
  const { address } = useWallet();
  const [events, setEvents] = useState<DoorEvent[]>();
  const [selected, setSelected] = useState<number>();
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState<{ name?: string; currency?: 'dUSD' | 'POT' }>({});

  // Arriving from the landing page's "Name your event": open the form with that name.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const name = q.get('name');
    if (name) {
      setPrefill({ name, currency: q.get('currency') === 'POT' ? 'POT' : 'dUSD' });
      setCreating(true);
    }
  }, []);

  const load = useCallback(() => {
    if (!address) return;
    getEvents().then((all) => {
      const mine = all.filter((e) => e.organizer.toLowerCase() === address.toLowerCase()).sort((a, b) => b.startsAt - a.startsAt);
      setEvents(mine);
      setSelected((s) => (s !== undefined && mine.some((e) => e.id === s) ? s : mine[0]?.id));
    });
  }, [address]);
  useEffect(load, [load]);

  const current = events?.find((e) => e.id === selected);
  return (
    <AppShell>
      <div className="a-title">
        <div>
          <h1>Organize</h1>
          <p>{events ? `${events.length} event${events.length === 1 ? '' : 's'} created from this wallet` : 'Create events and run the door.'}</p>
        </div>
        {address && !creating && (
          <button className="pill pill-primary" onClick={() => setCreating(true)}>
            <Plus size={15} strokeWidth={1.5} aria-hidden="true" /> Create event
          </button>
        )}
      </div>

      {!address ? (
        <FirstRun
          title="Sell tickets on Doorlist"
          line="Sign in with the wallet you organize with. Listing an event has no Doorlist fee; Portaldot holds a small storage deposit."
          actions={
            <>
              <SignInAction />
              <GhostLink href="/#pricing">See the fees</GhostLink>
            </>
          }
          steps={ORGANIZER_STEPS}
        />
      ) : creating ? (
        <CreateEvent
          initial={prefill}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
            load();
          }}
        />
      ) : !events ? (
        <p className="faint">Loading your events…</p>
      ) : events.length === 0 ? (
        <FirstRun
          title="Create your first event"
          line="It takes about two minutes and has no Doorlist fee; Portaldot holds a small storage deposit."
          actions={
            <button className="pill pill-primary pill-lg" onClick={() => setCreating(true)}>
              Create your first event
            </button>
          }
          steps={ORGANIZER_STEPS}
        />
      ) : (
        <>
          {events.length > 1 && (
            <div className="seg" role="group" aria-label="Choose an event" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
              {events.map((e) => (
                <button key={e.id} aria-pressed={e.id === selected} onClick={() => setSelected(e.id)}>
                  {e.name}
                </button>
              ))}
            </div>
          )}
          {current && <EventOverview e={current} onChange={load} />}
        </>
      )}
    </AppShell>
  );
}

function EventOverview({ e, onChange }: { e: DoorEvent; onChange: () => void }) {
  const media = useMedia(e);
  const [checkedIn, setCheckedIn] = useState<number>();
  useEffect(() => {
    getCheckIns(e.id).then(setCheckedIn);
  }, [e]);
  const now = Date.now() / 1000;
  const payoutAt = e.startsAt + PAYOUT_DELAY;
  const fee = (e.escrowed * BigInt(FEE_BPS)) / 10000n;
  const d = when(e.startsAt);

  return (
    <div className="org-grid">
      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <div className="kpis" style={{ ['--n' as string]: 4 }}>
          <div>
            <div className="kpi-label">Sold</div>
            <div className="kpi-value">
              {e.sold}
              <small>/ {e.capacity}</small>
            </div>
            <div className="kpi-note">{e.capacity - e.sold} left</div>
          </div>
          <div>
            <div className="kpi-label">Checked in</div>
            <div className="kpi-value">{checkedIn ?? '—'}</div>
            <div className="kpi-note">of {e.sold} sold</div>
          </div>
          <div>
            <div className="kpi-label">Held for you</div>
            <div className="kpi-value">{money(e.escrowed, e.currency)}</div>
            <div className="kpi-note">You get {money(e.escrowed - fee, e.currency)} after the 3% fee</div>
          </div>
          <div>
            <div className="kpi-label">Payout opens</div>
            <div className="kpi-value" style={{ fontSize: 20 }}>{e.cancelled ? '—' : relative(payoutAt, now)}</div>
            <div className="kpi-note num">{e.cancelled ? 'Cancelled: holders refund themselves' : `${when(payoutAt).day}, ${when(payoutAt).time}`}</div>
          </div>
        </div>

        <section className="card">
          <div className="card-h">
            <h2>Doors against capacity</h2>
            <span className="meta">
              {d.day}, {d.time}
            </span>
          </div>
          <DoorsBar e={e} checkedIn={checkedIn} />
        </section>

        <Doors e={e} />
      </div>

      <div className="ev-side">
        <section className="card" style={{ display: 'grid', gap: 14 }}>
          <Cover e={e} media={media} ratio="16 / 9" />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
            <Link href={`/event/?id=${e.id}`} className="ev-name" style={{ textDecoration: 'none' }}>
              {e.name}
            </Link>
            <StatusTag e={e} />
          </div>
          <p className="faint" style={{ fontSize: 13 }}>
            Share this link: <span className="id">{typeof window !== 'undefined' ? `${location.origin}/event/?id=${e.id}` : ''}</span>
          </p>
        </section>
        <Money e={e} now={now} onChange={onChange} />
      </div>
    </div>
  );
}

function Doors({ e }: { e: DoorEvent }) {
  const { write, sendValue } = useWallet();
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  async function approve() {
    const door = addr.trim() as Address;
    setMsg(undefined);
    try {
      if (!(await isDoor(e.id, door))) {
        setBusy('Approving door…');
        await write('setDoor', [BigInt(e.id), door, true]);
      }
      setBusy('Sending 1 POT for check-in fees…');
      await sendValue(door, parseEther('1'));
      setMsg({ ok: true, text: 'Door approved and funded. On that phone, tap Check again.' });
      setAddr('');
    } catch (err) {
      setMsg({ ok: false, text: explain(err) });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="card">
      <div className="card-h">
        <h2>Doors</h2>
        <Link className="meta link" href={`/door/?event=${e.id}`}>
          Open the scanner on this device
        </Link>
      </div>
      <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
        On each door phone, open Doorlist → Door and pick this event. Paste the address it shows to approve it. Each door gets 1 POT for its check-in fees.
      </p>
      <form
        className="sell"
        style={{ gridTemplateColumns: 'minmax(0,1fr) auto', marginTop: 0 }}
        onSubmit={(x) => {
          x.preventDefault();
          approve();
        }}
      >
        <label className="sr-only" htmlFor="door">
          Door address
        </label>
        <input id="door" className="input id" placeholder="Door address 0x…" value={addr} onChange={(x) => setAddr(x.target.value)} />
        <button className="pill pill-primary" disabled={!!busy || !isAddress(addr.trim()) || e.cancelled}>
          {busy ?? 'Approve door'}
        </button>
      </form>
      {msg && (
        <p className={`notice ${msg.ok ? '' : 'notice-error'}`} style={{ marginTop: 12 }}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

function Money({ e, now, onChange }: { e: DoorEvent; now: number; onChange: () => void }) {
  const { write } = useWallet();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState('');
  const canWithdraw = !e.cancelled && now >= e.startsAt + PAYOUT_DELAY && e.escrowed > 0n;
  const canCancel = !e.cancelled && now < e.startsAt + PAYOUT_DELAY;

  async function run(label: string, fn: string) {
    setBusy(label);
    setError(undefined);
    try {
      await write(fn, [BigInt(e.id)]);
      onChange();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="card" style={{ display: 'grid', gap: 14 }}>
      <div className="card-h" style={{ marginBottom: 0 }}>
        <h2>Payout</h2>
        <button className="pill pill-ghost" onClick={onChange} aria-label="Refresh">
          <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <button className="pill pill-primary" disabled={!canWithdraw || !!busy} onClick={() => run('Withdrawing…', 'withdraw')}>
        {busy === 'Withdrawing…' ? busy : canWithdraw ? `Withdraw ${money(e.escrowed - (e.escrowed * 3n) / 100n, e.currency)}` : e.cancelled ? 'Cancelled events can’t pay out' : `Withdraw opens ${relative(e.startsAt + PAYOUT_DELAY, now)}`}
      </button>
      {canCancel && (
        <details className="danger">
          <summary>Cancel this event</summary>
          <p className="muted" style={{ fontSize: 14 }}>
            Sales and check-ins stop for good, you can never withdraw, and all {e.sold} ticket holders can take back {money(e.price, e.currency)} each. Type the event’s name to confirm.
          </p>
          <input className="input" value={confirm} onChange={(x) => setConfirm(x.target.value)} aria-label="Type the event name to confirm" placeholder={e.name} />
          <button className="pill pill-danger" disabled={confirm !== e.name || !!busy} onClick={() => run('Cancelling…', 'cancelEvent')}>
            {busy === 'Cancelling…' ? busy : `Cancel ${e.name}`}
          </button>
        </details>
      )}
      {error && <p className="notice notice-error">{error}</p>}
    </section>
  );
}
