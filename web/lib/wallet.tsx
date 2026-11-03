'use client';
// Wallet connection and every write to the chain. Two ways in, one app:
//  - Portaldot Wallet and other Substrate extensions (5... accounts): calls go through revive.call (lib/substrate.ts)
//  - Ethereum-style wallets (EIP-6963, falling back to window.ethereum): calls go through the eth RPC
// Either way `address` is the 0x address the contracts see, so every read works the same.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, numberToHex, type Abi, type Address, type Hash } from 'viem';
import { client, DOORLIST, doorlistAbi, portaldot } from './chain';
import {
  ContractRevert, contractAddress, ensureMapped, reviveWrite, sendNative, signText, substrateAccountsOf, substrateExtensions,
  type ContractLog, type SubstrateAccount,
} from './substrate';

type Provider = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (e: string, f: (x: unknown) => void) => void };
type Announced = { info: { name: string; icon: string; rdns: string }; provider: Provider };
type Active = { kind: 'evm'; wallet: Announced } | { kind: 'substrate'; account: SubstrateAccount };

export type WriteResult = { hash: Hash; logs: ContractLog[] };

type WalletState = {
  address?: Address;
  /** 'substrate' when signed in with a 5... account (Portaldot Wallet); its SS58 address is in `ss58`. */
  kind?: Active['kind'];
  ss58?: string;
  wallets: Announced[];
  connecting: boolean;
  connect: () => Promise<Address | undefined>;
  disconnect: () => void;
  write: (functionName: string, args: unknown[], opts?: { value?: bigint; to?: Address; abi?: readonly unknown[] }) => Promise<WriteResult>;
  signMessage: (message: string) => Promise<`0x${string}`>;
  sendValue: (to: Address, value: bigint) => Promise<Hash>;
};

const Ctx = createContext<WalletState | null>(null);
const STORAGE_KEY = 'doorlist.wallet';

/** Plain-language reasons for the contract's errors. */
const REASONS: Record<string, string> = {
  SoldOut: 'This event is sold out.',
  WalletLimit: 'That wallet already holds the most tickets the organizer allows.',
  WrongPayment: 'The payment amount did not match the price.',
  AlreadyUsed: 'This ticket has already been used, refunded or reissued.',
  NotListed: 'This ticket is no longer for sale.',
  Cancelled: 'This event has been cancelled.',
  NotCancelled: 'Refunds open only if the event is cancelled.',
  NotOwner: 'This ticket belongs to a different wallet.',
  NotOrganizer: 'Only the organizer can do this.',
  NotDoor: 'This phone is not approved as a door for this event.',
  TooEarly: 'Payout opens 24 hours after the event starts.',
  TooLate: 'The cancel window has closed.',
  RoyaltyTooHigh: 'The resale royalty can be at most 10%.',
  AlreadyClaimed: 'This wallet has already collected its test dUSD.',
  PoolEmpty: 'The test dUSD faucet is empty. Ask the Doorlist team for more.',
  PayoutFailed: 'The payment could not be completed. Check your balance and approval.',
};

export function explain(err: unknown): string {
  if (err instanceof ContractRevert) return (err.errorName && REASONS[err.errorName]) || err.message;
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && REASONS[name]) return REASONS[name];
    if (/rejected|denied/i.test(err.shortMessage)) return 'You cancelled the confirmation in your wallet.';
    if (/insufficient|funds/i.test(err.message)) return 'Not enough POT in this wallet for the network fee.';
    return err.shortMessage;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/cancelled|rejected|denied/i.test(msg)) return 'You cancelled the confirmation in your wallet.';
  if (/Inability to pay|balance too low|Payment/i.test(msg)) return 'Not enough POT in this wallet for the network fee.';
  return msg;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Announced[]>([]);
  const [active, setActive] = useState<Active>();
  const [address, setAddress] = useState<Address>();
  const [connecting, setConnecting] = useState(false);

  // EIP-6963: Ethereum-style wallets announce themselves.
  useEffect(() => {
    const seen = new Map<string, Announced>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Announced>).detail;
      if (!seen.has(d.info.rdns)) {
        seen.set(d.info.rdns, d);
        setWallets([...seen.values()]);
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const legacy = (window as unknown as { ethereum?: Provider }).ethereum;
    const t = setTimeout(() => {
      if (seen.size === 0 && legacy) setWallets([{ info: { name: 'Browser wallet', icon: '', rdns: 'injected' }, provider: legacy }]);
    }, 400);
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      clearTimeout(t);
    };
  }, []);

  const ensureChain = useCallback(async (p: Provider) => {
    const id = numberToHex(portaldot.id);
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] });
    } catch {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: id, chainName: portaldot.name, nativeCurrency: portaldot.nativeCurrency, rpcUrls: portaldot.rpcUrls.default.http }],
      });
    }
  }, []);

  const connectEvm = useCallback(
    async (target: Announced) => {
      setConnecting(true);
      try {
        const [a] = (await target.provider.request({ method: 'eth_requestAccounts' })) as Address[];
        await ensureChain(target.provider);
        setActive({ kind: 'evm', wallet: target });
        setAddress(a);
        localStorage.setItem(STORAGE_KEY, target.info.rdns);
        target.provider.on?.('accountsChanged', (x) => setAddress((x as Address[])[0]));
        return a;
      } finally {
        setConnecting(false);
      }
    },
    [ensureChain],
  );

  const connectSubstrate = useCallback(async (account: SubstrateAccount) => {
    setConnecting(true);
    try {
      const a = await contractAddress(account.ss58);
      await ensureMapped(account);
      setActive({ kind: 'substrate', account });
      setAddress(a);
      localStorage.setItem(STORAGE_KEY, `sub:${account.source}:${account.ss58}`);
      return a;
    } finally {
      setConnecting(false);
    }
  }, []);

  // connect() opens the chooser and resolves once the person picks an account or closes it.
  const [picking, setPicking] = useState(false);
  const pending = useRef<(a: Address | undefined) => void>(undefined);

  const connect = useCallback(() => {
    setPicking(true);
    return new Promise<Address | undefined>((resolve) => {
      pending.current = resolve;
    });
  }, []);

  const closePicker = useCallback((a?: Address) => {
    setPicking(false);
    pending.current?.(a);
    pending.current = undefined;
  }, []);

  // Reconnect silently to the wallet used last time.
  useEffect(() => {
    if (active) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    if (saved.startsWith('sub:')) {
      const [, source, ss58] = saved.split(':');
      const t = setTimeout(() => {
        if (!substrateExtensions().some((x) => x.source === source)) return;
        substrateAccountsOf(source)
          .then((accts) => accts.find((x) => x.ss58 === ss58))
          .then(async (account) => {
            if (!account) return;
            setActive({ kind: 'substrate', account });
            setAddress(await contractAddress(account.ss58));
          })
          .catch(() => undefined);
      }, 300);
      return () => clearTimeout(t);
    }
    const w = wallets.find((x) => x.info.rdns === saved);
    if (!w) return;
    w.provider.request({ method: 'eth_accounts' }).then((accts) => {
      const [a] = accts as Address[];
      if (a) {
        setActive({ kind: 'evm', wallet: w });
        setAddress(a);
        w.provider.on?.('accountsChanged', (x) => setAddress((x as Address[])[0]));
      }
    });
  }, [wallets, active]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setActive(undefined);
    setAddress(undefined);
  }, []);

  const write = useCallback<WalletState['write']>(
    async (functionName, args, opts = {}) => {
      if (!active || !address) throw new Error('Sign in with your wallet first.');
      const to = opts.to ?? DOORLIST;
      const abi = (opts.abi ?? doorlistAbi) as Abi;
      if (active.kind === 'substrate') return reviveWrite(active.account, { to, abi, functionName, args, value: opts.value });

      await ensureChain(active.wallet.provider);
      const wallet = createWalletClient({ account: address, chain: portaldot, transport: custom(active.wallet.provider) });
      const call = { address: to, abi: abi as never, functionName: functionName as never, args: args as never, account: address, value: opts.value };
      await client.simulateContract(call); // surfaces the contract's own revert reason before the wallet opens
      const [gas, gasPrice] = await Promise.all([client.estimateContractGas(call), client.getGasPrice()]);
      // Legacy type with an exact price: Portaldot gas figures are large, and a 2x max fee asks for more balance than exists.
      // 10% headroom only: Revive folds storage deposits into gas, and the wallet must hold gas x price up front.
      const hash = await wallet.writeContract({ ...call, gas: (gas * 11n) / 10n, gasPrice, type: 'legacy' } as never);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('The confirmation failed on the network.');
      return { hash, logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics as ContractLog['topics'], data: l.data })) };
    },
    [active, address, ensureChain],
  );

  const signMessage = useCallback<WalletState['signMessage']>(
    async (message) => {
      if (!active || !address) throw new Error('Sign in with your wallet first.');
      if (active.kind === 'substrate') return signText(active.account, message);
      const wallet = createWalletClient({ account: address, chain: portaldot, transport: custom(active.wallet.provider) });
      return wallet.signMessage({ account: address, message });
    },
    [active, address],
  );

  const sendValue = useCallback<WalletState['sendValue']>(
    async (to, value) => {
      if (!active || !address) throw new Error('Sign in with your wallet first.');
      if (active.kind === 'substrate') return (await sendNative(active.account, to, value)).hash;
      await ensureChain(active.wallet.provider);
      const wallet = createWalletClient({ account: address, chain: portaldot, transport: custom(active.wallet.provider) });
      const [gas, gasPrice] = await Promise.all([client.estimateGas({ account: address, to, value }), client.getGasPrice()]);
      const hash = await wallet.sendTransaction({ account: address, to, value, gas: (gas * 11n) / 10n, gasPrice, type: 'legacy' } as never);
      await client.waitForTransactionReceipt({ hash });
      return hash;
    },
    [active, address, ensureChain],
  );

  const kind = active?.kind;
  const ss58 = active?.kind === 'substrate' ? active.account.ss58 : undefined;
  const value = useMemo(
    () => ({ address, kind, ss58, wallets, connecting, connect, disconnect, write, signMessage, sendValue }),
    [address, kind, ss58, wallets, connecting, connect, disconnect, write, signMessage, sendValue],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {picking && (
        <WalletPicker
          wallets={wallets}
          connecting={connecting}
          onEvm={connectEvm}
          onSubstrate={connectSubstrate}
          onDone={closePicker}
        />
      )}
    </Ctx.Provider>
  );
}

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

function WalletPicker({ wallets, connecting, onEvm, onSubstrate, onDone }: {
  wallets: Announced[];
  connecting: boolean;
  onEvm: (w: Announced) => Promise<Address>;
  onSubstrate: (a: SubstrateAccount) => Promise<Address>;
  onDone: (a?: Address) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [extensions, setExtensions] = useState<{ source: string; title: string; icon?: string }[]>([]);
  const [accounts, setAccounts] = useState<{ title: string; list: SubstrateAccount[] }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    ref.current?.showModal();
    // Extensions inject at document start, but give a slow one a moment.
    setExtensions(substrateExtensions());
    const t = setTimeout(() => setExtensions(substrateExtensions()), 500);
    return () => clearTimeout(t);
  }, []);

  async function run(f: () => Promise<Address>) {
    setError(undefined);
    try {
      onDone(await f());
    } catch (err) {
      setError(explain(err));
    }
  }

  async function openExtension(source: string, title: string) {
    setError(undefined);
    try {
      const list = await substrateAccountsOf(source);
      if (!list.length) throw new Error(`${title} has no Portaldot (5…) account yet. Create one in the wallet, then try again.`);
      if (list.length === 1) return run(() => onSubstrate(list[0]));
      setAccounts({ title, list });
    } catch (err) {
      setError(explain(err));
    }
  }

  const none = !extensions.length && !wallets.length;
  return (
    <dialog ref={ref} className="picker" aria-labelledby="picker-title" onClose={() => onDone()} onClick={(e) => e.target === ref.current && onDone()}>
      <div className="picker-body">
        <h2 id="picker-title">{accounts ? `Choose an account in ${accounts.title}` : 'Sign in with a wallet'}</h2>
        {accounts ? (
          <ul>
            {accounts.list.map((a) => (
              <li key={a.ss58}>
                <button className="picker-row" onClick={() => run(() => onSubstrate(a))} disabled={connecting}>
                  <span className="picker-blank" aria-hidden="true" />
                  <span>
                    {a.name ?? 'Account'} <span className="faint">{short(a.ss58)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : none ? (
          <p className="muted">No wallet found in this browser. Install the Portaldot Wallet from portaldot.world, then reload this page.</p>
        ) : (
          <ul>
            {extensions.map((x) => (
              <li key={`sub-${x.source}`}>
                <button className="picker-row" onClick={() => openExtension(x.source, x.title)} disabled={connecting}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- tiny static icon; next/image is off in the static export */}
                  {x.icon ? <img src={x.icon} alt="" width={28} height={28} /> : <span className="picker-blank" aria-hidden="true" />}
                  <span>{x.title}</span>
                </button>
              </li>
            ))}
            {wallets.map((w) => (
              <li key={w.info.rdns}>
                <button className="picker-row" onClick={() => run(() => onEvm(w))} disabled={connecting}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data URIs from EIP-6963 */}
                  {w.info.icon ? <img src={w.info.icon} alt="" width={28} height={28} /> : <span className="picker-blank" aria-hidden="true" />}
                  <span>
                    {w.info.name} <span className="faint">(0x account)</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {connecting && <p className="faint">Check your wallet to approve the sign-in.</p>}
        {error && <p className="notice notice-error">{error}</p>}
        <div className="picker-foot">
          {none && (
            <a className="pill pill-primary" href="https://www.portaldot.world" target="_blank" rel="noreferrer">
              Get the Portaldot Wallet
            </a>
          )}
          {accounts && (
            <button className="pill pill-ghost" onClick={() => setAccounts(undefined)}>
              Back
            </button>
          )}
          <button className="pill pill-ghost" onClick={() => onDone()}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}
