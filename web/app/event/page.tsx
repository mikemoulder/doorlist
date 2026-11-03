'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, Gift, MapPin, ShieldCheck, Ticket as TicketIcon, User } from 'lucide-react';
import { isAddress, maxUint256, type Address } from 'viem';
import { AppShell } from '@/components/AppShell';
import { Cover, DoorsBar, StatusTag, useMedia } from '@/components/EventBits';
import { client, DOORLIST, DUSD, erc20Abi, FAUCET, NATIVE } from '@/lib/chain';
import { getCheckIns, getEvent, getListings, heldBy, phase, PAYOUT_DELAY, type DoorEvent, type Ticket } from '@/lib/doorlist';
import { money, price, shortAddress, when } from '@/lib/format';
import { explain, useWallet } from '@/lib/wallet';

export default function EventPage() {
  return (
    <AppShell>
      <Suspense>
        <EventView />
      </Suspense>
    </AppShell>
  );
}

function EventView() {
  const id = Number(useSearchParams().get('id'));
  const [e, setE] = useState<DoorEvent | null>();
  const [checkedIn, setCheckedIn] = useState<number>();
  const [listings, setListings] = useState<Ticket[]>([]);
  const media = useMedia(e);

  const load = useCallback(() => {
    getEvent(id).then(setE).catch(() => setE(null));
    getCheckIns(id).then(setCheckedIn).catch(() => undefined);
    getListings(id).then(setListings).catch(() => undefined);
  }, [id]);
  useEffect(load, [load]);

  if (e === null || !Number.isInteger(id))
    return (
      <div className="a-title">
        <div>
          <h1>Event not found</h1>
          <p>
            There is no event #{String(id)} on Doorlist. <Link className="link" href="/events/">See all events</Link>
          </p>
        </div>
      </div>
    );
  if (!e) return <p className="faint">Loading event…</p>;

  const d = when(e.startsAt);
  const p = phase(e);
  return (
    <>
      <header className="obj-head card">
        <div className="obj-cover">
          <Cover e={e} media={media} ratio="4 / 5" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <h1 className="obj-name">{e.name}</h1>
            <StatusTag e={e} />
          </div>
          <p className="obj-meta">
            <span>
              <CalendarDays size={14} strokeWidth={1.5} aria-hidden="true" /> {d.day}, {d.time}
            </span>
            {media?.venue && (
              <span>
                <MapPin size={14} strokeWidth={1.5} aria-hidden="true" /> {media.venue}
              </span>
            )}
            <span>
              <User size={14} strokeWidth={1.5} aria-hidden="true" /> Organizer <span className="id">{shortAddress(e.organizer)}</span>
            </span>
          </p>
        </div>
      </header>

      <div className="ev-grid">
        <BuyPanel e={e} onBought={load} />
        <div className="ev-side">
          <section className="card">
            <div className="card-h">
              <h2>Doors</h2>
              <span className="meta">{p === 'live' ? 'Live' : `Opens ${d.day}`}</span>
            </div>
            <DoorsBar e={e} checkedIn={checkedIn} />
          </section>
          <section className="card">
            <div className="card-h">
              <h2>About</h2>
            </div>
            {media === undefined ? (
              <p className="faint">Loading…</p>
            ) : media?.description ? (
              <p className="prose">{media.description}</p>
            ) : (
              <p className="faint">The organizer hasn’t added a description.</p>
            )}
          </section>
          <Promises e={e} />
        </div>
      </div>

      {listings.length > 0 && <Resale e={e} listings={listings} onBought={load} />}
    </>
  );
}

function Promises({ e }: { e: DoorEvent }) {
  const payout = when(e.startsAt + PAYOUT_DELAY);
  return (
    <section className="card">
      <div className="card-h">
        <h2>Your money is protected</h2>
        <ShieldCheck size={16} strokeWidth={1.5} className="faint" aria-hidden="true" />
      </div>
      <ul className="kv">
        <li>
          <span>Paid to the organizer</span>
          <span className="num">
            {payout.day}, {payout.time}
          </span>
        </li>
        <li>
          <span>If the event is cancelled</span>
          <span>100% back, you claim it</span>
        </li>
        <li>
          <span>Tickets per person</span>
          <span className="num">{e.maxPerWallet || 'No limit'}</span>
        </li>
        <li>
          <span>Organizer’s cut of resales</span>
          <span className="num">{(e.royaltyBps / 100).toFixed(1)}%</span>
        </li>
      </ul>
    </section>
  );
}

function BuyPanel({ e, onBought }: { e: DoorEvent; onBought: () => void }) {
  const { address, connect, write } = useWallet();
  const [gift, setGift] = useState(false);
  const [to, setTo] = useState('');
  const [step, setStep] = useState<'idle' | 'approving' | 'buying' | 'done'>('idle');
  const [error, setError] = useState<string>();
  const [balance, setBalance] = useState<bigint>();
  const [allowance, setAllowance] = useState<bigint>();
  const [mine, setMine] = useState<number>();
  const [claimed, setClaimed] = useState<boolean>();
  const [claiming, setClaiming] = useState(false);
  const native = e.currency.address === NATIVE;
  const p = phase(e);
  const recipient = (gift ? to : address) as Address | undefined;
  const validRecipient = !!recipient && isAddress(recipient);

  useEffect(() => {
    if (!address) return;
    const reads = native
      ? [client.getBalance({ address }), Promise.resolve(maxUint256)]
      : [
          client.readContract({ address: e.currency.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
          client.readContract({ address: e.currency.address, abi: erc20Abi, functionName: 'allowance', args: [address, DOORLIST] }),
        ];
    Promise.all(reads).then(([b, a]) => {
      setBalance(b as bigint);
      setAllowance(a as bigint);
    });
    heldBy(e.id, address).then(setMine);
    if (e.currency.address.toLowerCase() === DUSD.address.toLowerCase()) {
      client.readContract({ address: FAUCET.address, abi: FAUCET.abi, functionName: 'claimed', args: [address] }).then(setClaimed);
    }
  }, [address, e, native, step, claiming]);

  const needsApproval = !native && allowance !== undefined && allowance < e.price;
  const enough = balance === undefined || balance >= e.price;

  async function buy() {
    setError(undefined);
    try {
      if (needsApproval) {
        setStep('approving');
        await write('approve', [DOORLIST, maxUint256], { to: e.currency.address, abi: erc20Abi });
      }
      setStep('buying');
      await write('buy', [BigInt(e.id), recipient], native ? { value: e.price } : {});
      setStep('done');
      onBought();
    } catch (err) {
      setError(explain(err));
      setStep('idle');
    }
  }

  async function getTestDollars() {
    setError(undefined);
    setClaiming(true);
    try {
      await write('claim', [], { to: FAUCET.address, abi: FAUCET.abi });
    } catch (err) {
      setError(explain(err));
    } finally {
      setClaiming(false);
    }
  }

  const closed = p !== 'onsale' && p !== 'live';
  return (
    <section className="card buy" aria-label="Buy a ticket">
      <div className="buy-price">
        <span className="kpi-label">Ticket</span>
        <span className="buy-figure num">{price(e.price, e.currency)}</span>
        <span className="faint" style={{ fontSize: 13 }}>
          {native ? 'Paid in POT' : 'Paid in Doorlist USD (dUSD), a dollar token on Portaldot'}
        </span>
      </div>

      {step === 'done' ? (
        <div className="buy-done">
          <Check size={20} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <p style={{ fontWeight: 600 }}>{gift ? 'Ticket sent.' : 'You’re on the list.'}</p>
            <p className="muted" style={{ fontSize: 14 }}>
              {gift ? `It’s in ${shortAddress(recipient!)}’s wallet now.` : 'Open it on your phone when you arrive.'}
            </p>
          </div>
          {!gift && (
            <Link className="pill pill-primary" href="/tickets/">
              <TicketIcon size={15} strokeWidth={1.5} aria-hidden="true" /> My tickets
            </Link>
          )}
        </div>
      ) : closed ? (
        <p className="notice">{p === 'cancelled' ? 'This event was cancelled. If you have a ticket, claim your refund in My tickets.' : p === 'soldout' ? 'Sold out. Check resale tickets below if anyone is selling.' : 'This event has ended.'}</p>
      ) : (
        <>
          <div className="seg" role="group" aria-label="Who is the ticket for?">
            <button aria-pressed={!gift} onClick={() => setGift(false)}>
              For me
            </button>
            <button aria-pressed={gift} onClick={() => setGift(true)}>
              <Gift size={13} strokeWidth={1.5} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
              As a gift
            </button>
          </div>
          {gift && (
            <div>
              <label className="field-label" htmlFor="to">
                Their wallet address
              </label>
              <input id="to" className="input id" placeholder="0x…" value={to} onChange={(x) => setTo(x.target.value.trim())} aria-describedby="to-help" />
              <p id="to-help" className="field-help">
                The ticket is issued straight to them. You pay, they get in.
              </p>
            </div>
          )}

          {!address ? (
            <button className="pill pill-primary pill-lg" onClick={() => connect()}>
              Sign in to buy
            </button>
          ) : (
            <>
              <ol className="steps">
                {!native && (
                  <li data-state={!needsApproval ? 'done' : step === 'approving' ? 'active' : 'todo'}>Allow Doorlist to take {e.currency.symbol} (once)</li>
                )}
                <li data-state={step === 'buying' ? 'active' : 'todo'}>Confirm the purchase</li>
              </ol>
              <button className="pill pill-primary pill-lg" onClick={buy} disabled={step !== 'idle' || !validRecipient || !enough}>
                {step === 'approving' ? 'Waiting for approval…' : step === 'buying' ? 'Buying…' : `Buy for ${price(e.price, e.currency)}`}
              </button>
              <p className="faint" style={{ fontSize: 13 }}>
                {balance !== undefined && <>You have {money(balance, e.currency)}. </>}
                {mine !== undefined && e.maxPerWallet > 0 && <>You hold {mine} of {e.maxPerWallet} allowed. </>}
                A small network fee in POT applies.
              </p>
              {!enough && claimed === false ? (
                <div className="notice">
                  <p>Not enough {e.currency.symbol} in this wallet. dUSD is a test dollar on Portaldot, and each wallet can collect {money(FAUCET.amount, e.currency)} once.</p>
                  <button className="pill" onClick={getTestDollars} disabled={claiming} style={{ marginTop: 10 }}>
                    {claiming ? 'Collecting…' : `Get ${money(FAUCET.amount, e.currency)}`}
                  </button>
                </div>
              ) : (
                !enough && <p className="notice notice-error">Not enough {e.currency.symbol} in this wallet.{claimed && ' This wallet has already collected its test dUSD.'}</p>
              )}
            </>
          )}
          {error && <p className="notice notice-error">{error}</p>}
        </>
      )}
    </section>
  );
}

function Resale({ e, listings, onBought }: { e: DoorEvent; listings: Ticket[]; onBought: () => void }) {
  const { address, connect, write } = useWallet();
  const [busy, setBusy] = useState<number>();
  const [error, setError] = useState<string>();
  async function buy(t: Ticket) {
    if (!address) return connect();
    setBusy(t.id);
    setError(undefined);
    try {
      if (e.currency.address !== NATIVE) {
        const allowance = (await client.readContract({ address: e.currency.address, abi: erc20Abi, functionName: 'allowance', args: [address, DOORLIST] })) as bigint;
        if (allowance < t.askPrice) await write('approve', [DOORLIST, maxUint256], { to: e.currency.address, abi: erc20Abi });
      }
      await write('buyResale', [BigInt(t.id), address], e.currency.address === NATIVE ? { value: t.askPrice } : {});
      onBought();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-h">
        <h2>Resale tickets</h2>
        <span className="meta">{listings.length} for sale · reissued to you with a new number</span>
      </div>
      <ul className="rows">
        {listings
          .sort((a, b) => (a.askPrice < b.askPrice ? -1 : 1))
          .map((t) => (
            <li key={t.id} style={{ justifyContent: 'space-between' }}>
              <span>
                Ticket <span className="id">#{t.id}</span> <span className="faint">from {shortAddress(t.owner)}</span>
              </span>
              <span style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <span className="num" style={{ fontWeight: 500 }}>
                  {price(t.askPrice, e.currency)}
                </span>
                <button className="pill pill-ghost" onClick={() => buy(t)} disabled={busy !== undefined || t.owner === address}>
                  {busy === t.id ? 'Buying…' : t.owner === address ? 'Yours' : 'Buy'}
                </button>
              </span>
            </li>
          ))}
      </ul>
      {error && <p className="notice notice-error">{error}</p>}
    </section>
  );
}
