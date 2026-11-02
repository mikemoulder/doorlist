import { formatUnits } from 'viem';
import type { Currency } from './doorlist';

/** "25.00 dUSD", "2.5 POT". Fixed decimals per currency: money 2 for dUSD, up to 4 for POT. */
export function money(amount: bigint, c: Currency) {
  const n = Number(formatUnits(amount, c.decimals));
  const digits = c.symbol === 'dUSD' ? 2 : n < 1 ? 4 : 2;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${c.symbol}`;
}

/** "$25.00" for dUSD (people think in dollars), otherwise money(). */
export function price(amount: bigint, c: Currency) {
  if (c.symbol === 'dUSD') {
    const n = Number(formatUnits(amount, c.decimals));
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return money(amount, c);
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function when(unix: number) {
  const d = new Date(unix * 1000);
  return {
    day: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    iso: d.toISOString(),
  };
}

/** "in 3 days", "in 5 h", "2 days ago" against now. */
export function relative(unix: number, now = Date.now() / 1000) {
  const s = unix - now;
  const a = Math.abs(s);
  const unit = a >= 86400 ? [Math.round(a / 86400), 'day'] : a >= 3600 ? [Math.round(a / 3600), 'h'] : [Math.max(1, Math.round(a / 60)), 'min'];
  const label = unit[1] === 'day' ? `${unit[0]} day${unit[0] === 1 ? '' : 's'}` : `${unit[0]} ${unit[1]}`;
  return s >= 0 ? `in ${label}` : `${label} ago`;
}
