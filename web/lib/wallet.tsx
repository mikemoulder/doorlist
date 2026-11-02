'use client';
// Wallet connection (EIP-6963 discovery, falling back to window.ethereum) and every write to the chain.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, numberToHex, type Address, type Hash } from 'viem';
import { client, DOORLIST, doorlistAbi, portaldot } from './chain';

type Provider = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (e: string, f: (x: unknown) => void) => void };
type Announced = { info: { name: string; icon: string; rdns: string }; provider: Provider };

type WalletState = {
  address?: Address;
  wallets: Announced[];
  connecting: boolean;
  connect: (w?: Announced) => Promise<Address | undefined>;
  disconnect: () => void;
  write: (functionName: string, args: unknown[], opts?: { value?: bigint; to?: Address; abi?: readonly unknown[] }) => Promise<Hash>;
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
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && REASONS[name]) return REASONS[name];
    if (/rejected|denied/i.test(err.shortMessage)) return 'You cancelled the confirmation in your wallet.';
    if (/insufficient|funds/i.test(err.message)) return 'Not enough POT in this wallet for the network fee.';
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Announced[]>([]);
  const [active, setActive] = useState<Announced>();
  const [address, setAddress] = useState<Address>();
  const [connecting, setConnecting] = useState(false);

  // EIP-6963: wallets announce themselves.
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

  const connect = useCallback(
    async (w?: Announced) => {
      const target = w ?? wallets[0];
      if (!target) return undefined;
      setConnecting(true);
      try {
        const [a] = (await target.provider.request({ method: 'eth_requestAccounts' })) as Address[];
        await ensureChain(target.provider);
        setActive(target);
        setAddress(a);
        localStorage.setItem(STORAGE_KEY, target.info.rdns);
        target.provider.on?.('accountsChanged', (x) => setAddress((x as Address[])[0]));
        return a;
      } finally {
        setConnecting(false);
      }
    },
    [wallets, ensureChain],
  );

  // Reconnect silently to the wallet used last time.
  useEffect(() => {
    const rdns = localStorage.getItem(STORAGE_KEY);
    const w = wallets.find((x) => x.info.rdns === rdns);
    if (!w || active) return;
    w.provider.request({ method: 'eth_accounts' }).then((accts) => {
      const [a] = accts as Address[];
      if (a) {
        setActive(w);
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
      await ensureChain(active.provider);
      const wallet = createWalletClient({ account: address, chain: portaldot, transport: custom(active.provider) });
      const call = { address: opts.to ?? DOORLIST, abi: (opts.abi ?? doorlistAbi) as never, functionName: functionName as never, args: args as never, account: address, value: opts.value };
      await client.simulateContract(call); // surfaces the contract's own revert reason before the wallet opens
      const [gas, gasPrice] = await Promise.all([client.estimateContractGas(call), client.getGasPrice()]);
      // Legacy type with an exact price: Portaldot gas figures are large, and a 2x max fee asks for more balance than exists.
      // 10% headroom only: Revive folds storage deposits into gas, and the wallet must hold gas x price up front.
      const hash = await wallet.writeContract({ ...call, gas: (gas * 11n) / 10n, gasPrice, type: 'legacy' } as never);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('The confirmation failed on the network.');
      return hash;
    },
    [active, address, ensureChain],
  );

  const signMessage = useCallback<WalletState['signMessage']>(
    async (message) => {
      if (!active || !address) throw new Error('Sign in with your wallet first.');
      const wallet = createWalletClient({ account: address, chain: portaldot, transport: custom(active.provider) });
      return wallet.signMessage({ account: address, message });
    },
    [active, address],
  );

  const sendValue = useCallback<WalletState['sendValue']>(
    async (to, value) => {
      if (!active || !address) throw new Error('Sign in with your wallet first.');
      await ensureChain(active.provider);
      const wallet = createWalletClient({ account: address, chain: portaldot, transport: custom(active.provider) });
      const [gas, gasPrice] = await Promise.all([client.estimateGas({ account: address, to, value }), client.getGasPrice()]);
      const hash = await wallet.sendTransaction({ account: address, to, value, gas: (gas * 11n) / 10n, gasPrice, type: 'legacy' } as never);
      await client.waitForTransactionReceipt({ hash });
      return hash;
    },
    [active, address, ensureChain],
  );

  const value = useMemo(
    () => ({ address, wallets, connecting, connect, disconnect, write, signMessage, sendValue }),
    [address, wallets, connecting, connect, disconnect, write, signMessage, sendValue],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}
