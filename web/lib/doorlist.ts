// Every read of the Doorlist contract goes through here. No sample data: what the chain says is what the screens show.
import { decodeAbiParameters, parseAbiItem, toEventSelector, type Address, type Hex } from 'viem';
import { client, DOORLIST, DEPLOY_BLOCK, doorlistAbi, DUSD, NATIVE } from './chain';

export type Currency = { address: Address; symbol: string; decimals: number };

export type DoorEvent = {
  id: number;
  organizer: Address;
  startsAt: number; // unix seconds
  capacity: number;
  sold: number;
  maxPerWallet: number;
  royaltyBps: number;
  cancelled: boolean;
  price: bigint;
  escrowed: bigint;
  currency: Currency;
  name: string;
  uri?: string; // latest UriSet from eth logs; '' = no media; undefined = no log seen (Portaldot Wallet), see resolveUri
};

export type Ticket = {
  id: number;
  eventId: number;
  used: boolean;
  refunded: boolean;
  owner: Address;
  askPrice: bigint;
};

export const PAYOUT_DELAY = 24 * 60 * 60;
export const FEE_BPS = 300;

export function currencyOf(address: Address): Currency {
  if (address.toLowerCase() === DUSD.address.toLowerCase()) return { address, symbol: DUSD.symbol, decimals: DUSD.decimals };
  if (address === NATIVE) return { address, symbol: 'POT', decimals: 18 };
  return { address, symbol: 'token', decimals: 18 };
}

const read = <T>(functionName: string, args: unknown[]) =>
  client.readContract({ address: DOORLIST, abi: doorlistAbi, functionName, args }) as Promise<T>;

type EventTuple = [Address, bigint, number, number, number, number, boolean, bigint, bigint, Address, string];
type TicketTuple = [bigint, boolean, boolean, Address, bigint];

const logs = (event: string, args?: Record<string, unknown>) =>
  client.getLogs({ address: DOORLIST, event: parseAbiItem(event) as never, args: args as never, fromBlock: DEPLOY_BLOCK, toBlock: 'latest' });

const URI_SET = 'event UriSet(uint256 indexed eventId, string uri)';

/**
 * The media link an event was created with, for events created from a Portaldot Wallet (revive.call), whose logs
 * Portaldot's Ethereum RPC never indexes. Binary-searches the creation block with historical eth_call reads
 * (events(id) exists from that block on), then reads that one block's revive.ContractEmitted events on the
 * Substrate side. Cached per event in this browser: a creation link never changes.
 * Not covered: a later setUri sent from a Portaldot Wallet.
 */
export async function uriFromSubstrate(id: number): Promise<string | undefined> {
  const key = `doorlist.uri.${DOORLIST}.${id}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached !== null) return cached || undefined; // '' = created without media
  } catch {}
  const exists = (blockNumber: bigint) =>
    client.readContract({ address: DOORLIST, abi: doorlistAbi, functionName: 'events', args: [BigInt(id)], blockNumber }).then(() => true, () => false);
  let lo = DEPLOY_BLOCK;
  let hi = await client.getBlockNumber();
  if (!(await exists(hi))) return undefined;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (await exists(mid)) hi = mid;
    else lo = mid + 1n;
  }
  const { substrateApi } = await import('./substrate');
  const api = await substrateApi();
  const hash = await api.rpc.chain.getBlockHash(Number(lo));
  const records = (await api.query.system.events.at(hash)) as unknown as { event: { section: string; method: string; data: unknown[] } }[];
  const topic0 = toEventSelector(parseAbiItem(URI_SET) as never).toLowerCase();
  for (const { event } of records) {
    if (event.section !== 'revive' || event.method !== 'ContractEmitted') continue;
    const [contract, data, topics] = event.data as [{ toString: () => string }, { toHex: () => Hex }, { toHex: () => Hex }[]];
    if (contract.toString().toLowerCase() !== DOORLIST.toLowerCase()) continue;
    const t = topics.map((x) => x.toHex().toLowerCase());
    if (t[0] !== topic0 || BigInt(t[1]) !== BigInt(id)) continue;
    const [uri] = decodeAbiParameters([{ type: 'string' }], data.toHex());
    try {
      localStorage.setItem(key, uri);
    } catch {}
    return uri || undefined;
  }
  return undefined;
}

export async function getEvent(id: number): Promise<DoorEvent> {
  const [e, uriLogs] = await Promise.all([read<EventTuple>('events', [BigInt(id)]), logs(URI_SET, { eventId: BigInt(id) })]);
  const last = uriLogs.at(-1) as unknown as { args: { uri: string } } | undefined;
  const uri = last ? last.args.uri : undefined; // the Substrate lookup runs later, in useMedia, so the page does not wait
  return {
    id,
    organizer: e[0],
    startsAt: Number(e[1]),
    capacity: Number(e[2]),
    sold: Number(e[3]),
    maxPerWallet: Number(e[4]),
    royaltyBps: Number(e[5]),
    cancelled: e[6],
    price: e[7],
    escrowed: e[8],
    currency: currencyOf(e[9]),
    name: e[10],
    uri,
  };
}

/**
 * Walks a public storage array (events, tickets) from index 0 until an index does not exist.
 * Storage, not logs: Portaldot's Ethereum RPC only indexes logs of Ethereum-style transactions, so anything done
 * from a Portaldot Wallet (a revive.call from a 5... account) never shows up in eth_getLogs.
 */
async function walk<T>(get: (i: number) => Promise<T>, batch = 8): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; ; start += batch) {
    const got = await Promise.all(Array.from({ length: batch }, (_, k) => get(start + k).then((v) => ({ v }), () => null)));
    for (const g of got) {
      if (!g) return out;
      out.push(g.v);
    }
  }
}

let ticketsCache: { at: number; p: Promise<Ticket[]> } | undefined;
/** Every ticket ever issued, read from storage (cached for a few seconds so one screen does one walk). */
function allTickets(): Promise<Ticket[]> {
  if (!ticketsCache || Date.now() - ticketsCache.at > 5000) ticketsCache = { at: Date.now(), p: walk(getTicket) };
  return ticketsCache.p;
}

/** All events, read from contract storage. */
export async function getEvents(): Promise<DoorEvent[]> {
  return walk(getEvent, 4);
}

export async function getTicket(id: number): Promise<Ticket> {
  const t = await read<TicketTuple>('tickets', [BigInt(id)]);
  return { id, eventId: Number(t[0]), used: t[1], refunded: t[2], owner: t[3], askPrice: t[4] };
}

/** Tickets a wallet holds now. */
export async function getTicketsOf(owner: Address): Promise<Ticket[]> {
  return (await allTickets()).filter((t) => t.owner.toLowerCase() === owner.toLowerCase());
}

/** Check-ins per event: the "doors" half of doors against capacity. A scanned ticket keeps used = true. */
export async function getCheckIns(eventId: number): Promise<number> {
  return (await allTickets()).filter((t) => t.eventId === eventId && t.used).length;
}

/** Tickets of an event currently listed for resale. */
export async function getListings(eventId: number): Promise<Ticket[]> {
  return (await allTickets()).filter((t) => t.eventId === eventId && t.askPrice > 0n && !t.used && t.owner !== NATIVE);
}

export const isDoor = (eventId: number, door: Address) => read<boolean>('isDoor', [BigInt(eventId), door]);
export const heldBy = (eventId: number, holder: Address) => read<bigint>('held', [BigInt(eventId), holder]).then(Number);

export function phase(e: DoorEvent, now = Date.now() / 1000) {
  if (e.cancelled) return 'cancelled' as const;
  if (now >= e.startsAt + PAYOUT_DELAY) return 'past' as const;
  if (now >= e.startsAt) return 'live' as const;
  if (e.sold >= e.capacity) return 'soldout' as const;
  return 'onsale' as const;
}
