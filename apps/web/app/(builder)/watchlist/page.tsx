import Link from "next/link";
import { Bell, TrendingDown } from "lucide-react";

// UF-09: Watchlist & Price Alerts — FR-07, FR-31
export default async function WatchlistPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Watchlist</h1>
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <Bell size={12} /> WhatsApp alerts enabled
        </span>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
        <TrendingDown className="text-blue-500 shrink-0 mt-0.5" size={18} />
        <div>
          <p className="text-sm font-medium text-blue-800">How price alerts work</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Set a target price on any material. When the price drops below it, we send a WhatsApp alert instantly. Reply to the message to reorder in one step. (FR-07, FR-31)
          </p>
        </div>
      </div>

      {/* Watchlist items */}
      <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
        <p className="text-gray-400 text-sm">No items in watchlist.</p>
        <Link href="/products" className="mt-3 inline-block text-sm text-brand-500 hover:underline">
          Browse and watchlist materials →
        </Link>
      </div>
    </div>
  );
}
