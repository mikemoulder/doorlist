// Every read of the Doorlist contract goes through here. No sample data: what the chain says is what the screens show.
import { parseAbiItem, type Address } from 'viem';
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
  uri?: string; // latest UriSet: where its media bundle lives
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

export async function getEvent(id: number): Promise<DoorEvent> {
  const [e, uriLogs] = await Promise.all([
    read<EventTuple>('events', [BigInt(id)]),
    logs('event UriSet(uint256 indexed eventId, string uri)', { eventId: BigInt(id) }),
  ]);
  const last = uriLogs.at(-1) as unknown as { args: { uri: string } } | undefined;
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
    uri: last?.args.uri,
  };
}

/** All events, from their EventCreated logs. */
export async function getEvents(): Promise<DoorEvent[]> {
  const created = (await logs('event EventCreated(uint256 indexed eventId, address indexed organizer, string name)')) as unknown as { args: { eventId: bigint } }[];
  return Promise.all(created.map((l) => getEvent(Number(l.args.eventId))));
}

export async function getTicket(id: number): Promise<Ticket> {
  const t = await read<TicketTuple>('tickets', [BigInt(id)]);
  return { id, eventId: Number(t[0]), used: t[1], refunded: t[2], owner: t[3], askPrice: t[4] };
}

/** Tickets a wallet holds now: every token ever sent to it that it still owns. */
export async function getTicketsOf(owner: Address): Promise<Ticket[]> {
  const received = (await logs('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)', { to: owner })) as unknown as {
    args: { tokenId: bigint };
  }[];
  const ids = [...new Set(received.map((l) => Number(l.args.tokenId)))];
  const tickets = await Promise.all(ids.map(getTicket));
  return tickets.filter((t) => t.owner.toLowerCase() === owner.toLowerCase());
}

/** Check-ins per event, from CheckedIn logs: the "doors" half of doors against capacity. */
export async function getCheckIns(eventId: number): Promise<number> {
  return (await logs('event CheckedIn(uint256 indexed ticketId, uint256 indexed eventId, address door)', { eventId: BigInt(eventId) })).length;
}

/** Tickets of an event currently listed for resale. */
export async function getListings(eventId: number): Promise<Ticket[]> {
  const listed = (await logs('event Listed(uint256 indexed ticketId, uint128 price)')) as unknown as { args: { ticketId: bigint } }[];
  const ids = [...new Set(listed.map((l) => Number(l.args.ticketId)))];
  const tickets = await Promise.all(ids.map(getTicket));
  return tickets.filter((t) => t.eventId === eventId && t.askPrice > 0n && !t.used && t.owner !== NATIVE);
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
