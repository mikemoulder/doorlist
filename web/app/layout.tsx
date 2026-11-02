import type { Metadata, Viewport } from 'next';
import { WalletProvider } from '@/lib/wallet';
import './globals.css';

export const metadata: Metadata = {
  title: 'Doorlist: tickets that can’t be copied',
  description: 'Event tickets on Portaldot. The QR code re-signs every 10 seconds, money waits until the event, and refunds are automatic if it is cancelled.',
};

export const viewport: Viewport = { themeColor: '#0f0f0f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
