import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

async function getDashboardData(userId: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [monthlyAggs, subscriptions, budgets, recentTxCount] = await Promise.all([
    prisma.monthlyAggregate.findMany({ where: { userId, year, month } }),
    prisma.subscription.findMany({
      where: { userId, isCancelled: false, confidence: { gte: 0.6 } },
      orderBy: { estimatedAmount: "desc" },
      take: 5,
    }),
    prisma.budget.findMany({ where: { userId } }),
    prisma.transaction.count({ where: { userId } }),
  ]);

  const totalSpentThisMonth = monthlyAggs.reduce((sum: number, a) => sum + a.totalSpent, 0);
  const totalSubscriptions = subscriptions.reduce((sum: number, s) => sum + s.estimatedAmount, 0);

  const topCategories = [...monthlyAggs]
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 5);

  return { totalSpentThisMonth, totalSubscriptions, topCategories, subscriptions, budgets, recentTxCount };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const data = await getDashboardData(user.id);
  const hasData = data.recentTxCount > 0;

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="text-6xl mb-4">📂</div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No transactions yet</h2>
        <p className="text-gray-500 text-sm mb-6 max-w-sm">
          Upload your bank statement CSV to get started. The assistant will analyze your spending and surface insights.
        </p>
        <Link
          href="/upload"
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Upload transactions
        </Link>
      </div>
    );
  }

  const now = new Date();
  const monthName = now.toLocaleString("default", { month: "long" });

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">{monthName} {now.getFullYear()}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Spent this month</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.totalSpentThisMonth)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Monthly subscriptions</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.totalSubscriptions)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{data.subscriptions.length} detected</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total transactions</p>
          <p className="text-2xl font-bold text-gray-900">{data.recentTxCount.toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Top categories */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top categories this month</h3>
          {data.topCategories.length === 0 ? (
            <p className="text-sm text-gray-400">No data yet</p>
          ) : (
            <div className="space-y-2">
              {data.topCategories.map((cat) => (
                <div key={cat.category} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 capitalize">{cat.category}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(cat.totalSpent)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Subscriptions */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recurring subscriptions</h3>
          {data.subscriptions.length === 0 ? (
            <p className="text-sm text-gray-400">None detected yet</p>
          ) : (
            <div className="space-y-2">
              {data.subscriptions.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-700">{sub.merchant}</p>
                    <p className="text-xs text-gray-400 capitalize">{sub.frequency}</p>
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(sub.estimatedAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <Link href="/chat" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          Chat with assistant →
        </Link>
        <Link href="/upload" className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
          Upload more data
        </Link>
      </div>
    </div>
  );
}
