"use client";

import { useState } from "react";
import { menuLabel, type AdminMenu } from "@/lib/rbac";

type AdminUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: "ADMIN" | "SUPER_ADMIN";
  menus: AdminMenu[];
};

export function AdminAccessManager({ users, allMenus }: { users: AdminUser[]; allMenus: AdminMenu[] }) {
  const [local, setLocal] = useState<AdminUser[]>(users);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");

  function toggle(userId: string, menu: AdminMenu) {
    setLocal((prev) =>
      prev.map((user) => {
        if (user.id !== userId || user.role === "SUPER_ADMIN") return user;

        const has = user.menus.includes(menu);
        const nextMenus = has ? user.menus.filter((m) => m !== menu) : [...user.menus, menu];

        return {
          ...user,
          menus: nextMenus,
        };
      })
    );
  }

  async function save(userId: string) {
    const user = local.find((u) => u.id === userId);
    if (!user || user.role === "SUPER_ADMIN") return;

    setSavingId(userId);
    setFeedback("");

    const response = await fetch(`/api/admin/access/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menus: user.menus }),
    });

    setSavingId(null);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      setFeedback(data?.message || "Failed to save access changes");
      return;
    }

    setFeedback("Access updated successfully");
  }

  return (
    <section className="panel p-5">
      <h3 className="text-xl font-extrabold text-slate-950">Admin Access Control</h3>
      <p className="mt-1 text-sm text-slate-600">
        Super Admin can assign menu-level permissions to Admin users.
      </p>

      {feedback && <p className="mt-3 text-sm font-semibold text-blue-700">{feedback}</p>}

      <div className="mt-4 space-y-4">
        {local.map((user) => (
          <article key={user.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-slate-900">{user.name || user.email || "Unnamed"}</p>
                <p className="text-xs text-slate-500">{user.email || "No email"}</p>
              </div>
              <span className="rounded-full bg-slate-900 px-2 py-1 text-xs font-bold text-white">
                {user.role === "SUPER_ADMIN" ? "SUPER ADMIN" : "ADMIN"}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allMenus.map((menu) => {
                const checked = user.role === "SUPER_ADMIN" || user.menus.includes(menu);
                return (
                  <label key={`${user.id}:${menu}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={user.role === "SUPER_ADMIN"}
                      onChange={() => toggle(user.id, menu)}
                    />
                    <span>{menuLabel(menu)}</span>
                  </label>
                );
              })}
            </div>

            {user.role === "ADMIN" && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void save(user.id)}
                  disabled={savingId === user.id}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {savingId === user.id ? "Saving..." : "Save Permissions"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
