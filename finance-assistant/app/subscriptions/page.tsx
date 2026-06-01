import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { formatCurrency } from "@/lib/utils";

export default async function SubscriptionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const subscriptions = await prisma.subscription.findMany({
    where: { userId: user.id, isCancelled: false },
    orderBy: { estimatedAmount: "desc" },
  });

  const monthly = subscriptions
    .filter((s) => s.frequency === "monthly")
    .reduce((sum, s) => sum + s.estimatedAmount, 0);

  const annual = subscriptions
    .filter((s) => s.frequency === "annual")
    .reduce((sum, s) => sum + s.estimatedAmount, 0);

  const FREQ_LABELS: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Biweekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
  };

  const CONFIDENCE_LABELS: Record<string, string> = {
    high: "bg-green-100 text-green-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-gray-100 text-gray-600",
  };

  function confidenceLabel(c: number) {
    if (c >= 0.75) return { label: "High", style: CONFIDENCE_LABELS.high };
    if (c >= 0.5) return { label: "Medium", style: CONFIDENCE_LABELS.medium };
    return { label: "Low", style: CONFIDENCE_LABELS.low };
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Subscriptions</h1>
        <p className="text-sm text-gray-500 mt-1">Recurring charges detected from your transaction history.</p>
      </div>

      {subscriptions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <p className="font-medium text-gray-700">No subscriptions detected yet</p>
          <p className="text-sm text-gray-500 mt-1">Upload at least 2 months of transaction history to detect recurring charges.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500">Monthly recurring</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(monthly)}</p>
              <p className="text-xs text-gray-400">{formatCurrency(monthly * 12)} / year</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500">Annual subscriptions</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(annual)}</p>
              <p className="text-xs text-gray-400">billed yearly</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Merchant</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Frequency</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Next expected</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {subscriptions.map((sub) => {
                  const conf = confidenceLabel(sub.confidence);
                  return (
                    <tr key={sub.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{sub.merchant}</td>
                      <td className="px-4 py-3 text-gray-500">{FREQ_LABELS[sub.frequency] ?? sub.frequency}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(sub.estimatedAmount)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {sub.nextExpected
                          ? new Date(sub.nextExpected).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${conf.style}`}>
                          {conf.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
