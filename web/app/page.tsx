'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { Wordmark } from '@/components/Logo';
import { useLiveCode } from '@/components/landing/useLiveCode';
import { getEvents, phase, type DoorEvent } from '@/lib/doorlist';
import { price, shortAddress, when } from '@/lib/format';
import { MAX_AGE_SECONDS, REFRESH_SECONDS } from '@/lib/pass';
import credits from '@/public/world/credits.json';

export default function Home() {
  const live = useLiveCode();
  const [events, setEvents] = useState<DoorEvent[]>();
  useEffect(() => {
    getEvents()
      .then((e) => setEvents(e.filter((x) => phase(x) === 'onsale' || phase(x) === 'live').sort((a, b) => a.startsAt - b.startsAt)))
      .catch(() => setEvents([]));
  }, []);
  useReveal();

  return (
    <div className="page">
      <header className="p-bar">
        <Link href="/" className="wordmark">
          <Wordmark />
        </Link>
        <nav aria-label="Main">
          <Link href="/events/">Events</Link>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/organize/">Organize</Link>
        </nav>
        <Link className="btn btn-lime" href="/events/">
          Find an event
        </Link>
      </header>

      {/* HERO: controls on the sentence */}
      <section className="hero wrap">
        <h1 className="display lines hero-h">
          <span className="line">
            <span data-line style={{ ['--i' as string]: 0 }}>Tickets that</span>
          </span>
          <span className="line">
            <span data-line style={{ ['--i' as string]: 1 }}>can’t be copied.</span>
          </span>
        </h1>

        <div className="chip chip-a" data-ui aria-label="A live code, signed every 10 seconds">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {live.code ? <img src={live.code.qr} alt="" width={44} height={44} /> : <span className="chip-qr" />}
          <span>
            <span className="chip-label">Live code</span>
            <span className="chip-read num">new in {live.nextIn}s</span>
          </span>
        </div>
        <button className="chip chip-b" data-ui aria-pressed={!!live.shot} onClick={live.shot ? live.clearShot : live.takeShot}>
          <span>
            <span className="chip-label">{live.shot ? 'Your screenshot' : 'Take a screenshot'}</span>
            <span className="chip-read num">{live.shot ? `${live.shotAge}s old · ${live.shotRefused ? 'refused' : `refused in ${MAX_AGE_SECONDS - (live.shotAge ?? 0)}s`}` : 'try to copy it'}</span>
          </span>
          <span className={`switch${live.shot ? ' on' : ''}`} aria-hidden="true" />
        </button>
        <Link className="chip chip-c" data-ui href="/events/">
          <span>
            <span className="chip-label">On sale now</span>
            <span className="chip-read num">{events ? `${events.length} event${events.length === 1 ? '' : 's'}` : '…'}</span>
          </span>
          <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
        </Link>

        <div className="hero-foot" data-rise style={{ ['--i' as string]: 0 }}>
          <p className="hero-sub">Your ticket lives in your wallet and shows a code that changes every {REFRESH_SECONDS} seconds. Screenshots don’t work, and every ticket gets in once.</p>
          <div className="hero-actions">
            <Link className="btn btn-lime" href="/events/">
              Find an event
            </Link>
            <Link className="link" href="/organize/">
              Sell tickets for your event
            </Link>
          </div>
        </div>
      </section>

      {/* SHOWCASE: live demo with controls */}
      <section className="section wrap" aria-labelledby="demo-h">
        <div className="show">
          <div className="show-intro" data-reveal>
            <h2 id="demo-h" className="h-sec">
              Watch it refresh
            </h2>
            <p className="muted">This code was signed in your browser a moment ago, the same way a ticket is. Copy it, then wait.</p>
          </div>
          <div className="show-panel" data-ui data-reveal style={{ ['--i' as string]: 1 }}>
            <div className="show-demo">
              <div className="mini-ticket">
                <span className="mini-name">Your ticket</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {live.code ? <img src={(live.shot ?? live.code).qr} alt="A live ticket code" /> : <span className="mini-qr" />}
                <span className="mini-meta num">{live.shot ? `Screenshot, ${live.shotAge}s old` : `New code in ${live.nextIn}s`}</span>
              </div>
            </div>
            <ul className="show-controls">
              <li>
                <span>Refreshes every</span>
                <span className="num">{REFRESH_SECONDS} s</span>
              </li>
              <li>
                <span>This code</span>
                <span className="num">{live.code ? `${REFRESH_SECONDS - live.nextIn} s old` : '—'}</span>
              </li>
              <li>
                <span>Signed by this phone</span>
                <span className="id">{shortAddress(live.device)}</span>
              </li>
              <li>
                <label htmlFor="shot">Use a screenshot</label>
                <button id="shot" role="switch" aria-checked={!!live.shot} className={`switch${live.shot ? ' on' : ''}`} onClick={live.shot ? live.clearShot : live.takeShot}>
                  <span className="sr-only">Use a screenshot</span>
                </button>
              </li>
              <li>
                <span>Screenshot age</span>
                <span className="num">{live.shotAge !== undefined ? `${live.shotAge} s` : '—'}</span>
              </li>
              <li>
                <span>At the door</span>
                {live.shot ? (
                  live.shotRefused ? (
                    <span className="verdict-txt no">
                      <X size={14} strokeWidth={2} aria-hidden="true" /> Refused, too old
                    </span>
                  ) : (
                    <span className="verdict-txt num">Valid for {MAX_AGE_SECONDS - (live.shotAge ?? 0)} s more</span>
                  )
                ) : (
                  <span className="verdict-txt ok">
                    <Check size={14} strokeWidth={2} aria-hidden="true" /> Valid
                  </span>
                )}
              </li>
            </ul>
            <Link className="show-link link" href="/events/">
              See a real event
            </Link>
          </div>
          <p className="faint show-hint" data-reveal style={{ ['--i' as string]: 2 }}>Turn the screenshot on, then wait {MAX_AGE_SECONDS} seconds.</p>
        </div>
      </section>

      {/* HOW IT WORKS: pinned fragment, changing state */}
      <HowItWorks next={events?.[0]} qr={live.code?.qr} nextIn={live.nextIn} />

      <figure className="world wrap" data-reveal>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/world/box-office.jpg" alt="A crowd pressed against a wooden barrier at a theatre box office, watched by a guard" width={1600} height={1144} />
        <figcaption className="faint">The door has always needed a guard. Félix Vallotton, Box Office, 1893.</figcaption>
      </figure>

      {/* FEATURES: paragraph with picture words */}
      <section className="section wrap" aria-labelledby="feat-h">
        <h2 id="feat-h" className="sr-only">
          What Doorlist does with the money
        </h2>
        <div className="feat-grid">
          <p className="statement feat" data-reveal>
            Money waits <span className="slot" data-ui>Held</span> until the doors open. Cancel, and everyone gets <span className="slot" data-ui>100%</span> back. Every resale pays the organizer <span className="slot" data-ui>+5%</span>.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="feat-pic" data-reveal style={{ ['--i' as string]: 1 }}>
            <img className="drift" src="/world/live-band-performance-at-an-outdoor-concert.jpg" alt="A band on an outdoor stage at night, the crowd in front" />
          </div>
        </div>
      </section>

      {/* PRICING: the price, very large */}
      <section id="pricing" className="section wrap pricing" aria-labelledby="price-h">
        <div className="price-copy" data-reveal>
          <h2 id="price-h" className="h-sec">
            One fee, after the sale
          </h2>
          <p className="muted">Organizers pay 3% of each ticket sold, taken when the money is paid out. Buyers pay the ticket price and a small network fee.</p>
        </div>
        <div className="price-fig" data-reveal style={{ ['--i' as string]: 1 }}>
          <div className="price-num num" aria-label="3 percent">
            3<span>%</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="price-obj" src="/world/theatre-box-office-sign-semaphore.jpg" alt="An old theatre price board: lounge 2/8d, upper dress circle 2/6d, children under 15 9d" />
          <ul className="price-incl" data-reveal style={{ ['--i' as string]: 2 }}>
            <li>Creating an event costs nothing</li>
            <li>Paid to you 24 hours after doors open</li>
            <li>Automatic refunds if you cancel</li>
            <li>Up to 10% of every resale is yours</li>
          </ul>
          <Link className="btn btn-lime" href="/organize/">
            Create an event
          </Link>
        </div>
      </section>

      {/* LIST: two-ended rows, live from the chain */}
      <section className="section wrap onsale" aria-labelledby="list-h">
        <div className="onsale-col" data-reveal>
          <h2 id="list-h" className="h-list" data-reveal>
            On sale now
          </h2>
          {!events ? (
            <p className="faint">Reading Portaldot…</p>
          ) : events.length === 0 ? (
            <p className="muted">
              Nothing on sale at this moment. Events appear here the second an organizer creates one.{' '}
              <Link className="link" href="/organize/">
                Be the first
              </Link>
            </p>
          ) : (
            <ul className="two-ends">
              {events.slice(0, 12).map((e) => (
                <li key={e.id}>
                  <Link href={`/event/?id=${e.id}`}>
                    <span className="dot" aria-hidden="true" />
                    <span className="te-name">{e.name}</span>
                    <span className="te-val num">
                      {when(e.startsAt).day} · {price(e.price, e.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link className="link" href="/events/" style={{ display: 'inline-block', marginTop: 24 }}>
            All events
          </Link>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="onsale-pic" data-reveal src="/world/beach-please-2022-crowd-stage-lights-night.jpg" alt="A festival crowd under stage lights, phones raised" />
      </section>

      <Faq />

      {/* CTA: first step, already open */}
      <Cta />

      <footer className="wrap p-foot">
        <p className="credits faint">
          Pictures:{' '}
          {credits.map((c, i) => (
            <span key={c.file}>
              <a className="link" href={c.page}>
                “{c.title.length > 48 ? c.title.slice(0, 46) + '…' : c.title}”
              </a>{' '}
              by {c.creator}, {c.license}, via {c.via}
              {i < credits.length - 1 ? '; ' : '.'}
            </span>
          ))}
        </p>
        <div className="foot-line">
          <span className="faint">Doorlist, tickets on Portaldot</span>
          <span className="foot-links">
            <Link href="/events/">Events</Link>
            <Link href="/organize/">Organize</Link>
            <Link href="/door/">Door</Link>
          </span>
          <span className="faint" style={{ justifySelf: 'end' }}>
            2026 · No cookies, no tracking
          </span>
        </div>
      </footer>
    </div>
  );
}

const STEPS = [
  { title: 'Buy it with a tap.', line: 'Pay with dollars on Portaldot. The ticket lands in your wallet.' },
  { title: 'Then show it from your phone.', line: 'Your wallet approves this phone once. The code changes every 10 seconds.' },
  { title: 'Get scanned, once.', line: 'The door checks the code and records the entry. The second scan is refused.' },
];

function HowItWorks({ next, qr, nextIn }: { next?: DoorEvent; qr?: string; nextIn: number }) {
  const amount = next ? price(next.price, next.currency) : undefined;
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && setActive(Number((en.target as HTMLElement).dataset.step))),
      { rootMargin: '-45% 0px -45% 0px' },
    );
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);
  return (
    <section id="how" className="section wrap how" aria-labelledby="how-h">
      <div className="how-text">
        <h2 id="how-h" className="h-sec">
          Three steps, no paper
        </h2>
        {STEPS.map((s, i) => (
          <div key={s.title} className={`how-step${active === i ? ' on' : ''}`} data-step={i} ref={(el) => void (refs.current[i] = el)}>
            <p className="how-title">{s.title}</p>
            <p className="muted">{s.line}</p>
          </div>
        ))}
      </div>
      <div className="how-stage" aria-hidden="true">
        <div className="frag" data-ui data-state={active}>
          <div className="frag-buy">
            <span className="kpi-label">Ticket</span>
            <span className="frag-price num">{amount ?? next?.name ?? 'Your event'}</span>
            <span className="frag-btn">{amount ? `Buy for ${amount}` : 'Buy'}</span>
          </div>
          <div className="frag-show">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr ? <img className="frag-qr" src={qr} alt="" /> : <span className="frag-qr" />}
            <span className="faint num">New code in {nextIn}s</span>
          </div>
          <div className="frag-door">
            <span className="frag-ok">Valid</span>
            <span className="frag-again">Scan it again: refused, already used</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  { q: 'Do I need to know crypto?', a: 'No. You need a wallet app such as SubWallet or MetaMask. Doorlist only asks it to confirm things: a purchase, or approving your phone.' },
  { q: 'What is dUSD?', a: 'Doorlist USD, a dollar token on the Portaldot network. Prices in dUSD read like dollars: $25.00 is 25 dUSD.' },
  { q: 'What if I lose my phone?', a: 'Your ticket is in your wallet, not on the phone. Sign in on your new phone and approve it. The old phone’s codes stop working.' },
  { q: 'What if the event is cancelled?', a: 'Your money was never paid out. Open My tickets and claim 100% back. You don’t need the organizer’s help.' },
  { q: 'Can I sell my ticket?', a: 'Yes, at any price. The buyer gets a freshly issued ticket and your old code dies at the same moment.' },
  { q: 'Can I buy one for a friend?', a: 'Yes. Choose As a gift and enter their wallet address. You pay, the ticket is issued straight to them.' },
];

function Faq() {
  const [sel, setSel] = useState(0);
  return (
    <section className="section wrap faq" aria-labelledby="faq-h">
      <ul className="faq-q" data-reveal>
        <li>
          <h2 id="faq-h" className="faq-h faint">
            Questions
          </h2>
        </li>
        {FAQ.map((f, i) => (
          <li key={f.q}>
            <button aria-expanded={sel === i} onClick={() => setSel(i)} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)}>
              <span className="dot" aria-hidden="true" />
              {f.q}
            </button>
            <p className="faq-inline">{f.a}</p>
          </li>
        ))}
      </ul>
      <p className="faq-a" aria-live="polite" key={sel}>
        {FAQ[sel].a}
      </p>
    </section>
  );
}

function Cta() {
  const router = useRouter();
  const [name, setName] = useState('Portaldot Hacker House Demo Day');
  const [cur, setCur] = useState<'dUSD' | 'POT'>('dUSD');
  return (
    <section className="cta" aria-labelledby="cta-h">
      <div className="cta-copy">
        <h2 id="cta-h" className="cta-h">
          Open your doors.
        </h2>
        <p>Name it, add a date and a picture, and it’s on sale in minutes. You’re paid the day after.</p>
      </div>
      <form
        className="dialog"
        data-ui
        onSubmit={(x) => {
          x.preventDefault();
          router.push(`/organize/?name=${encodeURIComponent(name)}&currency=${cur}`);
        }}
      >
        <p className="dialog-t">Name your event</p>
        <label className="sr-only" htmlFor="cta-name">
          Event name
        </label>
        <input id="cta-name" className="dialog-in" value={name} maxLength={48} onChange={(x) => setName(x.target.value)} />
        <div className="dialog-seg" role="group" aria-label="Price tickets in">
          {(['dUSD', 'POT'] as const).map((c) => (
            <button type="button" key={c} aria-pressed={cur === c} onClick={() => setCur(c)}>
              {c === 'dUSD' ? 'Dollars (dUSD)' : 'POT'}
            </button>
          ))}
        </div>
        <button className="dialog-go">Continue</button>
      </form>
    </section>
  );
}

/** Section entrances: adds .is-in once each [data-reveal] scrolls into view. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]');
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -10% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}
