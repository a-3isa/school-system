'use client';
import { SessionProvider } from '@/lib/session';

/** Pages made for paper: signed in like the rest, but without the sidebar, so only the page itself prints. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
