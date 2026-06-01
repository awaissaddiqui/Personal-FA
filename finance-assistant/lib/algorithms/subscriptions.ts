import { prisma } from "@/lib/db/prisma";

function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(#\d+|store\s*\d+|loc\s*\d+|\d{4,})/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function computeIntervals(dates: Date[]): number[] {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const days =
      (sorted[i].getTime() - sorted[i - 1].getTime()) / (1000 * 60 * 60 * 24);
    intervals.push(Math.round(days));
  }
  return intervals;
}

function findDominantInterval(intervals: number[]): number | null {
  if (!intervals.length) return null;

  const buckets: Record<string, { count: number; sum: number }> = {};

  for (const d of intervals) {
    let bucket: string;
    if (d >= 6 && d <= 8) bucket = "weekly";
    else if (d >= 13 && d <= 16) bucket = "biweekly";
    else if (d >= 28 && d <= 32) bucket = "monthly";
    else if (d >= 85 && d <= 95) bucket = "quarterly";
    else if (d >= 355 && d <= 375) bucket = "annual";
    else continue;

    if (!buckets[bucket]) buckets[bucket] = { count: 0, sum: 0 };
    buckets[bucket].count++;
    buckets[bucket].sum += d;
  }

  if (!Object.keys(buckets).length) return null;

  const dominant = Object.entries(buckets).sort(
    (a, b) => b[1].count - a[1].count
  )[0];

  return Math.round(dominant[1].sum / dominant[1].count);
}

function intervalToFrequency(days: number): string {
  if (days >= 6 && days <= 8) return "weekly";
  if (days >= 13 && days <= 16) return "biweekly";
  if (days >= 28 && days <= 32) return "monthly";
  if (days >= 85 && days <= 95) return "quarterly";
  if (days >= 355 && days <= 375) return "annual";
  return "irregular";
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(
    values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
  );
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function detectSubscriptions(userId: string): Promise<void> {
  const rawTransactions = await prisma.transaction.findMany({
    where: { userId, type: "debit" },
    select: { merchant: true, date: true, amount: true },
    orderBy: { date: "asc" },
  });

  // Group by normalized merchant
  const grouped: Record<
    string,
    { dates: Date[]; amounts: number[]; rawMerchant: string }
  > = {};

  for (const tx of rawTransactions) {
    const key = normalizeMerchant(tx.merchant);
    if (!grouped[key]) {
      grouped[key] = { dates: [], amounts: [], rawMerchant: tx.merchant };
    }
    grouped[key].dates.push(tx.date);
    grouped[key].amounts.push(tx.amount);
  }

  const subscriptions = [];

  for (const [normalizedName, { dates, amounts, rawMerchant }] of Object.entries(grouped)) {
    if (dates.length < 2) continue;

    const intervals = computeIntervals(dates);
    const dominantInterval = findDominantInterval(intervals);
    if (!dominantInterval) continue;

    const tolerance = dominantInterval * 0.25;
    const regularIntervals = intervals.filter(
      (d) => Math.abs(d - dominantInterval) <= tolerance
    );
    const regularityRatio = regularIntervals.length / intervals.length;

    const amountVariance =
      amounts.length >= 2 ? stddev(amounts) / (mean(amounts) || 1) : 1;

    // Confidence: regularity + low variance + frequency of charges
    const frequencyBonus = Math.min(dates.length / 6, 1) * 0.2;
    const confidence =
      regularityRatio * 0.5 +
      (1 - Math.min(amountVariance, 1)) * 0.3 +
      frequencyBonus;

    if (confidence < 0.45) continue;

    const lastCharged = dates[dates.length - 1];
    const nextExpected = new Date(lastCharged);
    nextExpected.setDate(nextExpected.getDate() + dominantInterval);

    subscriptions.push({
      userId,
      merchant: rawMerchant,
      normalizedName,
      estimatedAmount: Number(mean(amounts).toFixed(2)),
      frequency: intervalToFrequency(dominantInterval),
      lastCharged,
      nextExpected,
      confidence: Number(confidence.toFixed(2)),
    });
  }

  // Upsert all detected subscriptions
  for (const sub of subscriptions) {
    await prisma.subscription.upsert({
      where: { userId_normalizedName: { userId, normalizedName: sub.normalizedName } },
      update: {
        estimatedAmount: sub.estimatedAmount,
        frequency: sub.frequency,
        lastCharged: sub.lastCharged,
        nextExpected: sub.nextExpected,
        confidence: sub.confidence,
      },
      create: sub,
    });
  }
}
