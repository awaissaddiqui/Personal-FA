import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { parseCSV } from "@/lib/ingestion/csv-parser";
import { recomputeAggregates } from "@/lib/db/transactions";
import { detectSubscriptions } from "@/lib/algorithms/subscriptions";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) return Response.json({ error: "No file provided" }, { status: 400 });

  // Validate file type
  const isCSV =
    file.name.endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel";

  if (!isCSV) {
    return Response.json(
      { error: "Please upload a CSV file. Other formats are not supported." },
      { status: 400 }
    );
  }

  // Limit: 20MB
  if (file.size > 20 * 1024 * 1024) {
    return Response.json(
      { error: "File is too large. Maximum size is 20MB." },
      { status: 400 }
    );
  }

  const csvText = await file.text();
  const { valid, skipped, errors } = parseCSV(csvText);

  if (!valid.length) {
    return Response.json(
      {
        error: "No valid transactions found in file.",
        details: errors,
        skipped,
      },
      { status: 422 }
    );
  }

  // Batch insert in chunks of 500 to avoid query size limits
  let imported = 0;
  const CHUNK = 500;

  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const result = await prisma.transaction.createMany({
      data: chunk.map((tx) => ({ ...tx, userId: user.id })),
      skipDuplicates: true,
    });
    imported += result.count;
  }

  // Run heavy operations asynchronously — don't block the HTTP response
  Promise.all([
    recomputeAggregates(user.id),
    detectSubscriptions(user.id),
  ]).catch(console.error);

  return Response.json({
    success: true,
    imported,
    skipped: skipped + (valid.length - imported), // includes deduped rows
    total: valid.length + skipped,
    errors: errors.slice(0, 5),
  });
}
