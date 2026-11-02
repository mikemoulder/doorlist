'use client';
import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { decodeEventLog, formatEther, parseEther, parseUnits } from 'viem';
import { client, DOORLIST, doorlistAbi, DUSD, NATIVE } from '@/lib/chain';
import { compressImage, storeMedia, substrateAccounts, type MediaBundle } from '@/lib/media';
import { explain, useWallet } from '@/lib/wallet';

type Form = {
  name: string; date: string; time: string; capacity: string; currency: 'dUSD' | 'POT'; price: string;
  perWallet: string; royalty: string; venue: string; description: string; image?: string; ticket?: string;
};

export function CreateEvent({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const { address, write } = useWallet();
  const [f, setF] = useState<Form>({ name: '', date: '', time: '19:00', capacity: '100', currency: 'dUSD', price: '25', perWallet: '4', royalty: '5', venue: '', description: '' });
  const [accounts, setAccounts] = useState<{ address: string; meta: { name?: string } }[]>();
  const [subAccount, setSubAccount] = useState<string>();
  const [deposit, setDeposit] = useState<bigint>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const startsAt = f.date ? Math.floor(new Date(`${f.date}T${f.time || '00:00'}`).getTime() / 1000) : 0;
  const hasMedia = !!(f.image || f.ticket || f.description || f.venue);
  const currency = f.currency === 'dUSD' ? DUSD.address : NATIVE;
  const priceUnits = (() => {
    try {
      return f.currency === 'dUSD' ? parseUnits(f.price || '0', DUSD.decimals) : parseEther(f.price || '0');
    } catch {
      return 0n;
    }
  })();
  const valid = f.name.trim().length > 1 && startsAt > Date.now() / 1000 && Number(f.capacity) > 0 && priceUnits > 0n && Number(f.royalty) <= 10;
  const args = (uri: string) => [f.name.trim(), BigInt(startsAt), Number(f.capacity), priceUnits, currency, Number(f.perWallet || 0), Math.round(Number(f.royalty || 0) * 100), uri];

  // What Portaldot will hold as a storage deposit for this event, estimated by the chain itself.
  useEffect(() => {
    if (!valid || !address) return setDeposit(undefined);
    const t = setTimeout(async () => {
      try {
        const [gas, gasPrice] = await Promise.all([
          client.estimateContractGas({ address: DOORLIST, abi: doorlistAbi as never, functionName: 'createEvent' as never, args: args('tstore:0:0:0x' + '0'.repeat(64)) as never, account: address }),
          client.getGasPrice(),
        ]);
        setDeposit(gas * gasPrice);
      } catch {
        setDeposit(undefined);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, address, f.name, startsAt, f.capacity, priceUnits, f.perWallet, f.royalty, currency]);

  useEffect(() => {
    if (!hasMedia || accounts) return;
    substrateAccounts()
      .then((a) => {
        setAccounts(a);
        setSubAccount(a[0]?.address);
      })
      .catch((err) => setError(explain(err)));
  }, [hasMedia, accounts]);

  async function pick(kind: 'image' | 'ticket', file?: File) {
    if (!file) return;
    const url = await compressImage(file, kind === 'image' ? 1400 : 1000);
    setF((x) => ({ ...x, [kind]: url }));
  }

  async function submit() {
    setError(undefined);
    try {
      let uri = '';
      if (hasMedia) {
        if (!subAccount) throw new Error('Choose the Portaldot account that uploads the pictures.');
        const bundle: MediaBundle = { v: 1, description: f.description.trim(), venue: f.venue.trim(), image: f.image, ticket: f.ticket };
        uri = await storeMedia(bundle, subAccount, setStatus);
      }
      setStatus('Confirm the event in your wallet…');
      const hash = await write('createEvent', args(uri));
      const receipt = await client.getTransactionReceipt({ hash });
      const created = receipt.logs
        .filter((l) => l.address.toLowerCase() === DOORLIST.toLowerCase())
        .map((l) => {
          try {
            return decodeEventLog({ abi: doorlistAbi as never, data: l.data, topics: l.topics }) as unknown as { eventName: string; args: { eventId: bigint } };
          } catch {
            return null;
          }
        })
        .find((x) => x?.eventName === 'EventCreated');
      onCreated(Number(created?.args.eventId ?? 0));
    } catch (err) {
      setError(explain(err));
    } finally {
      setStatus(undefined);
    }
  }

  const bytes = new Blob([JSON.stringify({ image: f.image, ticket: f.ticket, description: f.description })]).size;
  return (
    <form
      className="create"
      onSubmit={(x) => {
        x.preventDefault();
        submit();
      }}
    >
      <section className="card form-grid">
        <h2 className="form-h">The event</h2>
        <Field id="name" label="Name" wide>
          <input id="name" className="input" maxLength={48} value={f.name} onChange={(x) => set('name')(x.target.value)} required />
        </Field>
        <Field id="date" label="Date">
          <input id="date" type="date" className="input" value={f.date} onChange={(x) => set('date')(x.target.value)} required />
        </Field>
        <Field id="time" label="Doors open">
          <input id="time" type="time" className="input" value={f.time} onChange={(x) => set('time')(x.target.value)} required />
        </Field>
        <Field id="venue" label="Venue" wide>
          <input id="venue" className="input" value={f.venue} onChange={(x) => set('venue')(x.target.value)} />
        </Field>
        <Field id="description" label="Description" wide>
          <textarea id="description" className="input" value={f.description} onChange={(x) => set('description')(x.target.value)} />
        </Field>

        <h2 className="form-h">Tickets</h2>
        <Field id="capacity" label="How many">
          <input id="capacity" className="input num" inputMode="numeric" value={f.capacity} onChange={(x) => set('capacity')(x.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field id="price" label="Price" help={f.currency === 'dUSD' ? 'In dollars (dUSD).' : 'In POT.'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="price" className="input num" inputMode="decimal" value={f.price} onChange={(x) => set('price')(x.target.value.replace(/[^0-9.]/g, ''))} aria-describedby="price-help" />
            <div className="seg" role="group" aria-label="Currency">
              {(['dUSD', 'POT'] as const).map((c) => (
                <button type="button" key={c} aria-pressed={f.currency === c} onClick={() => set('currency')(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </Field>
        <Field id="perWallet" label="Most tickets per person" help="0 means no limit.">
          <input id="perWallet" className="input num" inputMode="numeric" value={f.perWallet} onChange={(x) => set('perWallet')(x.target.value.replace(/\D/g, ''))} aria-describedby="perWallet-help" />
        </Field>
        <Field id="royalty" label="Your cut of resales (%)" help="Up to 10%. Paid to you each time a ticket is resold.">
          <input id="royalty" className="input num" inputMode="decimal" value={f.royalty} onChange={(x) => set('royalty')(x.target.value.replace(/[^0-9.]/g, ''))} aria-describedby="royalty-help" />
        </Field>

        <h2 className="form-h">Pictures</h2>
        <ImagePick label="Event picture" value={f.image} onPick={(file) => pick('image', file)} />
        <ImagePick label="Ticket design" value={f.ticket} onPick={(file) => pick('ticket', file)} />
        {hasMedia && (
          <Field id="sub" label="Upload with" wide help={`Pictures and details are stored on Portaldot (${Math.round(bytes / 1024)} KB, a fee of a fraction of a POT). They need renewing weekly from this page.`}>
            {accounts?.length ? (
              <select id="sub" className="input" value={subAccount} onChange={(x) => setSubAccount(x.target.value)} aria-describedby="sub-help">
                {accounts.map((a) => (
                  <option key={a.address} value={a.address}>
                    {a.meta.name ?? 'Account'} · {a.address.slice(0, 6)}…{a.address.slice(-4)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="faint" style={{ fontSize: 14 }}>Looking for a Portaldot wallet (SubWallet, polkadot.js, Talisman)…</p>
            )}
          </Field>
        )}
      </section>

      <aside className="ev-side">
        <section className="card" style={{ display: 'grid', gap: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Before you create it</h2>
          <ul className="kv">
            <li>
              <span>Storage deposit</span>
              <span className="num">{deposit !== undefined ? `≈ ${Number(formatEther(deposit)).toFixed(2)} POT` : '—'}</span>
            </li>
            <li>
              <span>Doorlist fee</span>
              <span>3% of each sale</span>
            </li>
            <li>
              <span>You’re paid</span>
              <span>24 h after doors open</span>
            </li>
          </ul>
          <p className="faint" style={{ fontSize: 13 }}>
            Portaldot holds a deposit for the space the event takes on the network. Creating an event is otherwise free.
          </p>
          {error && <p className="notice notice-error">{error}</p>}
          <button className="pill pill-primary pill-lg" disabled={!valid || !!status}>
            {status ?? (hasMedia ? 'Upload and create' : 'Create event')}
          </button>
          <button type="button" className="pill pill-ghost" onClick={onCancel} disabled={!!status}>
            Cancel
          </button>
        </section>
      </aside>
    </form>
  );
}

function Field({ id, label, help, wide, children }: { id: string; label: string; help?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'wide' : undefined}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {help && (
        <p id={`${id}-help`} className="field-help">
          {help}
        </p>
      )}
    </div>
  );
}

function ImagePick({ label, value, onPick }: { label: string; value?: string; onPick: (f?: File) => void }) {
  return (
    <label className="pick">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt={label} />
      ) : (
        <span>
          <ImagePlus size={20} strokeWidth={1.5} aria-hidden="true" />
          {label}
        </span>
      )}
      <input type="file" accept="image/*" className="sr-only" onChange={(x) => onPick(x.target.files?.[0])} />
    </label>
  );
}
