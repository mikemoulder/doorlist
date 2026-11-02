'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Mark } from '@/components/Logo';
import { useLiveCode } from '@/components/landing/useLiveCode';
import { getEvents, phase, type DoorEvent } from '@/lib/doorlist';
import { price, when, shortAddress } from '@/lib/format';
import { DOORLIST, EXPLORER } from '@/lib/chain';
import { MAX_AGE_SECONDS, REFRESH_SECONDS } from '@/lib/pass';
import credits from '@/public/world/credits.json';
import './landing.css';

const v = (o: Record<string, string | number>) => o as CSSProperties;

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
    <div className="lp">
      <header className="lp-bar">
        <Link href="/" className="wordmark" aria-label="Doorlist, home">
          <Mark size={26} />
          <span>Doorlist</span>
        </Link>
        <nav aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/organize/">Organize</Link>
          <Link href="/tickets/">My tickets</Link>
        </nav>
        <Link className="door-btn door-btn-s" href="/events/">
          Find an event
        </Link>
      </header>

      <Hero live={live} onSale={events?.length} />
      <Showcase live={live} />
      <Stages />
      <Board />
      <Arcade />
      <Pricing />
      <Refused />
      {events && events.length > 0 && <OnSale events={events} />}
      <Faq />
      <Cta />
      <Footer />
    </div>
  );
}

type Live = ReturnType<typeof useLiveCode>;

/* ------------------------------------------------------------------ hero: the giant doorway */
function Hero({ live, onSale }: { live: Live; onSale?: number }) {
  const video = usePlayWhenVisible();
  return (
    <section className="hero" aria-labelledby="hero-h">
      <div className="hero-copy">
        <h1 id="hero-h" className="display lines">
          <span className="line">
            <span data-line style={v({ '--i': 0 })}>Tickets you</span>
          </span>
          <span className="line">
            <span data-line style={v({ '--i': 1 })}>can’t copy</span>
          </span>
        </h1>
        <p className="hero-sub" data-load style={v({ '--d': '420ms' })}>
          Doorlist tickets live in your wallet and show a code that signs itself again every {REFRESH_SECONDS} seconds. The door lets each one in once.
        </p>
        <div className="hero-actions" data-load style={v({ '--d': '500ms' })}>
          <Link className="door-btn" href="/events/">
            Find an event
          </Link>
          <Link className="link" href="/organize/">
            Sell tickets for your event
          </Link>
        </div>
        <p className="hero-note" data-load style={v({ '--d': '580ms' })}>
          {onSale === undefined ? 'Reading Portaldot…' : onSale === 0 ? 'Running on the Portaldot V3 testnet.' : `${onSale} event${onSale === 1 ? '' : 's'} on sale on Portaldot now.`}
        </p>
      </div>

      <div className="hero-door">
        <div className="door-frame" data-open>
          <video ref={video} muted loop playsInline preload="metadata" poster="/world/one-step-closer-live-in-philadelphia-poster.jpg" aria-hidden="true">
            <source src="/world/one-step-closer-live-in-philadelphia.webm" type="video/webm" />
          </video>
          <span className="door-leaf" aria-hidden="true" />
        </div>
        <div className="hero-ticket" data-ui data-load style={v({ '--d': '900ms' })}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {live.code ? <img src={live.code.qr} alt="A live code signed in this browser" width={120} height={120} /> : <span className="qr-blank" />}
          <div>
            <p className="ht-name">Live code</p>
            <p className="ht-sub">Signed in this browser</p>
            <Ring left={live.nextIn} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Ring({ left }: { left: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring">
      <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="ring-bg" />
        <circle cx="18" cy="18" r={r} className="ring-fg" style={{ strokeDasharray: c, strokeDashoffset: c * (1 - left / REFRESH_SECONDS) }} />
      </svg>
      <span className="num">New in {left} s</span>
    </span>
  );
}

/* ------------------------------------------------------------------ showcase: one control, blown up */
function Showcase({ live }: { live: Live }) {
  const on = !!live.shot;
  const age = live.shotAge ?? 0;
  const refused = live.shotRefused;
  const shown = live.shot ?? live.code;
  return (
    <section className={`show${refused ? ' is-no' : ''}`} aria-labelledby="show-h">
      <div className="show-copy">
        <h2 id="show-h" className="head" aria-live="polite">
          The door says {refused ? 'no' : 'yes'}
        </h2>
        <p>
          This code was signed in your browser a moment ago, the same way a ticket is. Freeze it like a screenshot, then wait {MAX_AGE_SECONDS} seconds.
        </p>
      </div>

      <figure className="show-ticket" data-ui>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shown ? <img src={shown.qr} alt={on ? 'The frozen code' : 'The live code'} width={260} height={260} /> : <span className="qr-blank" />}
        <figcaption>
          <span>{on ? `Frozen ${age} s ago` : `Live, new in ${live.nextIn} s`}</span>
          <strong className="num">{!on ? 'Valid' : refused ? 'Refused, too old' : `Valid for ${MAX_AGE_SECONDS - age} s`}</strong>
        </figcaption>
      </figure>

      <div className="show-control" data-ui>
        <span className="sc-label" id="sc-label">
          Screenshot
        </span>
        <button className="sc-track" role="switch" aria-checked={on} aria-labelledby="sc-label" onClick={on ? live.clearShot : live.takeShot}>
          <span className="sc-knob" />
        </button>
        <span className="sc-value num">{!on ? 'Off, showing the live code' : refused ? `${age} s old, refused` : `${age} s old, refused in ${MAX_AGE_SECONDS - age} s`}</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ how it works: stages as one bar */
const STAGES = [
  { grow: 16, dur: 'Under a minute', line: 'First, pay in dollars from your wallet. The ticket is issued to you on Portaldot.' },
  { grow: 16, dur: 'Ten seconds, once', line: 'Then your wallet approves this phone to show the code. No pop-ups after that.' },
  { grow: 50, dur: 'Until the doors open', line: 'Meanwhile your money waits in the contract, not with the organizer, until a day after doors.' },
  { grow: 16, dur: 'Two seconds', line: 'Finally the door scans the code, checks Portaldot and lets you in. Never twice.' },
];

function Stages() {
  return (
    <section id="how" className="stages wrap" aria-labelledby="how-h">
      <h2 id="how-h" className="display" data-reveal>
        From wallet to door
      </h2>
      <ol className="stage-bar" data-ui data-reveal>
        {STAGES.map((s, i) => (
          <li key={s.dur} style={v({ '--g': s.grow, '--i': i })}>
            <span className={`stage-block sb-${i}`}>{s.dur}</span>
            <p>{s.line}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ features: close-ups on a board */
function Board() {
  return (
    <section className="board wrap" aria-labelledby="board-h" data-reveal>
      <div className="tile t-head" style={v({ '--i': 0 })}>
        <h2 id="board-h" className="head">
          Rules nobody
          <br /> can bend
        </h2>
      </div>

      <div className="tile t-refund" style={v({ '--i': 1 })}>
        <div className="zoom" data-ui aria-hidden="true">
          <span className="z-fig num">100%</span>
          <span className="z-btn">Claim refund</span>
        </div>
        <Cap name="Refunds without asking" line="If the organizer cancels, every holder takes the full price back." />
      </div>

      <div className="tile t-ring" style={v({ '--i': 2 })}>
        <div className="zoom" data-ui aria-hidden="true">
          <span className="z-ring">
            <svg viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" className="ring-bg" />
              <circle cx="18" cy="18" r="15" className="ring-fg" style={{ strokeDasharray: 94.25, strokeDashoffset: 28 }} />
            </svg>
            <span className="num">7</span>
          </span>
        </div>
        <Cap name="Codes that expire" line={`New every ${REFRESH_SECONDS} s. Older than ${MAX_AGE_SECONDS} s is refused.`} />
      </div>

      <div className="tile t-verdict" style={v({ '--i': 3 })}>
        <div className="zoom" data-ui aria-hidden="true">
          <span className="z-verdict">Already used</span>
          <span className="z-verdict-sub">Entered at the north door</span>
        </div>
        <Cap name="One scan per ticket" line="The door writes each entry to Portaldot. Scan the same ticket again and it is refused." />
      </div>

      <div className="tile t-royalty" style={v({ '--i': 4 })}>
        <div className="zoom" data-ui aria-hidden="true">
          <span className="z-slider">
            <span className="z-fill" />
            <span className="z-thumb" />
          </span>
          <span className="z-val num">5%</span>
        </div>
        <Cap name="Your cut of resales" line="Organizers set 0 to 10% of every resale." />
      </div>

      <div className="tile t-reissue" style={v({ '--i': 5 })}>
        <div className="zoom" data-ui aria-hidden="true">
          <span className="z-old num">#1043</span>
          <span className="z-new num">#1187</span>
        </div>
        <Cap name="Resold, then reissued" line="The buyer gets a new ticket. The seller’s code dies with the old one." />
      </div>

      <div className="tile t-limit" style={v({ '--i': 6 })}>
        <div className="zoom" data-ui aria-hidden="true">
          <span className="z-step">−</span>
          <span className="z-count num">4</span>
          <span className="z-step">+</span>
        </div>
        <Cap name="A limit per wallet" line="One buyer can’t take the room." />
      </div>

      <div className="tile t-gift" style={v({ '--i': 7 })}>
        <div className="zoom" data-ui aria-hidden="true">
          <span className="z-seg">
            <span>For me</span>
            <span className="on">As a gift</span>
          </span>
          <span className="z-field num">0x8f3c…c21a</span>
        </div>
        <Cap name="Buy one for a friend" line="You pay, and the ticket is issued straight to their wallet." />
      </div>

      <div className="tile t-payout" style={v({ '--i': 8 })}>
        <div className="zoom" data-ui aria-hidden="true">
          <span className="z-held">Held</span>
        </div>
        <Cap name="Paid after the show" line="Ticket money waits until 24 hours after doors open." />
      </div>
    </section>
  );
}

function Cap({ name, line }: { name: string; line: string }) {
  return (
    <div className="cap">
      <h3>{name}</h3>
      <p>{line}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ the band: every picture through a doorway */
const ARCHES = [
  { src: '/world/a-small-queue-at-the-entrance-to.jpg', w: 1750, h: 2250, pos: '42% 58%', alt: 'A long queue of top hats outside the arches of a Paris exhibition hall, a guard pointing down the line', cap: '“But I have a special pass!” A queue at the Palais de l’Industrie, Daumier, 1844.' },
  { src: '/world/box-office.jpg', w: 1600, h: 1144, pos: '72% 45%', alt: 'A crowd pressed against the barrier of a theatre box office, a guard standing in front', cap: 'The box office crush, Vallotton, 1893.' },
  { src: '/world/theatre-box-office-sign-semaphore.jpg', w: 1536, h: 2048, pos: '50% 45%', alt: 'An old theatre price board: lounge 2/8d, upper dress circle 2/6d, children under 15 9d', cap: 'A theatre price board, every seat by the slat.' },
  { src: '/world/live-band-performance-at-an-outdoor-concert.jpg', w: 1920, h: 1277, pos: '45% 40%', alt: 'A band on an outdoor stage at night, lit from behind, the crowd in front', cap: 'An outdoor show at night, 2025.' },
  { src: '/world/beach-please-2022-crowd-stage-lights-night.jpg', w: 1920, h: 1282, pos: '55% 50%', alt: 'A festival crowd under white and violet stage lights, phones raised', cap: 'A festival crowd, Beach, Please! 2022.' },
];

function Arcade() {
  return (
    <section className="arcade wrap" aria-labelledby="arcade-h">
      <div className="arcade-head" data-reveal>
        <h2 id="arcade-h" className="head">
          Every door keeps a list
        </h2>
        <p>
          For as long as there have been shows, someone has stood at the door with a list, crossing names off. Doorlist keeps that list on Portaldot, where nobody can
          forge a line or cross one off twice.
        </p>
      </div>
      <ul className="arches" data-reveal>
        {ARCHES.map((a, i) => (
          <li key={a.src}>
            <figure>
              <div className="arch shutter" style={v({ '--i': i })}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.src} alt={a.alt} width={a.w} height={a.h} loading="lazy" decoding="async" style={{ objectPosition: a.pos }} />
              </div>
              <figcaption>{a.cap}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ pricing: tiles that step up with the fee */
const PLANS = [
  {
    name: 'Create an event',
    fee: '0%',
    lines: ['No Doorlist fee to list', 'The network holds a storage deposit in POT', 'Price in dollars or in POT'],
    cta: 'Create an event',
    href: '/organize/',
  },
  {
    name: 'Sell a ticket',
    fee: '3%',
    lines: ['3% of each ticket, taken at payout', 'Paid to you 24 hours after doors open', 'Cancel before then and every buyer is refunded', 'Buyers pay the price plus a small network fee'],
    cta: 'Start selling',
    href: '/organize/',
  },
  {
    name: 'Resell a ticket',
    fee: '3–13%',
    lines: ['3% to Doorlist', '0 to 10% to the organizer, set per event', 'The rest to the seller, the moment it sells', 'The buyer gets a freshly issued ticket', 'The old code stops working'],
    cta: 'See what’s on',
    href: '/events/',
  },
];

function Pricing() {
  return (
    <section id="pricing" className="pricing wrap" aria-labelledby="price-h">
      <h2 id="price-h" className="head" data-reveal>
        Who pays what
      </h2>
      <ul className="plans" data-reveal>
        {PLANS.map((p, i) => (
          <li key={p.name} className={`plan plan-${i}`} style={v({ '--i': i })}>
            <h3>{p.name}</h3>
            <p className="plan-fee num">{p.fee}</p>
            <ul className="plan-lines">
              {p.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <Link className="plan-go" href={p.href}>
              {p.cta}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ list: what the door crosses off */
const REFUSED = [
  { what: 'screenshots', why: `older than ${MAX_AGE_SECONDS} s` },
  { what: 'second scans', why: 'already used' },
  { what: 'forged codes', why: 'wrong signature' },
  { what: 'old phones', why: 'replaced by your new one' },
  { what: 'resold copies', why: 'reissued to the buyer' },
];

function Refused() {
  return (
    <section className="refused" aria-labelledby="refused-h">
      <div className="wrap">
        <h2 id="refused-h" className="head" data-reveal>
          Refused at the door
        </h2>
        <ul className="poster">
          {REFUSED.map((r, i) => (
            <li key={r.what} data-reveal style={v({ '--i': i })}>
              <span className="poster-what">{r.what}</span>
              <span className="poster-why num">{r.why}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ live events, only when there are some */
function OnSale({ events }: { events: DoorEvent[] }) {
  return (
    <section className="onsale wrap" aria-labelledby="onsale-h">
      <h2 id="onsale-h" className="head" data-reveal>
        On sale now
      </h2>
      <ul className="onsale-list" data-reveal>
        {events.slice(0, 8).map((e) => (
          <li key={e.id}>
            <Link href={`/event/?id=${e.id}`}>
              <span className="bullet" aria-hidden="true" />
              <span className="os-name">{e.name}</span>
              <span className="os-val num">
                {when(e.startsAt).day}, {price(e.price, e.currency)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link className="link" href="/events/">
        All events
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------ faq: filled tiles */
const FAQ = [
  { q: 'Do I need to know crypto?', a: 'No. You need a wallet app such as SubWallet or MetaMask. Doorlist only asks it to confirm two things: a purchase, and approving your phone.' },
  { q: 'What is dUSD?', a: 'Doorlist USD, a dollar token on the Portaldot network. A price of $25.00 is 25 dUSD.' },
  { q: 'What does buying cost me?', a: 'The ticket price, plus a small network fee in POT. Doorlist takes nothing from buyers.' },
  { q: 'What if I lose my phone?', a: 'Your ticket is in your wallet, not on the phone. Sign in on the new phone and approve it; the old phone’s codes stop working.' },
  { q: 'What if the event is cancelled?', a: 'The money was never paid out. Open My tickets and claim 100% back. You don’t need the organizer’s help.' },
  { q: 'Can I sell my ticket?', a: 'Yes, at the price you choose, through Doorlist. The buyer gets a freshly issued ticket and your code dies at the same moment.' },
  { q: 'Can I buy one for a friend?', a: 'Yes. Choose As a gift and paste their wallet address. You pay, and the ticket is issued straight to them.' },
  { q: 'What does the door need?', a: 'Any phone with a camera. The organizer approves it as a door once; after that it checks codes against Portaldot with no pop-ups.' },
];

function Faq() {
  return (
    <section className="faq wrap" aria-labelledby="faq-h">
      <h2 id="faq-h" className="head" data-reveal>
        Before you buy
      </h2>
      <div className="faq-list" data-reveal>
        {FAQ.map((f, i) => (
          <details key={f.q} name="faq" open={i === 0} style={v({ '--i': i })}>
            <summary>
              <span>{f.q}</span>
              <span className="plus" aria-hidden="true" />
            </summary>
            <div className="faq-a">
              <p>{f.a}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ cta: the sentence with a blank */
function Cta() {
  const router = useRouter();
  const [name, setName] = useState('');
  return (
    <section className="cta wrap" aria-labelledby="cta-h">
      <form
        onSubmit={(x) => {
          x.preventDefault();
          router.push(`/organize/${name.trim() ? `?name=${encodeURIComponent(name.trim())}` : ''}`);
        }}
      >
        <h2 id="cta-h" className="display" data-reveal>
          Sell tickets for
        </h2>
        <div className="cta-line" data-reveal style={v({ '--i': 1 })}>
          <label className="sr-only" htmlFor="cta-name">
            Your event’s name
          </label>
          <input id="cta-name" value={name} maxLength={48} placeholder="your event" onChange={(x) => setName(x.target.value)} autoComplete="off" />
          <button type="submit" className="cta-go">
            Start
          </button>
        </div>
      </form>
      <p className="cta-note" data-reveal style={v({ '--i': 2 })}>
        Opens the organizer screen with the name filled in. Listing an event has no Doorlist fee.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ footer: the name, built as doorways */
const LETTERS = [
  { l: 'D', h: 82 },
  { l: 'o', h: 64 },
  { l: 'o', h: 92 },
  { l: 'r', h: 70 },
  { l: 'l', h: 100 },
  { l: 'i', h: 60 },
  { l: 's', h: 86 },
  { l: 't', h: 74 },
];

function Footer() {
  return (
    <footer className="foot wrap" aria-labelledby="foot-h">
      <h2 id="foot-h" className="sr-only">
        Doorlist
      </h2>
      <div className="foot-mark" aria-hidden="true" data-reveal>
        {LETTERS.map((x, i) => (
          <span key={i} className={`fm fm-${i % 2}`} style={v({ '--h': `${x.h}%`, '--i': i })}>
            {x.l}
          </span>
        ))}
      </div>
      <div className="foot-cols">
        <div>
          <h3>Use it</h3>
          <Link href="/events/">Events</Link>
          <Link href="/tickets/">My tickets</Link>
          <Link href="/organize/">Organize</Link>
          <Link href="/door/">Door</Link>
        </div>
        <div>
          <h3>Learn</h3>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq-h">Questions</a>
        </div>
        <div>
          <h3>On Portaldot</h3>
          <a href={EXPLORER}>Network explorer</a>
          <span className="num" title={DOORLIST}>
            Contract {shortAddress(DOORLIST)}
          </span>
          <span>dUSD, asset 2026</span>
        </div>
        <div className="foot-about">
          <p>Doorlist was built for the Portaldot Hacker House 2026 and runs on the Portaldot V3 testnet.</p>
          <p>No cookies, no tracking.</p>
        </div>
      </div>
      <p className="credits">
        Pictures and footage:{' '}
        {credits.map((c, i) => (
          <span key={c.file}>
            <a className="link" href={c.page}>
              {c.title.length > 44 ? c.title.slice(0, 42).trim() + '…' : c.title}
            </a>{' '}
            by {c.creator}, {c.license}, via {c.via}
            {i < credits.length - 1 ? '; ' : '.'}
          </span>
        ))}
      </p>
      <div className="foot-last">
        <span>© 2026 Doorlist</span>
        <Link className="door-btn door-btn-s" href="/events/">
          Find an event
        </Link>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ behaviour */

/** Section entrances: adds .is-in once to each [data-reveal] when its top passes 88% of the screen,
 *  including anything already scrolled past (a jump from a link lands below it). */
function useReveal() {
  useEffect(() => {
    let left = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
    let raf = 0;
    const check = () => {
      raf = 0;
      const line = window.innerHeight * 0.88;
      left = left.filter((el) => {
        if (el.getBoundingClientRect().top < line) {
          el.classList.add('is-in');
          return false;
        }
        return true;
      });
      if (!left.length) window.removeEventListener('scroll', onScroll);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
}

/** The hero clip plays only while it is on screen, and never under reduced motion. */
function usePlayWhenVisible() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? el.play().catch(() => {}) : el.pause()));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
