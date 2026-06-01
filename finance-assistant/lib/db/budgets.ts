import { prisma } from "@/lib/db/prisma";

export async function getBudgetStatus(userId: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [budgets, currentSpend] = await Promise.all([
    prisma.budget.findMany({ where: { userId } }),
    prisma.monthlyAggregate.findMany({
      where: { userId, year, month },
    }),
  ]);

  const spendByCategory: Record<string, number> = {};
  for (const agg of currentSpend) {
    spendByCategory[agg.category] = agg.totalSpent;
  }

  return budgets.map((budget) => {
    const spent = spendByCategory[budget.category] ?? 0;
    const pct = budget.limitAmt > 0 ? (spent / budget.limitAmt) * 100 : 0;
    return {
      category: budget.category,
      limit: Number(budget.limitAmt.toFixed(2)),
      spent: Number(spent.toFixed(2)),
      remaining: Number((budget.limitAmt - spent).toFixed(2)),
      percentUsed: Number(pct.toFixed(1)),
      status:
        pct >= 100 ? "over" : pct >= 80 ? "warning" : "ok",
    };
  });
}
