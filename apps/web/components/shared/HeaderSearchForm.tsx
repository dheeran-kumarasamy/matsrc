// Shared top-navigation search bar — single source of truth for the search
// input's markup/styling used across the whole application (builder portal
// header and /newdashboard). Deep-links into the existing /products
// catalogue search (?q=) via a plain GET form; no separate search API.
//
// Server component (no interactivity beyond native form submission), so it
// can be dropped into either a server or client header without adding to
// the client bundle.
export default function HeaderSearchForm({ className = "" }: { className?: string }) {
  return (
    <form action="/products" method="GET" className={`flex-1 ${className}`}>
      <input
        type="search"
        name="q"
        placeholder="Search TMT bars, cement, bricks..."
        aria-label="Search materials, suppliers or grades"
        className="posh-input"
      />
    </form>
  );
}
