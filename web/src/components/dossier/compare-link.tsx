"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const getHash = () => window.location.hash;
const getServerHash = () => "";

/** Cross-dossier link that carries the selected issue (`#healthcare`) so both candidates open on the same issue. */
export function CompareLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  return (
    <Link href={`${href}${hash}`} className={className}>
      {children}
    </Link>
  );
}
