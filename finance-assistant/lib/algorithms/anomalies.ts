import { prisma } from "@/lib/db/prisma";

export interface Anomaly {
  category: string;
  currentSpend: number;
  typicalSpend: number;
  multiplier: string;
  zScore: number;
  severity: "high" | "medium";
}

export async function detectAnomalies(userId: string): Promise<Anomaly[]> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Baseline: rolling 6-month history excluding current month
  const baselineAggs = await prisma.monthlyAggregate.findMany({
    where: {
      userId,
      NOT: { year: currentYear, month: currentMonth },
      OR: [
        { year: { gt: now.getFullYear() - 1 } },
        { year: now.getFullYear() - 1, month: { gt: currentMonth } },
      ],
    },
  });

  // Current month spend by category
  const currentAggs = await prisma.monthlyAggregate.findMany({
    where: { userId, year: currentYear, month: currentMonth },
  });

  // Compute baseline stats per category
  const baselineByCategory: Record<string, number[]> = {};
  for (const agg of baselineAggs) {
    if (!baselineByCategory[agg.category]) baselineByCategory[agg.category] = [];
    baselineByCategory[agg.category].push(agg.totalSpent);
  }

  const anomalies: Anomaly[] = [];

  for (const current of currentAggs) {
    const history = baselineByCategory[current.category];
    if (!history || history.length < 2) continue; // need history to compare

    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance =
      history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length;
    const stddev = Math.sqrt(variance);

    if (stddev === 0) continue;

    const zScore = (current.totalSpent - mean) / stddev;

    // Only alert on meaningful overspend above $20
    if (zScore > 2.0 && current.totalSpent > 20 && current.totalSpent > mean * 1.3) {
      anomalies.push({
        category: current.category,
        currentSpend: Number(current.totalSpent.toFixed(2)),
        typicalSpend: Number(mean.toFixed(2)),
        multiplier: (current.totalSpent / mean).toFixed(1),
        zScore: Number(zScore.toFixed(2)),
        severity: zScore > 3 ? "high" : "medium",
      });
    }
  }

  return anomalies.sort((a, b) => b.zScore - a.zScore);
}
