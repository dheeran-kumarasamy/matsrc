import Link from "next/link";
import { Package, ShoppingCart, TrendingDown, FileText, CreditCard } from "lucide-react";

// UF-02 entry, summary of key builder actions
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Good morning 👋</h1>
        <p className="text-gray-500 text-sm mt-1">Here's what's happening with your procurement today.</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Orders", value: "—", icon: FileText, href: "/orders", color: "blue" },
          { label: "Cart Items", value: "—", icon: ShoppingCart, href: "/cart", color: "orange" },
          { label: "Price Alerts", value: "—", icon: TrendingDown, href: "/watchlist", color: "green" },
          { label: "Credit Available", value: "—", icon: CreditCard, href: "/credit", color: "purple" },
        ].map(({ label, value, icon: Icon, href, color }) => (
          <Link
            key={label}
            href={href}
            className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow"
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-${color}-50`}>
              <Icon size={18} className={`text-${color}-600`} />
            </div>
            <div className="text-2xl font-bold text-gray-800">{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </Link>
        ))}
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Recent Orders</h2>
          <Link href="/orders" className="text-xs text-brand-500 hover:underline">View all</Link>
        </div>
        <div className="text-center py-8 text-gray-400 text-sm">No orders yet. <Link href="/products" className="text-brand-500 hover:underline">Browse materials →</Link></div>
      </div>

      {/* Watchlist price alerts */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Watchlist Alerts</h2>
          <Link href="/watchlist" className="text-xs text-brand-500 hover:underline">Manage</Link>
        </div>
        <div className="text-center py-8 text-gray-400 text-sm">No alerts. <Link href="/products" className="text-brand-500 hover:underline">Watchlist a material →</Link></div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/products" className="bg-brand-500 text-white rounded-xl p-5 hover:bg-brand-600 transition-colors flex items-center gap-4">
          <Package size={28} />
          <div>
            <div className="font-semibold">Browse Materials</div>
            <div className="text-xs text-blue-200 mt-0.5">Compare prices across suppliers</div>
          </div>
        </Link>
        <Link href="/credit" className="bg-white border border-gray-100 rounded-xl p-5 hover:shadow-md transition-shadow flex items-center gap-4">
          <CreditCard size={28} className="text-brand-500" />
          <div>
            <div className="font-semibold text-gray-800">Apply for Credit</div>
            <div className="text-xs text-gray-400 mt-0.5">EMI, BNPL, working capital</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
