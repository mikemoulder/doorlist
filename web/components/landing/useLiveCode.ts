'use client';
// The landing page's live thing: a real code, signed every 10 seconds by a key made in this browser just now.
// It demonstrates how a ticket refreshes; it is not a ticket and opens no door.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { MAX_AGE_SECONDS, REFRESH_SECONDS } from '@/lib/pass';

export type Snapshot = { ts: number; sig: string; qr: string };

export function useLiveCode() {
  const account = useRef(privateKeyToAccount(generatePrivateKey()));
  const [code, setCode] = useState<Snapshot>();
  const [shot, setShot] = useState<Snapshot>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let live = true;
    async function sign() {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await account.current.signMessage({ message: `doorlist:demo:${ts}` });
      const qr = await QRCode.toDataURL(`DL1.demo.${ts}.${account.current.address}.${sig}`, { margin: 1, width: 360, color: { dark: '#0f0f0f', light: '#ffffff' } });
      if (live) setCode({ ts, sig, qr });
    }
    sign();
    const s = setInterval(sign, REFRESH_SECONDS * 1000);
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      live = false;
      clearInterval(s);
      clearInterval(t);
    };
  }, []);

  const age = code ? now - code.ts : 0;
  const shotAge = shot ? now - shot.ts : undefined;
  return {
    device: account.current.address,
    code,
    nextIn: Math.max(0, REFRESH_SECONDS - age),
    shot,
    shotAge,
    shotRefused: shotAge !== undefined && shotAge > MAX_AGE_SECONDS,
    takeShot: () => setShot(code),
    clearShot: () => setShot(undefined),
  };
}
