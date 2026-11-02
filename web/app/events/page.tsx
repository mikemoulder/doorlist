'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { FirstRun, GhostLink } from '@/components/FirstRun';
import { Cover, StatusTag, useMedia } from '@/components/EventBits';
import { getEvents, phase, type DoorEvent } from '@/lib/doorlist';
import { price, when } from '@/lib/format';

const FILTERS = [
  { key: 'onsale', label: 'On sale' },
  { key: 'live', label: 'Doors open' },
  { key: 'soldout', label: 'Sold out' },
  { key: 'past', label: 'Ended' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

export default function EventsPage() {
  const [events, setEvents] = useState<DoorEvent[]>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('onsale');
  const [loadedAt, setLoadedAt] = useState<Date>();

  const load = () => {
    setError(undefined);
    getEvents()
      .then((e) => {
        setEvents(e.sort((a, b) => a.startsAt - b.startsAt));
        setLoadedAt(new Date());
      })
      .catch(() => setError('Couldn’t reach Portaldot.'));
  };
  useEffect(load, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f.key] = events?.filter((e) => phase(e) === f.key).length ?? 0;
    return c;
  }, [events]);
  const shown = events?.filter((e) => phase(e) === filter) ?? [];

  return (
    <AppShell>
      <div className="a-title">
        <div>
          <h1>Events</h1>
          <p>Every event on Doorlist, read live from the Portaldot network.</p>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }} className="faint">
          {loadedAt && <span style={{ fontSize: 13 }}>Updated {loadedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button className="pill pill-ghost" onClick={load} aria-label="Refresh">
            <RefreshCw size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </span>
      </div>

      <div className="counts" role="tablist" aria-label="Filter events">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} className="count" onClick={() => setFilter(f.key)}>
            <span className="kpi-label">{f.label}</span>
            <span className="count-value num">{events ? counts[f.key] : <span className="skel">00</span>}</span>
          </button>
        ))}
      </div>

      {events && events.length === 0 && !error ? (
        <div style={{ marginTop: 16 }}>
          <FirstRun
            title="Nothing on sale yet"
            line="Events appear here the moment an organizer creates one on Portaldot. Every figure on this screen is read from the Doorlist contract."
            actions={
              <>
                <Link className="pill pill-primary pill-lg" href="/organize/">
                  Create the first event
                </Link>
                <GhostLink href="/#how">How Doorlist works</GhostLink>
              </>
            }
            steps={[
              { title: 'An organizer creates the event', line: 'Name, date, price in dUSD or POT, capacity and a picture.' },
              { title: 'Tickets go on sale at once', line: 'Buyers pay from their wallet. The contract holds the money until after the show.' },
              { title: 'The door scans on the night', line: 'Each ticket gets in once. A screenshot or a second scan is refused.' },
            ]}
          />
        </div>
      ) : (
      <section className="card" style={{ marginTop: 16, padding: '6px 20px' }} aria-label={FILTERS.find((f) => f.key === filter)!.label}>
        {error ? (
          <div className="notice notice-error" style={{ margin: '14px 0' }}>
            {error}{' '}
            <button className="link" onClick={load}>
              Try again
            </button>
          </div>
        ) : !events ? (
          <ul className="rows" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="ev-row">
                <span className="ev-thumb skel" />
                <span className="skel" style={{ width: 220, height: 16 }} />
              </li>
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <p className="empty" style={{ margin: '14px 0' }}>
            {events.length === 0 ? (
              <>
                No events yet. The first one will appear here as soon as an organizer creates it.{' '}
                <Link className="link" href="/organize/">
                  Create an event
                </Link>
              </>
            ) : (
              `Nothing ${FILTERS.find((f) => f.key === filter)!.label.toLowerCase()} right now.`
            )}
          </p>
        ) : (
          <ul className="rows">
            {shown.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        )}
      </section>
      )}
    </AppShell>
  );
}

function EventRow({ e }: { e: DoorEvent }) {
  const media = useMedia(e.uri);
  const d = when(e.startsAt);
  const left = e.capacity - e.sold;
  return (
    <li>
      <Link href={`/event/?id=${e.id}`} className="ev-row">
        <span className="ev-thumb">
          <Cover e={e} media={media} ratio="4 / 3" />
        </span>
        <span className="ev-main">
          <span className="ev-name">{e.name}</span>
          <span className="ev-sub">
            {d.day} · {d.time}
            {media?.venue ? ` · ${media.venue}` : ''}
          </span>
        </span>
        <span className="ev-figs num">
          <span>{price(e.price, e.currency)}</span>
          <span className="faint">{left > 0 ? `${left} left` : 'Sold out'}</span>
        </span>
        <StatusTag e={e} />
        <ChevronRight size={16} strokeWidth={1.5} className="faint" aria-hidden="true" />
      </Link>
    </li>
  );
}
