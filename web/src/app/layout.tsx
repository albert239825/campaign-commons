import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { routes } from "@/lib/format";

export const metadata: Metadata = {
  title: "Citizen Gotham",
  description: "Political money & policy provenance. Receipts, not conclusions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="site-header border-b border-neutral-200 bg-white">
          <div className="site-header-inner mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href={routes.home()} className="site-brand font-semibold tracking-tight">
              Citizen Gotham
              <span className="site-tagline ml-2 text-xs font-normal text-neutral-500">receipts, not conclusions</span>
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-600">
              <Link href={`${routes.home()}#races`} className="hover:text-neutral-900">
                Races
              </Link>
              <Link href={routes.personalize()} className="hover:text-neutral-900">
                Personalize
              </Link>
              <Link href={routes.methodology()} className="hover:text-neutral-900">
                Methodology
              </Link>
            </nav>
          </div>
        </header>
        <main id="main" className="site-main mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="site-footer mx-auto max-w-6xl px-4 py-8 text-xs text-neutral-500">
          Every figure links to its government record (FEC, congress.gov, platform ad libraries). We show adjacency, never
          causation. Same treatment for every candidate, party, and committee.
        </footer>
      </body>
    </html>
  );
}
