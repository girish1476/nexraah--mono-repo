import type { Metadata } from 'next';
import { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexraah · Internal console',
  description: 'Nexraah internal console — vendors, indents, trips, proof of delivery, payments',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Falls back to system fonts offline — the console must still be usable. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Public+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
