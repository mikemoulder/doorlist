'use client';
import { useEffect, useState } from 'react';
import type { DoorEvent } from '@/lib/doorlist';
import { phase, uriFromSubstrate } from '@/lib/doorlist';
import { loadMedia, type MediaBundle } from '@/lib/media';
import { when } from '@/lib/format';

/** Doors against capacity: checked in and sold as fills on one track as long as the capacity. */
export function DoorsBar({ e, checkedIn }: { e: DoorEvent; checkedIn?: number }) {
  const pct = (n: number) => `${e.capacity ? Math.min(100, (n / e.capacity) * 100) : 0}%`;
  const left = Math.max(0, e.capacity - e.sold);
  return (
    <div className="doors">
      <div className="doors-track" role="img" aria-label={`${e.sold} of ${e.capacity} sold${checkedIn !== undefined ? `, ${checkedIn} checked in` : ''}`}>
        <span className="doors-sold" style={{ width: pct(e.sold) }} />
        {checkedIn !== undefined && <span className="doors-in" style={{ width: pct(checkedIn) }} />}
      </div>
      <div className="doors-legend num">
        {checkedIn !== undefined && (
          <span>
            <i style={{ background: 'var(--accent)' }} />
            {checkedIn} in
          </span>
        )}
        <span>
          <i style={{ background: '#aab1f5' }} />
          {e.sold} sold
        </span>
        <span>{left === 0 ? 'Sold out' : `${left} of ${e.capacity} left`}</span>
      </div>
    </div>
  );
}

export function StatusTag({ e }: { e: DoorEvent }) {
  const p = phase(e);
  if (p === 'cancelled') return <span className="tag tag-neg">Cancelled</span>;
  if (p === 'soldout') return <span className="tag tag-neutral">Sold out</span>;
  if (p === 'live') return <span className="tag tag-pos">Doors open</span>;
  if (p === 'past') return <span className="tag tag-neutral">Ended</span>;
  return <span className="tag tag-pos">On sale</span>;
}

/** An event's media. When the eth logs had no link (event made from a Portaldot Wallet), finds it on the Substrate side first. */
export function useMedia(e?: { id: number; uri?: string } | null) {
  const [media, setMedia] = useState<MediaBundle | null | undefined>(undefined);
  const id = e?.id;
  const uri = e?.uri;
  useEffect(() => {
    let live = true;
    setMedia(undefined);
    if (id === undefined) return;
    const link = uri !== undefined ? Promise.resolve(uri) : uriFromSubstrate(id).catch(() => undefined);
    link.then((u) => loadMedia(u || undefined)).then((m) => live && setMedia(m));
    return () => {
      live = false;
    };
  }, [id, uri]);
  return media; // undefined = loading, null = none
}

/** The event's own picture; without one, its date set large on a flat field (no stand-in picture). */
export function Cover({ e, media, ratio = '4 / 3', which = 'image' }: { e: DoorEvent; media?: MediaBundle | null; ratio?: string; which?: 'image' | 'ticket' }) {
  const src = media?.[which] ?? (which === 'ticket' ? media?.image : undefined);
  const d = when(e.startsAt);
  return (
    <div className="cover" style={{ aspectRatio: ratio }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${e.name}`} />
      ) : (
        <div className="cover-type" aria-hidden={media === undefined}>
          <span>{d.day}</span>
          <span className="faint">{media === undefined ? 'Loading picture…' : d.time}</span>
        </div>
      )}
    </div>
  );
}
