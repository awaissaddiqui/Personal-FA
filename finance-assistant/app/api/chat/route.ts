import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { queryTransactions, getMonthlyAggregates } from "@/lib/db/transactions";
import { getBudgetStatus } from "@/lib/db/budgets";
import { getMemoryContext, extractAndStoreMemory } from "@/lib/db/memory";
import { detectAnomalies } from "@/lib/algorithms/anomalies";
import { classifyIntent, modelForIntent } from "@/lib/ai/router";
import { tools } from "@/lib/ai/tools";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions/completions";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  userId: string
): Promise<string> {
  try {
    switch (name) {
      case "query_transactions": {
        const result = await queryTransactions(userId, args as Parameters<typeof queryTransactions>[1]);
        return JSON.stringify(result);
      }
      case "get_monthly_aggregates": {
        const result = await getMonthlyAggregates(
          userId,
          Number(args.monthsBack ?? 12),
          args.category as string | undefined
        );
        return JSON.stringify(result);
      }
      case "get_budget_status": {
        const result = await getBudgetStatus(userId);
        return JSON.stringify(result);
      }
      case "get_subscriptions": {
        const subs = await prisma.subscription.findMany({
          where: { userId, isCancelled: false },
          orderBy: { estimatedAmount: "desc" },
        });
        return JSON.stringify(
          subs.map((s) => ({
            merchant: s.merchant,
            amount: Number(s.estimatedAmount.toFixed(2)),
            frequency: s.frequency,
            lastCharged: s.lastCharged.toISOString().split("T")[0],
            nextExpected: s.nextExpected?.toISOString().split("T")[0],
            confidence: s.confidence,
          }))
        );
      }
      case "lookup_merchant": {
        const merchantName = String(args.merchantName ?? "");
        const cached = await prisma.merchantLookupCache.findUnique({
          where: { merchantRaw: merchantName.toLowerCase() },
        });
        if (cached && cached.expiresAt > new Date()) {
          return JSON.stringify({ merchant: merchantName, description: cached.description, category: cached.category });
        }
        // LLM inference (stub — production would use web search)
        const resp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: `What is "${merchantName}" as it appears on a bank statement? Give a 1-sentence description and a category (one of: groceries, dining, transport, entertainment, utilities, health, shopping, other). Return JSON: {"description": "...", "category": "..."}`,
          }],
          response_format: { type: "json_object" },
          max_tokens: 80,
        });
        const info = JSON.parse(resp.choices[0].message.content ?? "{}");
        const expires = new Date();
        expires.setDate(expires.getDate() + 30);
        await prisma.merchantLookupCache.upsert({
          where: { merchantRaw: merchantName.toLowerCase() },
          update: { description: info.description, category: info.category, expiresAt: expires },
          create: {
            merchantRaw: merchantName.toLowerCase(),
            description: info.description ?? "Unknown merchant",
            category: info.category ?? "other",
            expiresAt: expires,
          },
        });
        return JSON.stringify({ merchant: merchantName, ...info });
      }
      case "store_memory": {
        const { rawFact, type, key, value, tags } = args as {
          rawFact: string; type: string; key?: string; value?: string; tags?: string[];
        };
        if (key) {
          await prisma.userMemory.updateMany({
            where: { userId, key, status: "active" },
            data: { status: "superseded" },
          });
        }
        await prisma.userMemory.create({
          data: { userId, rawFact, type, key: key ?? null, value: value ?? null, tags: tags ?? [] },
        });
        return JSON.stringify({ stored: true, fact: rawFact });
      }
      case "get_anomalies": {
        const anomalies = await detectAnomalies(userId);
        return JSON.stringify(anomalies);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { messages, conversationId } = await request.json();
  const userMessage = messages[messages.length - 1]?.content ?? "";

  // Classify intent to pick the right model
  const intent = await classifyIntent(openai, userMessage);
  const model = modelForIntent(intent);

  // Build context
  const [memoryContext] = await Promise.all([
    getMemoryContext(user.id),
  ]);

  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = buildSystemPrompt(memoryContext, today);

  // Agentic loop with streaming
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) =>
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));

      try {
        const conversationMessages = messages.slice(-10); // Keep last 10 for context
        let currentMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          ...conversationMessages,
        ];

        let iterCount = 0;
        const MAX_TOOL_ITERATIONS = 5;

        while (iterCount < MAX_TOOL_ITERATIONS) {
          iterCount++;

          const completion = await openai.chat.completions.create({
            model,
            messages: currentMessages,
            tools,
            tool_choice: "auto",
            stream: iterCount === MAX_TOOL_ITERATIONS, // Only stream the final response
          });

          // Non-streaming tool call phase
          if (!Array.isArray(completion) && "choices" in completion) {
            const choice = completion.choices[0];
            const msg = choice.message;

            if (!msg.tool_calls || msg.tool_calls.length === 0) {
              // Final answer — re-request with streaming
              const streamingCompletion = await openai.chat.completions.create({
                model,
                messages: currentMessages,
                stream: true,
              });

              let fullContent = "";
              for await (const chunk of streamingCompletion) {
                const delta = chunk.choices[0]?.delta?.content ?? "";
                if (delta) {
                  fullContent += delta;
                  send(JSON.stringify({ type: "delta", content: delta }));
                }
              }

              // Persist messages
              if (conversationId) {
                await prisma.message.createMany({
                  data: [
                    { conversationId, role: "user", content: userMessage },
                    { conversationId, role: "assistant", content: fullContent },
                  ],
                });
              }

              // Async: extract memories from user message
              extractAndStoreMemory(openai, user.id, userMessage).catch(() => {});

              send(JSON.stringify({ type: "done" }));
              controller.close();
              return;
            }

            // Execute tool calls
            currentMessages.push(msg);

            for (const toolCall of msg.tool_calls) {
              // Only ChatCompletionMessageFunctionToolCall has .function; skip custom tool calls
              if (!("function" in toolCall)) continue;
              const fnToolCall = toolCall as ChatCompletionMessageFunctionToolCall;
              const args = JSON.parse(fnToolCall.function.arguments ?? "{}");
              send(JSON.stringify({ type: "tool_call", name: fnToolCall.function.name }));

              const toolResult = await handleToolCall(
                fnToolCall.function.name,
                args,
                user.id
              );

              currentMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: toolResult,
              });
            }
          }
        }

        // Max iterations reached — ask model to summarize what it found
        send(JSON.stringify({ type: "delta", content: "I've gathered the data. Let me summarize what I found for you." }));
        send(JSON.stringify({ type: "done" }));
        controller.close();
      } catch (err) {
        send(JSON.stringify({ type: "error", message: String(err) }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
