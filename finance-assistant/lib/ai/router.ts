import OpenAI from "openai";
import { CLASSIFIER_PROMPT } from "./prompts";

export type Intent =
  | "simple_lookup"
  | "complex_analysis"
  | "budget_check"
  | "subscription_list"
  | "merchant_lookup"
  | "memory_store"
  | "anomaly_check"
  | "financial_summary"
  | "cutback_suggestions"
  | "general";

const FAST_PATTERNS: Array<{ pattern: RegExp; intent: Intent }> = [
  { pattern: /how much.*(spend|spent|cost|pay|paid)/i, intent: "simple_lookup" },
  { pattern: /biggest|largest|most expensive|top (purchase|transaction|spend)/i, intent: "simple_lookup" },
  { pattern: /what (is|was|are).*(charge|merchant|company|store)/i, intent: "merchant_lookup" },
  { pattern: /subscription|recurring|monthly charge|auto.?renew/i, intent: "subscription_list" },
  { pattern: /budget|limit|over budget|on track/i, intent: "budget_check" },
  { pattern: /remember|don't (count|include)|i get paid|my salary|save for/i, intent: "memory_store" },
  { pattern: /unusual|strange|unexpected|suspicious|out of.?pattern/i, intent: "anomaly_check" },
  { pattern: /summarize|overview|where.*money|financial (summary|health)/i, intent: "financial_summary" },
  { pattern: /cut back|save money|reduce|suggest|recommendation/i, intent: "cutback_suggestions" },
  { pattern: /more than usual|spending.*(increase|up|higher|more)/i, intent: "complex_analysis" },
  { pattern: /compare|trend|over time|last (year|6 months|quarter)/i, intent: "complex_analysis" },
];

export function classifyFast(message: string): Intent | null {
  for (const { pattern, intent } of FAST_PATTERNS) {
    if (pattern.test(message)) return intent;
  }
  return null;
}

export async function classifyIntent(
  openai: OpenAI,
  message: string
): Promise<Intent> {
  const fast = classifyFast(message);
  if (fast) return fast;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: CLASSIFIER_PROMPT + message }],
      response_format: { type: "json_object" },
      max_tokens: 30,
      temperature: 0,
    });
    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");
    return (parsed.intent as Intent) ?? "general";
  } catch {
    return "general";
  }
}

export function modelForIntent(intent: Intent): "gpt-4o" | "gpt-4o-mini" {
  const heavyIntents: Intent[] = [
    "complex_analysis",
    "financial_summary",
    "cutback_suggestions",
  ];
  return heavyIntents.includes(intent) ? "gpt-4o" : "gpt-4o-mini";
}
