import Link from "next/link";
import { Package, ShoppingCart, TrendingDown, FileText, CreditCard } from "lucide-react";
import { builderApiGet } from "@/lib/api";

// UF-02 entry, summary of key builder actions
export default async function DashboardPage() {
  let cartCount = 0;
  let orderCount = 0;
  let watchlistCount = 0;
  let availableCredit = 0;

  try {
    const [cart, orders, watchlist, credit] = await Promise.all([
      builderApiGet<{ items: Array<{ id: string }> }>("/builder/cart"),
      builderApiGet<Array<{ id: string }>>("/builder/orders"),
      builderApiGet<Array<{ id: string }>>("/builder/watchlist"),
      builderApiGet<{ availableLimit: number }>("/builder/credit"),
    ]);

    cartCount = cart.items.length;
    orderCount = orders.length;
    watchlistCount = watchlist.length;
    availableCredit = credit.availableLimit;
  } catch {
    cartCount = 0;
    orderCount = 0;
    watchlistCount = 0;
    availableCredit = 0;
  }

  const stats = [
    { label: "Active Orders", value: String(orderCount), icon: FileText, href: "/orders", color: "blue" },
    { label: "Cart Items", value: String(cartCount), icon: ShoppingCart, href: "/cart", color: "orange" },
    { label: "Price Alerts", value: String(watchlistCount), icon: TrendingDown, href: "/watchlist", color: "green" },
    { label: "Credit Available", value: `INR ${availableCredit.toLocaleString("en-IN")}`, icon: CreditCard, href: "/credit", color: "purple" },
  ];

  return (
    <div className="space-y-4">
      {/* Quick stats */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, href, color }) => (
          <Link
            key={label}
            href={href}
            className="panel p-4 hover:shadow-md transition-shadow"
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-${color}-50`}>
              <Icon size={18} className={`text-${color}-600`} />
            </div>
            <div className="text-2xl font-bold text-slate-800">{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </Link>
        ))}
      </section>

      {/* Recent orders */}
      <div className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-800">Recent Orders</h2>
          <Link href="/orders" className="text-xs text-blue-700 hover:underline">View all</Link>
        </div>
        <div className="text-center py-8 text-slate-400 text-sm">No orders yet. <Link href="/products" className="text-blue-700 hover:underline">Browse materials →</Link></div>
      </div>

      {/* Watchlist price alerts */}
      <div className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-800">Watchlist Alerts</h2>
          <Link href="/watchlist" className="text-xs text-blue-700 hover:underline">Manage</Link>
        </div>
        <div className="text-center py-8 text-slate-400 text-sm">No alerts. <Link href="/products" className="text-blue-700 hover:underline">Watchlist a material →</Link></div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/products" className="rounded-2xl bg-[linear-gradient(120deg,#1a4f8a,#2778cc)] text-white p-5 hover:opacity-90 transition-opacity flex items-center gap-4">
          <Package size={28} />
          <div>
            <div className="font-semibold">Browse Materials</div>
            <div className="text-xs text-blue-200 mt-0.5">Compare prices across suppliers</div>
          </div>
        </Link>
        <Link href="/credit" className="panel p-5 hover:shadow-md transition-shadow flex items-center gap-4">
          <CreditCard size={28} className="text-blue-700" />
          <div>
            <div className="font-semibold text-slate-800">Apply for Credit</div>
            <div className="text-xs text-slate-400 mt-0.5">EMI, BNPL, working capital</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
