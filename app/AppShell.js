"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// adminOnly items are hidden from staff logins (the database also blocks them).
export const NAV_GROUPS = [
  {
    title: "",
    items: [{ href: "/", label: "Home", icon: "🏠" }],
  },
  {
    title: "Orders",
    items: [
      { href: "/jobs", label: "Jobs board", icon: "🧵" },
      { href: "/jobs/new", label: "New job", icon: "➕" },
      { href: "/jobs/stock-order", label: "Stock order for jobs", icon: "📦" },
    ],
  },
  {
    title: "Selling",
    items: [
      { href: "/event-pos", label: "Event till", icon: "🛍️" },
      { href: "/record-sale", label: "Record a sale", icon: "🧾" },
      { href: "/events", label: "Events", icon: "📅", adminOnly: true },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/products", label: "Products & stock", icon: "👕" },
      { href: "/stocktake", label: "Stocktake", icon: "📋" },
      { href: "/stock-purchases", label: "Stock purchases", icon: "🚚", adminOnly: true },
      { href: "/supplier-credits", label: "Supplier credits", icon: "↩️", adminOnly: true },
    ],
  },
  {
    title: "Money",
    adminOnly: true,
    items: [
      { href: "/expenses", label: "Expenses", icon: "💷" },
      { href: "/cash-flow", label: "Cash flow", icon: "🏦" },
      { href: "/transactions", label: "Transactions", icon: "🔁" },
      { href: "/reports", label: "Reports", icon: "📊" },
      { href: "/fresh-start", label: "Fresh start", icon: "🧹" },
    ],
  },
  {
    title: "Online",
    adminOnly: true,
    items: [
      { href: "/shopify", label: "Shopify", icon: "🛒" },
      { href: "/square", label: "Square payouts", icon: "💳" },
    ],
  },
];

const TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/jobs", label: "Jobs", icon: "🧵" },
  { href: "/jobs/new", label: "New job", icon: "➕" },
  { href: "/event-pos", label: "Till", icon: "🛍️" },
];

// Full-screen pages that get a slim bar instead of the menu.
const FULL_SCREEN = ["/event-pos"];

function isActive(pathname, href) {
  if (href === "/") return pathname === "/";
  if (href === "/jobs") return pathname === "/jobs" || pathname.startsWith("/jobs/edit");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ isAdmin, role, onSignOut, children }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  if (FULL_SCREEN.includes(pathname)) {
    return (
      <div className="shell">
        <div className="till-bar">
          <Link href="/">← Leave till</Link>
          <span style={{ fontWeight: 800 }}>Creations on the Coast · Event till</span>
        </div>
        {children}
      </div>
    );
  }

  const groups = NAV_GROUPS.filter((group) => isAdmin || !group.adminOnly).map((group) => ({
    ...group,
    items: group.items.filter((item) => isAdmin || !item.adminOnly),
  }));

  return (
    <div className="shell">
      <div className="mobile-bar">
        <Link href="/" className="brand">
          <span className="brand-mark">CC</span>
          <span className="brand-name">Creations on the Coast</span>
        </Link>
        <button type="button" onClick={() => setOpen(true)}>Menu</button>
      </div>

      <nav className={`sidebar${open ? " open" : ""}`} onClick={(event) => event.target === event.currentTarget && setOpen(false)}>
        <Link href="/" className="brand">
          <span className="brand-mark">CC</span>
          <span>
            <div className="brand-name">Creations on the Coast</div>
            <div className="brand-sub">Orders · Stock · Sales</div>
          </span>
        </Link>

        {groups.map((group) => (
          <div key={group.title || "top"} className="nav-group">
            {group.title && <div className="nav-group-title">{group.title}</div>}
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link${isActive(pathname, item.href) ? " active" : ""}`}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        <div className="sidebar-foot">
          <div style={{ opacity: 0.7 }}>Signed in as {isAdmin ? "admin" : role === "accountability" ? "team" : role}</div>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </nav>

      <div className="shell-main">{children}</div>

      <nav className="tabbar" aria-label="Quick links">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className={isActive(pathname, tab.href) ? "active" : ""}>
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
