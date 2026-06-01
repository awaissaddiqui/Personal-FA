"use client";

import { useState, useEffect } from "react";
import { formatCurrency, cn } from "@/lib/utils";

interface BudgetStatus {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: "ok" | "warning" | "over";
}

const CATEGORIES = [
  "groceries", "dining", "transport", "entertainment",
  "utilities", "health", "shopping", "other",
];

export default function BudgetsClient() {
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);
  const [newLimit, setNewLimit] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchBudgets() {
    const res = await fetch("/api/budgets");
    const data = await res.json();
    setBudgets(data);
    setLoading(false);
  }

  useEffect(() => { fetchBudgets(); }, []);

  async function addBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!newLimit || isNaN(Number(newLimit))) return;
    setSaving(true);
    await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: newCategory, limitAmt: Number(newLimit) }),
    });
    setNewLimit("");
    await fetchBudgets();
    setSaving(false);
  }

  const STATUS_STYLES = {
    ok: "bg-green-500",
    warning: "bg-yellow-400",
    over: "bg-red-500",
  };

  if (loading) {
    return <div className="text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Add budget form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Add budget</h2>
        <form onSubmit={addBudget} className="flex gap-3">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
              placeholder="500"
              min="1"
              className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Set"}
          </button>
        </form>
      </div>

      {/* Budget list */}
      {budgets.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-3xl mb-2">🎯</div>
          <p className="text-sm text-gray-500">No budgets set yet. Add one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => (
            <div key={b.category} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-900 capitalize">{b.category}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">
                    {formatCurrency(b.spent)} / {formatCurrency(b.limit)}
                  </span>
                  {b.status === "over" && (
                    <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-medium">Over</span>
                  )}
                  {b.status === "warning" && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5 font-medium">Near limit</span>
                  )}
                </div>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", STATUS_STYLES[b.status])}
                  style={{ width: `${Math.min(b.percentUsed, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {b.remaining >= 0
                  ? `${formatCurrency(b.remaining)} remaining`
                  : `${formatCurrency(Math.abs(b.remaining))} over budget`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
