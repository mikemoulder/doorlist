// The door pass. A ticket belongs to a wallet; the wallet signs a pass for this phone once, and the phone
// signs the ticket and the time every few seconds. The door checks both against the chain.
import { createWalletClient, http, recoverMessageAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { client, DOORLIST, doorlistAbi, portaldot } from './chain';
import { getEvent, getTicket } from './doorlist';

export const REFRESH_SECONDS = 10;
export const MAX_AGE_SECONDS = 30;

/** A key that lives in this browser only. Used for a ticket's device key, or a door's key. */
export function localKey(name: 'device' | 'door'): { address: Address; sign: (m: string) => Promise<Hex>; privateKey: Hex } {
  const storageKey = `doorlist.${name}`;
  let pk = localStorage.getItem(storageKey) as Hex | null;
  if (!pk) {
    pk = generatePrivateKey();
    localStorage.setItem(storageKey, pk);
  }
  const account = privateKeyToAccount(pk);
  return { address: account.address, sign: (message) => account.signMessage({ message }), privateKey: pk };
}

export const passMessage = (ticketId: number, device: Address) =>
  `Doorlist pass\nLet this phone show ticket #${ticketId}.\nPhone key: ${device}\nContract: ${DOORLIST}`;

export const codeMessage = (ticketId: number, ts: number) => `doorlist:${DOORLIST}:${ticketId}:${ts}`;

/** QR payload: DL1.<ticketId>.<ts>.<device>.<passSig>.<codeSig> */
export function encodeCode(ticketId: number, ts: number, device: Address, passSig: Hex, codeSig: Hex) {
  return ['DL1', ticketId, ts, device, passSig, codeSig].join('.');
}

/**
 * Who approved this phone, as the 0x address contracts see. Ethereum-style wallets sign 65 bytes (recovered
 * with ecrecover). The Portaldot Wallet signs 64 bytes with the account's sr25519/ed25519 key: the door
 * looks up the owner's 5... account on-chain (revive.originalAccount) and verifies the signature against it.
 */
async function passApprover(message: string, sig: Hex, owner: Address): Promise<Address | null> {
  if (sig.length === 2 + 65 * 2) return recoverMessageAddress({ message, signature: sig }).catch(() => null);
  if (sig.length !== 2 + 64 * 2) return null;
  const [{ substrateApi }, { signatureVerify, cryptoWaitReady }] = await Promise.all([import('./substrate'), import('@polkadot/util-crypto')]);
  const api = await substrateApi();
  const original = (await api.query.revive.originalAccount(owner)) as unknown as { isSome: boolean; unwrap: () => { toString: () => string } };
  if (!original.isSome) return null;
  await cryptoWaitReady();
  return signatureVerify(message, sig, original.unwrap().toString()).isValid ? owner : null;
}

export type Verdict =
  | { ok: true; ticketId: number; eventId: number; holder: Address; age: number }
  | { ok: false; reason: string; ticketId?: number };

/** Everything the door checks before it records the entry. */
export async function verifyCode(raw: string, eventId: number, now = Math.floor(Date.now() / 1000)): Promise<Verdict> {
  const parts = raw.trim().split('.');
  if (parts.length !== 6 || parts[0] !== 'DL1') return { ok: false, reason: 'This is not a Doorlist ticket.' };
  const [, idStr, tsStr, device, passSig, codeSig] = parts;
  const ticketId = Number(idStr);
  const ts = Number(tsStr);
  const age = now - ts;
  if (!Number.isInteger(ticketId) || !Number.isInteger(ts)) return { ok: false, reason: 'This code is damaged. Ask the guest to reopen their ticket.' };
  if (age > MAX_AGE_SECONDS) return { ok: false, ticketId, reason: `This code is ${age} seconds old: a screenshot or an old photo.` };
  if (age < -MAX_AGE_SECONDS) return { ok: false, ticketId, reason: 'The phone’s clock is wrong. Ask the guest to set the time automatically.' };
  const signer = await recoverMessageAddress({ message: codeMessage(ticketId, ts), signature: codeSig as Hex }).catch(() => null);
  if (!signer || signer.toLowerCase() !== device.toLowerCase()) return { ok: false, ticketId, reason: 'The code was not signed by the phone it names.' };
  const ticket = await getTicket(ticketId).catch(() => null);
  if (!ticket) return { ok: false, ticketId, reason: `Ticket #${ticketId} does not exist.` };
  if (ticket.eventId !== eventId) return { ok: false, ticketId, reason: `Ticket #${ticketId} is for a different event.` };
  if (ticket.owner === '0x0000000000000000000000000000000000000000') return { ok: false, ticketId, reason: `Ticket #${ticketId} was resold. The new owner has a new number.` };
  const passer = await passApprover(passMessage(ticketId, device as Address), passSig as Hex, ticket.owner).catch(() => null);
  if (!passer || passer.toLowerCase() !== ticket.owner.toLowerCase()) return { ok: false, ticketId, reason: 'This phone was not approved by the ticket’s owner.' };
  if (ticket.used) return { ok: false, ticketId, reason: `Ticket #${ticketId} has already been scanned.` };
  const event = await getEvent(eventId);
  if (event.cancelled) return { ok: false, ticketId, reason: 'This event has been cancelled.' };
  return { ok: true, ticketId, eventId, holder: ticket.owner, age };
}

/** The door records the entry with its own key: no wallet popup at the door. */
export async function checkInWithDoorKey(ticketId: number) {
  const door = localKey('door');
  const account = privateKeyToAccount(door.privateKey);
  const wallet = createWalletClient({ account, chain: portaldot, transport: http(portaldot.rpcUrls.default.http[0]) });
  const call = { address: DOORLIST, abi: doorlistAbi as never, functionName: 'checkIn' as never, args: [BigInt(ticketId)] as never, account };
  await client.simulateContract(call);
  const [gas, gasPrice] = await Promise.all([client.estimateContractGas(call), client.getGasPrice()]);
  const hash = await wallet.writeContract({ ...call, gas: (gas * 11n) / 10n, gasPrice, type: 'legacy' } as never);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('The check-in did not go through.');
  return hash;
}
