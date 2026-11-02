'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import { Wordmark } from './Logo';
import { useWallet } from '@/lib/wallet';
import { shortAddress } from '@/lib/format';

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
      <MobileNav path={path ?? ''} />
    </div>
  );
}

export function Account() {
  const { address, wallets, connect, disconnect, connecting } = useWallet();
  if (address)
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <span className="pill pill-ghost num" title={address}>
          <Wallet size={15} strokeWidth={1.5} aria-hidden="true" /> {shortAddress(address)}
        </span>
        <button className="pill pill-ghost" onClick={disconnect} aria-label="Sign out">
          <LogOut size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </span>
    );
  return (
    <button className="pill pill-primary" onClick={() => connect()} disabled={connecting || wallets.length === 0} title={wallets.length ? undefined : 'Install a wallet such as SubWallet or MetaMask'}>
      <Wallet size={15} strokeWidth={1.5} aria-hidden="true" /> {connecting ? 'Opening wallet…' : wallets.length ? 'Sign in' : 'No wallet found'}
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
