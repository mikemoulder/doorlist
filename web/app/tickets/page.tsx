'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { QrCode, Tag, Undo2 } from 'lucide-react';
import { parseUnits } from 'viem';
import { AppShell } from '@/components/AppShell';
import { Cover, useMedia } from '@/components/EventBits';
import { getEvent, getTicketsOf, phase, type DoorEvent, type Ticket } from '@/lib/doorlist';
import { price, relative, when } from '@/lib/format';
import { explain, useWallet } from '@/lib/wallet';

type Row = { t: Ticket; e: DoorEvent };

export default function TicketsPage() {
  const { address, connect } = useWallet();
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    if (!address) return;
    setError(undefined);
    getTicketsOf(address)
      .then(async (ts) => {
        const events = new Map<number, DoorEvent>();
        for (const id of new Set(ts.map((t) => t.eventId))) events.set(id, await getEvent(id));
        setRows(ts.map((t) => ({ t, e: events.get(t.eventId)! })).sort((a, b) => a.e.startsAt - b.e.startsAt));
      })
      .catch(() => setError('Couldn’t reach Portaldot.'));
  }, [address]);
  useEffect(load, [load]);

  const upcoming = rows?.filter((r) => !r.t.used && !r.e.cancelled && phase(r.e) !== 'past') ?? [];
  const refundable = rows?.filter((r) => r.e.cancelled && !r.t.refunded) ?? [];
  const done = rows?.filter((r) => !upcoming.includes(r) && !refundable.includes(r)) ?? [];

  return (
    <AppShell>
      <div className="a-title">
        <div>
          <h1>My tickets</h1>
          <p>{rows ? `${upcoming.length} coming up${refundable.length ? ` · ${refundable.length} to refund` : ''}` : 'Tickets held by your wallet.'}</p>
        </div>
      </div>

      {!address ? (
        <div className="card first-run">
          <p>Sign in with the wallet you bought with, and your tickets appear here.</p>
          <button className="pill pill-primary" onClick={() => connect()}>
            Sign in
          </button>
        </div>
      ) : error ? (
        <p className="notice notice-error">
          {error}{' '}
          <button className="link" onClick={load}>
            Try again
          </button>
        </p>
      ) : !rows ? (
        <p className="faint">Loading your tickets…</p>
      ) : rows.length === 0 ? (
        <div className="card first-run">
          <p>No tickets in this wallet yet.</p>
          <Link className="pill pill-primary" href="/events/">
            Find an event
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {refundable.length > 0 && <Group title="Refunds waiting" rows={refundable} onChange={load} />}
          {upcoming.length > 0 && <Group title="Coming up" rows={upcoming} onChange={load} />}
          {done.length > 0 && <Group title="Past and used" rows={done} onChange={load} />}
        </div>
      )}
    </AppShell>
  );
}

function Group({ title, rows, onChange }: { title: string; rows: Row[]; onChange: () => void }) {
  return (
    <section className="card" style={{ padding: '16px 20px 6px' }}>
      <div className="card-h" style={{ marginBottom: 4 }}>
        <h2>{title}</h2>
        <span className="meta num">{rows.length}</span>
      </div>
      <ul className="rows">
        {rows.map((r) => (
          <TicketRow key={r.t.id} {...r} onChange={onChange} />
        ))}
      </ul>
    </section>
  );
}

function TicketRow({ t, e, onChange }: Row & { onChange: () => void }) {
  const media = useMedia(e.uri);
  const { write } = useWallet();
  const [selling, setSelling] = useState(false);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const d = when(e.startsAt);

  async function run(fn: string, args: unknown[]) {
    setBusy(true);
    setError(undefined);
    try {
      await write(fn, args);
      setSelling(false);
      onChange();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  let status;
  if (t.refunded) status = <span className="tag tag-neutral">Refunded</span>;
  else if (e.cancelled) status = <span className="tag tag-neg">Cancelled</span>;
  else if (t.used) status = <span className="tag tag-neutral">Scanned</span>;
  else if (t.askPrice > 0n) status = <span className="tag tag-warn">For sale · {price(t.askPrice, e.currency)}</span>;
  else status = <span className="tag tag-pos">Ready</span>;

  return (
    <li className="tk-row">
      <span className="ev-thumb">
        <Cover e={e} media={media} ratio="4 / 3" />
      </span>
      <span className="ev-main">
        <Link href={`/event/?id=${e.id}`} className="ev-name" style={{ textDecoration: 'none' }}>
          {e.name}
        </Link>
        <span className="ev-sub num">
          {d.day}, {d.time} · {relative(e.startsAt)} · <span className="id">#{t.id}</span>
        </span>
        {error && <span className="notice notice-error" style={{ marginTop: 8 }}>{error}</span>}
        {selling && (
          <form
            className="sell"
            onSubmit={(x) => {
              x.preventDefault();
              run('list', [BigInt(t.id), parseUnits(ask || '0', e.currency.decimals)]);
            }}
          >
            <label className="sr-only" htmlFor={`ask-${t.id}`}>
              Your price in {e.currency.symbol}
            </label>
            <input id={`ask-${t.id}`} className="input num" inputMode="decimal" placeholder={`Price in ${e.currency.symbol}`} value={ask} onChange={(x) => setAsk(x.target.value.replace(/[^0-9.]/g, ''))} />
            <button className="pill pill-primary" disabled={busy || !ask}>
              {busy ? 'Listing…' : 'List'}
            </button>
            <span className="field-help" style={{ gridColumn: '1 / -1' }}>
              You receive {ask ? `${(Number(ask) * (1 - 0.03 - e.royaltyBps / 10000)).toFixed(2)} ${e.currency.symbol}` : 'the price'} minus 3% Doorlist fee and the organizer’s {(e.royaltyBps / 100).toFixed(1)}%.
            </span>
          </form>
        )}
      </span>
      {status}
      <span className="tk-actions">
        {e.cancelled && !t.refunded ? (
          <button className="pill pill-primary" disabled={busy} onClick={() => run('claimRefund', [BigInt(t.id)])}>
            <Undo2 size={15} strokeWidth={1.5} aria-hidden="true" /> {busy ? 'Claiming…' : `Claim ${price(e.price, e.currency)}`}
          </button>
        ) : !t.used && !t.refunded && phase(e) !== 'past' ? (
          <>
            {t.askPrice > 0n ? (
              <button className="pill pill-ghost" disabled={busy} onClick={() => run('list', [BigInt(t.id), 0n])}>
                Stop selling
              </button>
            ) : (
              <button className="pill pill-ghost" onClick={() => setSelling((x) => !x)}>
                <Tag size={15} strokeWidth={1.5} aria-hidden="true" /> Sell
              </button>
            )}
            <Link className="pill pill-primary" href={`/ticket/?id=${t.id}`}>
              <QrCode size={15} strokeWidth={1.5} aria-hidden="true" /> Show
            </Link>
          </>
        ) : null}
      </span>
    </li>
  );
}
