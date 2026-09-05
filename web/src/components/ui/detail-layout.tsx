import type { ReactNode } from "react";

/** Shared by the record pages, using the race dashboard's banner and spacing. */
export function DetailHeader({ label, title, children, actions }: { label: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="detail-banner">
      <div className="detail-banner-copy">
        <p className="detail-eyebrow">{label}</p>
        <h1>{title}</h1>
        {children && <div className="detail-introduction">{children}</div>}
      </div>
      {actions && <div className="detail-banner-actions">{actions}</div>}
    </header>
  );
}

export function SectionNav({ items, label = "On this page" }: { items: { id: string; label: string; note?: string }[]; label?: string }) {
  return (
    <nav className="detail-section-nav" aria-label={label}>
      <p>{label}</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}><a href={`#${item.id}`}>{item.label}{item.note && <small>{item.note}</small>}</a></li>
        ))}
      </ul>
    </nav>
  );
}
