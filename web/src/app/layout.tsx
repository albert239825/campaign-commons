import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { routes } from "@/lib/format";
import { SearchBox } from "@/components/search/search-box";

export const metadata: Metadata = {
  title: "Campaign Commons",
  description: "Political money & policy provenance. Receipts, not conclusions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="site-header">
          <div className="site-header-inner">
            <Link href={routes.home()} className="site-brand">
              Campaign Commons
            </Link>
            <nav aria-label="Site">
              <Link href={routes.races()}>Races</Link>
              <Link href={routes.methodology()}>Methodology</Link>
              <SearchBox />
            </nav>
          </div>
        </header>
        <main id="main" className="site-main">{children}</main>
        <footer className="site-footer">
          Every figure links to its government record (FEC, congress.gov, platform ad libraries). We show adjacency, never
          causation. Same treatment for every candidate, party, and committee.
        </footer>
      </body>
    </html>
  );
}
