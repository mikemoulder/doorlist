'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, Smartphone } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Cover, useMedia } from '@/components/EventBits';
import { getEvent, getTicket, type DoorEvent, type Ticket } from '@/lib/doorlist';
import { when } from '@/lib/format';
import { codeMessage, encodeCode, localKey, passMessage, REFRESH_SECONDS } from '@/lib/pass';
import { explain, useWallet } from '@/lib/wallet';

export default function TicketPage() {
  return (
    <AppShell>
      <Suspense>
        <TicketView />
      </Suspense>
    </AppShell>
  );
}

function TicketView() {
  const id = Number(useSearchParams().get('id'));
  const { address, connect, signMessage } = useWallet();
  const [t, setT] = useState<Ticket | null>();
  const [e, setE] = useState<DoorEvent>();
  const [pass, setPass] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string>();
  const media = useMedia(e?.uri);

  useEffect(() => {
    getTicket(id)
      .then(async (tk) => {
        setT(tk);
        setE(await getEvent(tk.eventId));
      })
      .catch(() => setT(null));
  }, [id]);

  // A pass is stored per ticket and per phone key; it stays valid until the ticket changes hands.
  useEffect(() => {
    if (!t) return;
    const device = localKey('device').address;
    setPass((localStorage.getItem(`doorlist.pass.${t.id}.${device}`) as `0x${string}` | null) ?? null);
  }, [t]);

  async function approvePhone() {
    setError(undefined);
    try {
      const device = localKey('device').address;
      const sig = await signMessage(passMessage(id, device));
      localStorage.setItem(`doorlist.pass.${id}.${device}`, sig);
      setPass(sig);
    } catch (err) {
      setError(explain(err));
    }
  }

  if (t === null) return <Missing text={`Ticket #${id} doesn’t exist.`} />;
  if (!t || !e) return <p className="faint">Loading ticket…</p>;
  const owner = t.owner.toLowerCase();
  const d = when(e.startsAt);

  let body;
  if (owner === '0x0000000000000000000000000000000000000000') body = <p className="notice">This ticket was resold and reissued with a new number. This one no longer opens the door.</p>;
  else if (t.used) body = <p className="notice">This ticket was scanned at the door. Enjoy the event.</p>;
  else if (e.cancelled) body = <p className="notice">This event was cancelled. Claim your refund in <Link className="link" href="/tickets/">My tickets</Link>.</p>;
  else if (!address) body = <button className="pill pill-primary pill-lg" onClick={() => connect()}>Sign in to show this ticket</button>;
  else if (address.toLowerCase() !== owner) body = <p className="notice">This ticket belongs to a different wallet. Sign in with the wallet that holds it.</p>;
  else if (!pass)
    body = (
      <div className="approve">
        <Smartphone size={20} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <p style={{ fontWeight: 600 }}>Use this phone as your ticket</p>
          <p className="muted" style={{ fontSize: 14 }}>
            Your wallet signs once. Then this phone shows a code that changes every {REFRESH_SECONDS} seconds, so a screenshot won’t work for anyone else.
          </p>
        </div>
        <button className="pill pill-primary" onClick={approvePhone}>
          Approve this phone
        </button>
      </div>
    );
  else body = <LiveCode ticketId={t.id} pass={pass} />;

  return (
    <div className="tk">
      <Link href="/tickets/" className="faint back">
        <ArrowLeft size={15} strokeWidth={1.5} aria-hidden="true" /> My tickets
      </Link>
      <article className="tk-card">
        <div className="tk-art">
          <Cover e={e} media={media} ratio="16 / 9" which="ticket" />
        </div>
        <div className="tk-head">
          <h1>{e.name}</h1>
          <p className="muted num">
            {d.day}, {d.time}
            {media?.venue ? ` · ${media.venue}` : ''}
          </p>
          <p className="faint" style={{ fontSize: 13 }}>
            Ticket <span className="id">#{t.id}</span>
          </p>
        </div>
        <div className="tk-body">{body}</div>
        {error && <p className="notice notice-error">{error}</p>}
      </article>
    </div>
  );
}

function LiveCode({ ticketId, pass }: { ticketId: number; pass: `0x${string}` }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [left, setLeft] = useState(REFRESH_SECONDS);
  const [stamp, setStamp] = useState<number>();

  useEffect(() => {
    const device = localKey('device');
    let live = true;
    async function draw() {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await device.sign(codeMessage(ticketId, ts));
      if (!live || !canvas.current) return;
      await QRCode.toCanvas(canvas.current, encodeCode(ticketId, ts, device.address, pass, sig), { margin: 2, width: 320, errorCorrectionLevel: 'M', color: { dark: '#0f0f0f', light: '#ffffff' } });
      setStamp(ts);
    }
    draw();
    const every = setInterval(draw, REFRESH_SECONDS * 1000);
    const tick = setInterval(() => setLeft((x) => (x <= 1 ? REFRESH_SECONDS : x - 1)), 1000);
    return () => {
      live = false;
      clearInterval(every);
      clearInterval(tick);
    };
  }, [ticketId, pass]);

  useEffect(() => setLeft(REFRESH_SECONDS), [stamp]);

  return (
    <div className="qr-wrap">
      <canvas ref={canvas} className="qr" role="img" aria-label="Your ticket code" />
      <div className="qr-meta">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="9" cy="9" r="7" fill="none" stroke="var(--raised)" strokeWidth="2.5" />
          <circle cx="9" cy="9" r="7" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray={`${(left / REFRESH_SECONDS) * 44} 44`} style={{ transition: 'stroke-dasharray 300ms linear' }} />
        </svg>
        <span className="num">New code in {left}s</span>
      </div>
      <p className="faint" style={{ fontSize: 13, textAlign: 'center' }}>
        Turn your brightness up and hold the phone flat to the scanner.
      </p>
    </div>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <div className="a-title">
      <div>
        <h1>Ticket not found</h1>
        <p>
          {text} <Link className="link" href="/tickets/">My tickets</Link>
        </p>
      </div>
    </div>
  );
}
