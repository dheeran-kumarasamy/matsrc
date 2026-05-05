import Link from "next/link";
import { BuilderKpiCard } from "@/components/builder/BuilderKpiCard";
import { builderApiGet } from "@/lib/api";

// UF-02 entry: builder dashboard summary
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
    // show zeros on error
  }

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <BuilderKpiCard label="Active Orders" value={String(orderCount)} hint="Orders in progress" href="/orders" />
        <BuilderKpiCard label="Cart Items" value={String(cartCount)} hint="Items ready to checkout" href="/cart" />
        <BuilderKpiCard label="Price Alerts" value={String(watchlistCount)} hint="Watchlist materials" href="/watchlist" />
        <BuilderKpiCard
          label="Credit Available"
          value={`₹${availableCredit.toLocaleString("en-IN")}`}
          hint="BNPL / credit line"
          href="/credit"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Recent orders panel */}
        <div className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Recent Orders</h3>
            <Link href="/orders" className="text-xs text-blue-700 hover:underline">View all →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Material</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-sm">
                    No orders yet.{" "}
                    <Link href="/products" className="text-blue-700 hover:underline">
                      Browse materials →
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick actions panel */}
        <div className="panel p-4">
          <h3 className="text-lg font-bold text-slate-900">Quick Actions</h3>
          <div className="mt-3 space-y-2">
            <Link
              href="/products"
              className="block rounded-lg bg-blue-700 px-3 py-2 text-center text-sm font-bold text-white hover:bg-blue-800 transition-colors"
            >
              Browse Materials
            </Link>
            <Link
              href="/cart"
              className="block rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              View Cart
            </Link>
            <Link
              href="/credit"
              className="block rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Apply for Credit
            </Link>
            <Link
              href="/disputes"
              className="block rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Raise Dispute
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
