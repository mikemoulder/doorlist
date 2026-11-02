'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Camera, CheckCircle2, Copy, XCircle } from 'lucide-react';
import { formatEther, type Address } from 'viem';
import { AppShell } from '@/components/AppShell';
import { DoorsBar } from '@/components/EventBits';
import { client } from '@/lib/chain';
import { getCheckIns, getEvent, getEvents, isDoor, phase, type DoorEvent } from '@/lib/doorlist';
import { when } from '@/lib/format';
import { checkInWithDoorKey, localKey, verifyCode, type Verdict } from '@/lib/pass';
import { explain } from '@/lib/wallet';

export default function DoorPage() {
  return (
    <AppShell>
      <Suspense>
        <DoorView />
      </Suspense>
    </AppShell>
  );
}

function DoorView() {
  const eventParam = useSearchParams().get('event');
  if (eventParam === null) return <PickEvent />;
  return <Door eventId={Number(eventParam)} />;
}

function PickEvent() {
  const [events, setEvents] = useState<DoorEvent[]>();
  useEffect(() => {
    getEvents().then((es) => setEvents(es.filter((e) => !e.cancelled && phase(e) !== 'past').sort((a, b) => a.startsAt - b.startsAt)));
  }, []);
  return (
    <>
      <div className="a-title">
        <div>
          <h1>Door</h1>
          <p>Turn this phone into a ticket scanner for one event.</p>
        </div>
      </div>
      <section className="card" style={{ padding: '6px 20px' }}>
        {!events ? (
          <p className="faint" style={{ padding: '14px 0' }}>Loading events…</p>
        ) : events.length === 0 ? (
          <p className="empty" style={{ margin: '14px 0' }}>No upcoming events to scan for.</p>
        ) : (
          <ul className="rows">
            {events.map((e) => (
              <li key={e.id} style={{ justifyContent: 'space-between' }}>
                <span>
                  <span style={{ fontWeight: 600 }}>{e.name}</span> <span className="faint num">{when(e.startsAt).day}</span>
                </span>
                <Link className="pill pill-ghost" href={`/door/?event=${e.id}`}>
                  Scan for this event
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Door({ eventId }: { eventId: number }) {
  const [e, setE] = useState<DoorEvent>();
  const [door, setDoor] = useState<Address>();
  const [approved, setApproved] = useState<boolean>();
  const [fee, setFee] = useState<bigint>();
  const [checkedIn, setCheckedIn] = useState<number>();

  const refresh = useCallback(async () => {
    const d = localKey('door').address;
    setDoor(d);
    const [ev, ok, bal, n] = await Promise.all([getEvent(eventId), isDoor(eventId, d), client.getBalance({ address: d }), getCheckIns(eventId)]);
    setE(ev);
    setApproved(ok);
    setFee(bal);
    setCheckedIn(n);
  }, [eventId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!e || !door || approved === undefined) return <p className="faint">Setting up this door…</p>;
  const ready = approved && (fee ?? 0n) > 0n;
  return (
    <>
      <div className="a-title">
        <div>
          <h1>{e.name}</h1>
          <p className="num">
            Door · {when(e.startsAt).day}, {when(e.startsAt).time}
          </p>
        </div>
      </div>
      {ready ? (
        <Scanner e={e} checkedIn={checkedIn} onEntry={refresh} />
      ) : (
        <Setup door={door} approved={approved} fee={fee ?? 0n} onCheck={refresh} />
      )}
    </>
  );
}

function Setup({ door, approved, fee, onCheck }: { door: Address; approved: boolean; fee: bigint; onCheck: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) QRCode.toCanvas(canvas.current, door, { margin: 2, width: 220, color: { dark: '#0f0f0f', light: '#ffffff' } });
  }, [door]);
  return (
    <section className="card setup">
      <canvas ref={canvas} className="qr" style={{ width: 220 }} role="img" aria-label="This door’s address" />
      <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Ask the organizer to approve this door</h2>
        <ol className="steps">
          <li data-state={approved ? 'done' : 'active'}>The organizer opens Organize, then Doors, and scans this code or pastes the address.</li>
          <li data-state={fee > 0n ? 'done' : approved ? 'active' : 'todo'}>Doorlist sends this door a little POT for its check-in fees.</li>
        </ol>
        <p className="faint num" style={{ fontSize: 13 }}>
          Door address <span className="id">{door}</span>{' '}
          <button className="link" onClick={() => navigator.clipboard.writeText(door)} aria-label="Copy door address">
            <Copy size={13} strokeWidth={1.5} style={{ display: 'inline', verticalAlign: -2 }} aria-hidden="true" />
          </button>
          <br />
          Balance {Number(formatEther(fee)).toFixed(4)} POT · this key stays on this phone only.
        </p>
        <button className="pill pill-primary" style={{ justifySelf: 'start' }} onClick={onCheck}>
          Check again
        </button>
      </div>
    </section>
  );
}

type Result = Verdict & { at: number; recorded?: boolean };

function Scanner({ e, checkedIn, onEntry }: { e: DoorEvent; checkedIn?: number; onEntry: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [camError, setCamError] = useState<string>();
  const [result, setResult] = useState<Result>();
  const [log, setLog] = useState<Result[]>([]);
  const [manual, setManual] = useState('');
  const busy = useRef(false);

  const handle = useCallback(
    async (raw: string) => {
      if (busy.current) return;
      busy.current = true;
      const v = await verifyCode(raw, e.id);
      let r: Result = { ...v, at: Date.now() };
      setResult(r);
      if (v.ok) {
        try {
          await checkInWithDoorKey(v.ticketId);
          r = { ...r, recorded: true };
          onEntry();
        } catch (err) {
          r = { ok: false, ticketId: v.ticketId, reason: explain(err), at: r.at };
        }
        setResult(r);
      }
      setLog((l) => [r, ...l].slice(0, 6));
      setTimeout(() => {
        setResult(undefined);
        busy.current = false;
      }, 2600);
    },
    [e.id, onEntry],
  );

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | undefined;
    let raf = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        video.current.play();
        const loop = () => {
          const v = video.current;
          if (v && v.readyState >= 2 && !busy.current) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code?.data) handle(code.data);
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => setCamError('The camera is blocked. Allow camera access for this site, or paste a code below.'));
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, handle]);

  return (
    <div className="door-grid">
      <section className="card scan">
        <div className="viewfinder">
          {on ? (
            <video ref={video} playsInline muted />
          ) : (
            <button className="pill pill-primary pill-lg" onClick={() => setOn(true)}>
              <Camera size={16} strokeWidth={1.5} aria-hidden="true" /> Start scanning
            </button>
          )}
          {result && (
            <div className={`verdict ${result.ok ? 'is-ok' : 'is-no'}`} role="status" aria-live="assertive">
              {result.ok ? <CheckCircle2 size={56} strokeWidth={1.5} aria-hidden="true" /> : <XCircle size={56} strokeWidth={1.5} aria-hidden="true" />}
              <strong>{result.ok ? 'Valid' : 'Refused'}</strong>
              <span>{result.ok ? `Ticket #${result.ticketId} · ${result.recorded ? 'entry recorded' : 'recording entry…'}` : result.reason}</span>
            </div>
          )}
        </div>
        {camError && <p className="notice notice-error">{camError}</p>}
        <form
          className="sell"
          style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
          onSubmit={(x) => {
            x.preventDefault();
            if (manual) handle(manual);
            setManual('');
          }}
        >
          <label className="sr-only" htmlFor="manual">
            Paste a ticket code
          </label>
          <input id="manual" className="input id" placeholder="Or paste a ticket code (DL1.…)" value={manual} onChange={(x) => setManual(x.target.value)} />
          <button className="pill pill-ghost">Check</button>
        </form>
      </section>
      <div className="ev-side">
        <section className="card">
          <div className="card-h">
            <h2>Doors</h2>
            <span className="meta">Live from the chain</span>
          </div>
          <DoorsBar e={e} checkedIn={checkedIn} />
        </section>
        <section className="card">
          <div className="card-h">
            <h2>Last scans</h2>
            <span className="meta">This phone</span>
          </div>
          {log.length === 0 ? (
            <p className="faint" style={{ fontSize: 14 }}>Nobody scanned yet.</p>
          ) : (
            <ul className="rows">
              {log.map((r) => (
                <li key={r.at} style={{ justifyContent: 'space-between' }}>
                  <span className="num">
                    {r.ticketId !== undefined ? <span className="id">#{r.ticketId}</span> : '—'}{' '}
                    <span className="faint">{new Date(r.at).toLocaleTimeString('en-GB')}</span>
                  </span>
                  {r.ok ? <span className="tag tag-pos">In</span> : <span className="tag tag-neg" title={r.reason}>Refused</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
