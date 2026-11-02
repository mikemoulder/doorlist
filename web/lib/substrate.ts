// The Portaldot-native way into the contracts: a Substrate (5...) account from the official Portaldot
// Wallet (or polkadot.js, SubWallet, Talisman) calls Solidity through pallet_revive's `revive.call`.
// Proven live by scripts/check-substrate-path.mjs. The account's contract-side address is
// reviveApi.address(ss58); on this chain a funded account is already mapped, else we call mapAccount.
import type { ApiPromise } from '@polkadot/api';
import { decodeErrorResult, encodeFunctionData, type Abi, type Address, type Hex } from 'viem';
import { SUBSTRATE_WS } from './chain';

type InjectedAccount = { address: string; name?: string; type?: string };
type InjectedSigner = { signRaw?: (r: { address: string; data: string; type: 'bytes' }) => Promise<{ signature: Hex }> };
type Injected = { accounts: { get: () => Promise<InjectedAccount[]> }; signer: InjectedSigner };
type InjectedWindow = { injectedWeb3?: Record<string, { enable: (origin: string) => Promise<Injected>; version?: string }> };

type Big = { toBigInt: () => bigint };
/** reviveApi.call's result, as returned by the live chain (see scripts/check-substrate-path.mjs). */
type DryRun = {
  weightRequired: { refTime: Big; proofSize: Big };
  maxStorageDeposit: { isCharge: boolean; asCharge: Big };
  result: { isErr: boolean; asErr: { toString: () => string }; asOk: { flags: { bits: { toNumber: () => number } }; data: { toHex: () => Hex } } };
};

export type SubstrateAccount = { ss58: string; name?: string; source: string };
export type ContractLog = { address: Address; topics: Hex[]; data: Hex };

/** Readable names for the extensions people are likely to have. The official one comes first. */
const TITLES: Record<string, string> = {
  'portaldot extension': 'Portaldot Wallet',
  'subwallet-js': 'SubWallet (Portaldot account)',
  'polkadot-js': 'polkadot{.js}',
  talisman: 'Talisman',
};

/** Substrate extensions present in this browser, official Portaldot Wallet first. */
export function substrateExtensions(): { source: string; title: string }[] {
  const injected = (window as unknown as InjectedWindow).injectedWeb3 ?? {};
  return Object.keys(injected)
    .map((source) => ({ source, title: TITLES[source] ?? source }))
    .sort((a, b) => Number(b.source === 'portaldot extension') - Number(a.source === 'portaldot extension'));
}

const enabled = new Map<string, Promise<Injected>>();
function enable(source: string) {
  if (!enabled.has(source)) {
    const ext = (window as unknown as InjectedWindow).injectedWeb3?.[source];
    if (!ext) throw new Error('That wallet is no longer available in this browser. Reload the page.');
    enabled.set(source, ext.enable('Doorlist').catch((e) => { enabled.delete(source); throw e; }));
  }
  return enabled.get(source)!;
}

/** Asks the extension for access and lists its Substrate accounts (Ethereum-type keys are left out). */
export async function substrateAccountsOf(source: string): Promise<SubstrateAccount[]> {
  const ext = await enable(source);
  const all = await ext.accounts.get();
  return all.filter((a) => a.type !== 'ethereum' && !a.address.startsWith('0x')).map((a) => ({ ss58: a.address, name: a.name, source }));
}

let apiP: Promise<ApiPromise> | undefined;
export function substrateApi(): Promise<ApiPromise> {
  apiP ??= import('@polkadot/api').then(({ ApiPromise, WsProvider }) =>
    ApiPromise.create({ provider: new WsProvider(SUBSTRATE_WS), noInitWarn: true }),
  ).catch((e) => { apiP = undefined; throw e; });
  return apiP;
}

/** The address contracts see for this account (msg.sender, ticket owner). */
export async function contractAddress(ss58: string): Promise<Address> {
  const api = await substrateApi();
  return (await api.call.reviveApi.address(ss58)).toString() as Address;
}

/** A contract call refused by the contract, with the Solidity error name when it is in the ABI. */
export class ContractRevert extends Error {
  constructor(public errorName: string | undefined) {
    super(errorName ? `The contract refused: ${errorName}` : 'The contract refused this action.');
  }
}

type Submittable = { signAndSend: (a: string, o: { signer: unknown }, cb: (r: SubResult) => void) => Promise<unknown> };
type SubResult = {
  status: { isInBlock: boolean; asInBlock: { toHex: () => Hex } };
  dispatchError?: { isModule: boolean; asModule: unknown; toString: () => string };
  events: { event: { section: string; method: string; data: unknown[] } }[];
  txHash: { toHex: () => Hex };
};

async function send(account: SubstrateAccount, tx: Submittable): Promise<{ hash: Hex; logs: ContractLog[] }> {
  const api = await substrateApi();
  const { signer } = await enable(account.source);
  return new Promise((resolve, reject) => {
    tx.signAndSend(account.ss58, { signer }, ({ status, dispatchError, events, txHash }) => {
      if (dispatchError) {
        if (dispatchError.isModule) {
          const { section, name } = api.registry.findMetaError(dispatchError.asModule as never);
          return reject(new Error(`Portaldot refused the transaction (${section}.${name}).`));
        }
        return reject(new Error(dispatchError.toString()));
      }
      if (!status.isInBlock) return;
      const logs = events
        .filter(({ event }) => event.section === 'revive' && event.method === 'ContractEmitted')
        .map(({ event }) => {
          const [contract, data, topics] = event.data as [{ toString: () => string }, { toHex: () => Hex }, { toHex: () => Hex }[]];
          return { address: contract.toString() as Address, data: data.toHex(), topics: topics.map((t) => t.toHex()) };
        });
      resolve({ hash: txHash.toHex(), logs });
    }).catch(reject);
  });
}

/** Links the account to its contract address if the chain has not already. Free when already linked. */
export async function ensureMapped(account: SubstrateAccount) {
  const api = await substrateApi();
  const h160 = await contractAddress(account.ss58);
  if (((await api.query.revive.originalAccount(h160)) as unknown as { isSome: boolean }).isSome) return;
  await send(account, api.tx.revive.mapAccount() as unknown as Submittable);
}

/** EVM values are 18 decimals; native POT on Portaldot is 14. */
function toNative(wei: bigint) {
  if (wei % 10_000n !== 0n) throw new Error('That amount has more decimals than POT supports.');
  return wei / 10_000n;
}

/** Calls a contract as a Substrate account: dry run for weight, deposit and revert reason, then revive.call. */
export async function reviveWrite(
  account: SubstrateAccount,
  call: { to: Address; abi: Abi; functionName: string; args: unknown[]; value?: bigint },
): Promise<{ hash: Hex; logs: ContractLog[] }> {
  const api = await substrateApi();
  await ensureMapped(account);
  const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args } as never);
  const value = toNative(call.value ?? 0n);
  const dry = (await api.call.reviveApi.call(account.ss58, call.to, value, null, null, data)) as unknown as DryRun;
  if (dry.result.isErr) throw new Error(`Portaldot could not run this: ${dry.result.asErr.toString()}`);
  const ok = dry.result.asOk;
  if (ok.flags.bits.toNumber() & 1) {
    let name: string | undefined;
    try {
      name = decodeErrorResult({ abi: call.abi, data: ok.data.toHex() }).errorName;
    } catch {
      name = undefined;
    }
    throw new ContractRevert(name);
  }
  // Small headroom on both limits; Revive charges only what is used.
  const w = dry.weightRequired;
  const weight = { refTime: (w.refTime.toBigInt() * 12n) / 10n, proofSize: (w.proofSize.toBigInt() * 12n) / 10n };
  const deposit = dry.maxStorageDeposit.isCharge ? (dry.maxStorageDeposit.asCharge.toBigInt() * 11n) / 10n : 0n;
  return send(account, api.tx.revive.call(call.to, value, weight, deposit, data) as unknown as Submittable);
}

/** Sends native POT to a contract-side (0x) address, through its Substrate twin. */
export async function sendNative(account: SubstrateAccount, to: Address, wei: bigint) {
  const api = await substrateApi();
  const dest = (await api.call.reviveApi.accountId(to)).toString();
  return send(account, api.tx.balances.transferKeepAlive(dest, toNative(wei)) as unknown as Submittable);
}

/** Signs a text message with the account's Substrate key (sr25519 or ed25519), as the extension wraps it. */
export async function signText(account: SubstrateAccount, message: string): Promise<Hex> {
  const { signer } = await enable(account.source);
  if (!signer.signRaw) throw new Error('This wallet cannot sign messages.');
  const { stringToHex } = await import('@polkadot/util');
  return (await signer.signRaw({ address: account.ss58, data: stringToHex(message), type: 'bytes' })).signature;
}
