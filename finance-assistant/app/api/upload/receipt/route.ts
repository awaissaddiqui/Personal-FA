import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { RECEIPT_EXTRACTION_PROMPT } from "@/lib/ai/prompts";
import { normalizeCategory } from "@/lib/ingestion/csv-parser";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) return Response.json({ error: "No file provided" }, { status: 400 });

  if (!file.type.startsWith("image/")) {
    return Response.json(
      { error: "Please upload an image file (JPG, PNG, HEIC, etc.)." },
      { status: 400 }
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: "Image must be under 10MB." }, { status: 400 });
  }

  // Upload to Supabase Storage
  const fileName = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(fileName, arrayBuffer, { contentType: file.type });

  if (uploadError) {
    return Response.json({ error: "Failed to upload image." }, { status: 500 });
  }

  // Create pending receipt record
  const receipt = await prisma.receipt.create({
    data: { userId: user.id, storagePath: fileName, status: "pending" },
  });

  // Get signed URL for GPT-4o Vision (valid 5 minutes)
  const { data: signedData } = await supabase.storage
    .from("receipts")
    .createSignedUrl(fileName, 300);

  if (!signedData?.signedUrl) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { status: "failed" },
    });
    return Response.json({ error: "Failed to generate image URL." }, { status: 500 });
  }

  // GPT-4o Vision extraction
  let extraction: {
    merchant: string | null;
    date: string | null;
    amount: number | null;
    currency: string;
    tax: number | null;
    items: Array<{ name: string; price: number }>;
    confidence: number;
    notes: string;
  };

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: RECEIPT_EXTRACTION_PROMPT },
            {
              type: "image_url",
              image_url: { url: signedData.signedUrl, detail: "high" },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });

    extraction = JSON.parse(response.choices[0].message.content ?? "{}");
  } catch {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { status: "failed" },
    });
    return Response.json(
      { error: "Failed to read receipt. Please try a clearer image." },
      { status: 422 }
    );
  }

  const confidence = extraction.confidence ?? 0;
  const status = confidence < 0.5 ? "needs_review" : "processed";

  // Auto-create transaction if confidence is high enough
  let transactionId: string | undefined;
  if (confidence >= 0.7 && extraction.amount && extraction.merchant) {
    const date = extraction.date ? new Date(extraction.date) : new Date();
    const importHash = Buffer.from(
      `receipt:${receipt.id}:${date.toISOString().split("T")[0]}:${extraction.amount}`
    ).toString("base64").slice(0, 32);

    const tx = await prisma.transaction.create({
      data: {
        userId: user.id,
        date,
        amount: extraction.amount,
        type: "debit",
        merchant: extraction.merchant,
        rawMerchant: extraction.merchant,
        category: normalizeCategory(extraction.merchant),
        description: extraction.items?.length
          ? extraction.items.slice(0, 3).map((i) => i.name).join(", ")
          : null,
        source: "receipt",
        importHash,
      },
    });
    transactionId = tx.id;
  }

  await prisma.receipt.update({
    where: { id: receipt.id },
    data: {
      status,
      confidence,
      extractedAt: new Date(),
      rawExtraction: extraction as object,
      transactionId: transactionId ?? null,
    },
  });

  return Response.json({
    receiptId: receipt.id,
    status,
    confidence,
    extraction,
    transactionCreated: !!transactionId,
  });
}
