// Live check of the Pinata fallback for event media, without printing the key:
// 1. the JWT is accepted  2. a signed one-time upload URL works with no key (as the browser will use it)
// 3. the file reads back byte-identical through the dedicated gateway.
import 'dotenv/config';

const { PINATA_JWT, PINATA_GATEWAY } = process.env;
if (!PINATA_JWT || !PINATA_GATEWAY) throw new Error('Set PINATA_JWT and PINATA_GATEWAY in .env');
const auth = { Authorization: `Bearer ${PINATA_JWT}` };

const t = await fetch('https://api.pinata.cloud/data/testAuthentication', { headers: auth });
console.log(`1. key accepted: ${t.ok} (HTTP ${t.status})`);
if (!t.ok) throw new Error(await t.text());

const s = await fetch('https://uploads.pinata.cloud/v3/files/sign', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ date: Math.floor(Date.now() / 1000), expires: 120, max_file_size: 2_000_000 }),
});
const signed = await s.json();
console.log(`2. signed upload URL: HTTP ${s.status}${s.ok ? '' : ` ${JSON.stringify(signed)}`}`);
if (!s.ok) process.exit(1);

const body = JSON.stringify({ v: 1, description: 'Doorlist storage check', venue: 'Pinata fallback', at: new Date().toISOString() });
const form = new FormData();
form.append('network', 'public');
form.append('file', new Blob([body], { type: 'application/json' }), 'doorlist-check.json');
const u = await fetch(signed.data, { method: 'POST', body: form }); // no Authorization header: the URL is the permission
const up = await u.json();
if (!u.ok) throw new Error(`upload failed: HTTP ${u.status} ${JSON.stringify(up)}`);
const cid = up.data.cid;
console.log(`   uploaded ${body.length} bytes without the key -> CID ${cid}`);

const url = `https://${PINATA_GATEWAY}/ipfs/${cid}`;
let back, status;
for (let i = 0; i < 5; i++) {
  const r = await fetch(url);
  status = r.status;
  if (r.ok) { back = await r.text(); break; }
  await new Promise((res) => setTimeout(res, 2000));
}
console.log(`3. gateway read: HTTP ${status}, byte-identical: ${back === body}`);
console.log(`   ${url}`);
