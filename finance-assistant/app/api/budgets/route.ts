import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { getBudgetStatus } from "@/lib/db/budgets";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const status = await getBudgetStatus(user.id);
  return Response.json(status);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { category, limitAmt, period } = await request.json();

  if (!category || !limitAmt) {
    return Response.json({ error: "category and limitAmt are required" }, { status: 400 });
  }

  const budget = await prisma.budget.upsert({
    where: {
      userId_category_period: {
        userId: user.id,
        category,
        period: period ?? "monthly",
      },
    },
    update: { limitAmt: Number(limitAmt) },
    create: {
      userId: user.id,
      category,
      limitAmt: Number(limitAmt),
      period: period ?? "monthly",
    },
  });

  return Response.json(budget);
}
