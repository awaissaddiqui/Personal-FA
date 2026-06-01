import { prisma } from "@/lib/db/prisma";

export async function queryTransactions(
  userId: string,
  filters: {
    startDate?: string;
    endDate?: string;
    category?: string;
    merchant?: string;
    type?: string;
    limit?: number;
  }
) {
  const limit = Math.min(filters.limit ?? 20, 50);

  const where: Record<string, unknown> = { userId };

  if (filters.startDate || filters.endDate) {
    where.date = {
      ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
      ...(filters.endDate ? { lte: new Date(filters.endDate + "T23:59:59") } : {}),
    };
  }

  if (filters.category) {
    where.category = { contains: filters.category, mode: "insensitive" };
  }

  if (filters.merchant) {
    where.merchant = { contains: filters.merchant, mode: "insensitive" };
  }

  if (filters.type) {
    where.type = filters.type;
  }

  const [transactions, aggregate] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      take: limit,
      select: {
        id: true,
        date: true,
        amount: true,
        type: true,
        merchant: true,
        category: true,
        description: true,
      },
    }),
    prisma.transaction.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
      _avg: { amount: true },
      _max: { amount: true },
    }),
  ]);

  return {
    transactions: transactions.map((t) => ({
      ...t,
      date: t.date.toISOString().split("T")[0],
      amount: Number(t.amount.toFixed(2)),
    })),
    summary: {
      total: Number((aggregate._sum.amount ?? 0).toFixed(2)),
      count: aggregate._count,
      average: Number((aggregate._avg.amount ?? 0).toFixed(2)),
      largest: Number((aggregate._max.amount ?? 0).toFixed(2)),
    },
  };
}

export async function getMonthlyAggregates(
  userId: string,
  monthsBack: number,
  category?: string
) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);

  const aggregates = await prisma.monthlyAggregate.findMany({
    where: {
      userId,
      ...(category ? { category: { contains: category, mode: "insensitive" } } : {}),
      OR: [
        { year: { gt: cutoff.getFullYear() } },
        {
          year: cutoff.getFullYear(),
          month: { gte: cutoff.getMonth() + 1 },
        },
      ],
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  // Also compute a baseline (mean ± stddev per category) for comparison
  const byCategory: Record<string, number[]> = {};
  for (const agg of aggregates) {
    if (!byCategory[agg.category]) byCategory[agg.category] = [];
    byCategory[agg.category].push(agg.totalSpent);
  }

  const baseline: Record<string, { mean: number; stddev: number }> = {};
  for (const [cat, values] of Object.entries(byCategory)) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stddev = Math.sqrt(
      values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
    );
    baseline[cat] = {
      mean: Number(mean.toFixed(2)),
      stddev: Number(stddev.toFixed(2)),
    };
  }

  return {
    aggregates: aggregates.map((a) => ({
      year: a.year,
      month: a.month,
      category: a.category,
      totalSpent: Number(a.totalSpent.toFixed(2)),
      txCount: a.txCount,
      avgTx: Number(a.avgTx.toFixed(2)),
    })),
    baseline,
  };
}

export async function recomputeAggregates(userId: string) {
  const grouped = await prisma.$queryRaw<
    Array<{
      year: number;
      month: number;
      category: string;
      total_spent: number;
      tx_count: number;
      avg_tx: number;
    }>
  >`
    SELECT
      EXTRACT(YEAR FROM date)::int  AS year,
      EXTRACT(MONTH FROM date)::int AS month,
      category,
      SUM(amount)::float            AS total_spent,
      COUNT(*)::int                 AS tx_count,
      AVG(amount)::float            AS avg_tx
    FROM transactions
    WHERE user_id = ${userId} AND type = 'debit'
    GROUP BY year, month, category
  `;

  for (const row of grouped) {
    await prisma.monthlyAggregate.upsert({
      where: {
        userId_year_month_category: {
          userId,
          year: row.year,
          month: row.month,
          category: row.category,
        },
      },
      update: {
        totalSpent: row.total_spent,
        txCount: row.tx_count,
        avgTx: row.avg_tx,
      },
      create: {
        userId,
        year: row.year,
        month: row.month,
        category: row.category,
        totalSpent: row.total_spent,
        txCount: row.tx_count,
        avgTx: row.avg_tx,
      },
    });
  }
}
