import { Search } from "lucide-react";

// Shared top-navigation search bar — single source of truth for the search
// input's markup/styling used across the whole application (builder portal
// header and /newdashboard). Deep-links into the existing /products
// catalogue search (?q=) via a plain GET form; no separate search API.
//
// The dedicated Search button is a native `type="submit"` inside this same
// GET <form>, so it triggers the exact same navigation as pressing Enter in
// the input — no separate click handler/JS needed, no change to the search
// semantics/endpoint.
//
// Server component (no interactivity beyond native form submission), so it
// can be dropped into either a server or client header without adding to
// the client bundle.
export default function HeaderSearchForm({ className = "" }: { className?: string }) {
  return (
    <form action="/products" method="GET" role="search" className={`flex flex-1 items-center gap-2 ${className}`}>
      <input
        type="search"
        name="q"
        placeholder="Search TMT bars, cement, bricks..."
        aria-label="Search materials, suppliers or grades"
        className="posh-search-input"
      />
      <button type="submit" aria-label="Search" className="posh-search-btn flex items-center gap-1.5">
        <Search size={16} />
        <span className="hidden sm:inline">Search</span>
      </button>
    </form>
  );
}
