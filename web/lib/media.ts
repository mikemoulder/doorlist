// Event media lives on Portaldot itself, in the runtime's transactionStorage pallet.
// One bundle per event: { v, description, venue, image, ticket } with images as data URLs.
// Location: "tstore:<block>:<extrinsicIndex>:<blake2-256>". Data is kept ~7 days unless renewed.
import { SUBSTRATE_WS } from './chain';

export type MediaBundle = { v: 1; description: string; venue: string; image?: string; ticket?: string };

const HTTP_RPC = SUBSTRATE_WS.replace('wss://', 'https://');
const cache = new Map<string, Promise<MediaBundle | null>>();

export function parseUri(uri?: string) {
  const m = uri?.match(/^tstore:(\d+):(\d+):(0x[0-9a-f]{64})$/i);
  return m ? { block: Number(m[1]), index: Number(m[2]), hash: m[3].toLowerCase() } : null;
}

async function api(ws = false) {
  const { ApiPromise, HttpProvider, WsProvider } = await import('@polkadot/api');
  const provider = ws ? new WsProvider(SUBSTRATE_WS) : new HttpProvider(HTTP_RPC);
  return ApiPromise.create({ provider, noInitWarn: true });
}

/** Fetch and verify an event's media bundle. null when missing, expired or not matching its hash. */
export function loadMedia(uri?: string): Promise<MediaBundle | null> {
  const loc = parseUri(uri);
  if (!loc || !uri) return Promise.resolve(null);
  if (!cache.has(uri)) {
    cache.set(
      uri,
      (async () => {
        try {
          const [{ blake2AsHex }, { u8aToString }] = await Promise.all([import('@polkadot/util-crypto'), import('@polkadot/util')]);
          const a = await api();
          const hash = await a.rpc.chain.getBlockHash(loc.block);
          const { block } = await a.rpc.chain.getBlock(hash);
          const xt = block.extrinsics[loc.index];
          if (!xt || xt.method.section !== 'transactionStorage') return null;
          const data = (xt.method.args[0] as unknown as { toU8a: (b: boolean) => Uint8Array }).toU8a(true);
          if (blake2AsHex(data).toLowerCase() !== loc.hash) return null;
          return JSON.parse(u8aToString(data)) as MediaBundle;
        } catch {
          return null;
        }
      })(),
    );
  }
  return cache.get(uri)!;
}

/** Shrink an image file in the browser to a WebP data URL no wider than maxWidth. */
export async function compressImage(file: File, maxWidth: number, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', quality);
}

/** The organizer's Substrate accounts, from SubWallet / polkadot.js / Talisman. */
export async function substrateAccounts() {
  const { web3Enable, web3Accounts } = await import('@polkadot/extension-dapp');
  const exts = await web3Enable('Doorlist');
  if (!exts.length) throw new Error('No Substrate wallet found. Install SubWallet (it also works for the EVM side).');
  return (await web3Accounts()).filter((a) => a.type === 'sr25519' || a.type === 'ed25519');
}

/** Store a bundle on Portaldot; resolves with its tstore: location once it is in a block. */
export async function storeMedia(bundle: MediaBundle, address: string, onStatus?: (s: string) => void): Promise<string> {
  const [{ web3FromAddress }, { blake2AsHex }, { stringToU8a, u8aToHex }] = await Promise.all([
    import('@polkadot/extension-dapp'),
    import('@polkadot/util-crypto'),
    import('@polkadot/util'),
  ]);
  const bytes = stringToU8a(JSON.stringify(bundle));
  const hash = blake2AsHex(bytes);
  onStatus?.('Connecting to Portaldot…');
  const a = await api(true);
  const injector = await web3FromAddress(address);
  onStatus?.('Confirm the upload in your wallet…');
  return new Promise((resolve, reject) => {
    a.tx.transactionStorage
      .store(u8aToHex(bytes))
      .signAndSend(address, { signer: injector.signer as never }, async ({ status, dispatchError, events }) => {
        if (dispatchError) return reject(new Error(dispatchError.toString()));
        if (status.isReady || status.isBroadcast) onStatus?.('Uploading to Portaldot…');
        if (!status.isInBlock) return;
        const stored = events.find(({ event }) => a.events.transactionStorage.Stored.is(event));
        if (!stored) return reject(new Error('Upload was included but not stored.'));
        const header = await a.rpc.chain.getHeader(status.asInBlock);
        resolve(`tstore:${header.number.toNumber()}:${stored.phase.asApplyExtrinsic.toNumber()}:${hash}`);
        a.disconnect();
      })
      .catch(reject);
  });
}
