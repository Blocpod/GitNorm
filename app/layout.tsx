import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'https://gitnorm.openai.site'),
  title: 'GitNorm — Your software, saved simply',
  description: 'Save, update, and share the apps you make without learning Git.',
  openGraph: { title: 'GitNorm — Your software, saved simply', description: 'No commands. No jargon. No worries.', images: ['/og.png'], type: 'website' },
  twitter: { card: 'summary_large_image', title: 'GitNorm — Your software, saved simply', description: 'No commands. No jargon. No worries.', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
