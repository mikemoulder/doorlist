import type { Metadata, Viewport } from 'next';
import { WalletProvider } from '@/lib/wallet';
import './globals.css';

export const metadata: Metadata = {
  title: 'Doorlist, tickets you can’t copy',
  description: 'Event tickets on Portaldot. The QR code re-signs every 10 seconds, money waits until the event, and refunds are automatic if it is cancelled.',
};

export const viewport: Viewport = { themeColor: '#eef0f3', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
