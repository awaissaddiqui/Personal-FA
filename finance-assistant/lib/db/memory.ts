import OpenAI from "openai";
import { prisma } from "@/lib/db/prisma";
import { MEMORY_EXTRACTION_PROMPT } from "@/lib/ai/prompts";

export async function getMemoryContext(userId: string): Promise<string> {
  const memories = await prisma.userMemory.findMany({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (!memories.length) return "";

  return memories.map((m) => `- ${m.rawFact}`).join("\n");
}

export async function extractAndStoreMemory(
  openai: OpenAI,
  userId: string,
  userMessage: string
): Promise<void> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: MEMORY_EXTRACTION_PROMPT + userMessage },
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
      temperature: 0,
    });

    const parsed = JSON.parse(
      response.choices[0].message.content ?? '{"found":false,"memories":[]}'
    );

    if (!parsed.found || !parsed.memories?.length) return;

    for (const mem of parsed.memories) {
      if (mem.key) {
        await prisma.userMemory.updateMany({
          where: { userId, key: mem.key, status: "active" },
          data: { status: "superseded" },
        });
      }

      await prisma.userMemory.create({
        data: {
          userId,
          rawFact: mem.rawFact,
          type: mem.type ?? "preference",
          key: mem.key ?? null,
          value: mem.value ?? null,
          tags: mem.tags ?? [],
        },
      });
    }
  } catch {
    // Memory extraction is best-effort; never block the main response
  }
}
