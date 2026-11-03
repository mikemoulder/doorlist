'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import { Wordmark } from './Logo';
import { useWallet } from '@/lib/wallet';
import { shortAddress } from '@/lib/format';
import { client, DOORLIST, EXPLORER } from '@/lib/chain';

const NAV = [
  { href: '/events/', label: 'Events' },
  { href: '/tickets/', label: 'My tickets' },
  { href: '/organize/', label: 'Organize' },
  { href: '/door/', label: 'Door' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <div className="app">
      <header className={`a-bar${scrolled ? ' scrolled' : ''}`}>
        <div className="a-col">
          <Link href="/" className="wordmark">
            <Wordmark />
          </Link>
          <nav aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path?.startsWith(n.href.slice(0, -1)) ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <span className="spacer" />
          <Account />
        </div>
      </header>
      <main className="a-main">
        <div className="a-col">{children}</div>
      </main>
      <NetworkLine />
      <MobileNav path={path ?? ''} />
    </div>
  );
}

export function Account() {
  const { address, ss58, connect, disconnect, connecting } = useWallet();
  if (address)
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        {/* A Portaldot (5...) account is shown as itself; the 0x address is only how contracts see it. */}
        <span className="pill pill-ghost num" title={ss58 ? `${ss58}\nIn contracts: ${address}` : address}>
          <Wallet size={15} strokeWidth={1.5} aria-hidden="true" /> {shortAddress(ss58 ?? address)}
        </span>
        <button className="pill pill-ghost" onClick={disconnect} aria-label="Sign out">
          <LogOut size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </span>
    );
  return (
    <button className="pill pill-primary" onClick={() => connect()} disabled={connecting}>
      <Wallet size={15} strokeWidth={1.5} aria-hidden="true" /> {connecting ? 'Opening wallet…' : 'Sign in'}
    </button>
  );
}

function MobileNav({ path }: { path: string }) {
  return (
    <nav className="m-nav" aria-label="Main">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href.slice(0, -1)) ? 'page' : undefined}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

/** The chain this screen reads from, with its live block height (Portaldot makes a block every 6 s). */
function NetworkLine() {
  const [block, setBlock] = useState<bigint>();
  const [down, setDown] = useState(false);
  useEffect(() => {
    let live = true;
    const tick = () =>
      client
        .getBlockNumber()
        .then((b) => live && (setBlock(b), setDown(false)))
        .catch(() => live && setDown(true));
    tick();
    const t = setInterval(tick, 6000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return (
    <footer className="a-foot">
      <div className="a-col">
        <span className={`a-live${down ? ' is-down' : ''}`} aria-hidden="true" />
        <span>
          {down ? 'Can’t reach Portaldot right now. Retrying every 6 seconds.' : block === undefined ? 'Connecting to Portaldot V3 testnet…' : <>Live from Portaldot V3 testnet at block <span className="num">{Number(block).toLocaleString('en-US')}</span>.</>}
        </span>
        <a className="link" href={EXPLORER} title={DOORLIST}>
          Contract {shortAddress(DOORLIST)}
        </a>
      </div>
    </footer>
  );
}
