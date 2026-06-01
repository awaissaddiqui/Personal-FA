import Papa from "papaparse";
import crypto from "crypto";

const CATEGORY_MAP: Record<string, string> = {
  // Food & Drink
  "mcdonald": "dining", "starbucks": "dining", "chipotle": "dining",
  "doordash": "dining", "ubereats": "dining", "grubhub": "dining",
  "whole foods": "groceries", "trader joe": "groceries", "kroger": "groceries",
  "safeway": "groceries", "walmart": "groceries", "target": "groceries",
  "costco": "groceries",
  // Transport
  "uber": "transport", "lyft": "transport", "chevron": "transport",
  "shell": "transport", "bp ": "transport", "exxon": "transport",
  "parking": "transport", "mta": "transport", "metro": "transport",
  // Entertainment
  "netflix": "entertainment", "spotify": "entertainment", "hulu": "entertainment",
  "disney": "entertainment", "amazon prime": "entertainment",
  "apple music": "entertainment", "youtube": "entertainment",
  // Utilities
  "at&t": "utilities", "verizon": "utilities", "t-mobile": "utilities",
  "comcast": "utilities", "xfinity": "utilities", "pg&e": "utilities",
  "con ed": "utilities",
  // Health
  "cvs": "health", "walgreens": "health", "pharmacy": "health",
  "doctor": "health", "dental": "health", "gym": "health",
  "planet fitness": "health",
  // Shopping
  "amazon": "shopping", "ebay": "shopping", "etsy": "shopping",
  "zara": "shopping", "h&m": "shopping",
};

export function normalizeCategory(merchant: string): string {
  const lower = merchant.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return "other";
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Try common formats
  const attempts = [
    new Date(trimmed),                              // ISO or locale default
    new Date(trimmed.replace(/(\d+)\/(\d+)\/(\d{2})$/, "20$3-$1-$2")), // MM/DD/YY
  ];

  for (const d of attempts) {
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
  }
  return null;
}

function parseAmount(raw: string | number): number | null {
  if (typeof raw === "number") return isNaN(raw) ? null : Math.abs(raw);
  const cleaned = String(raw).replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.abs(num);
}

function importHash(date: Date, amount: number, merchant: string): string {
  const str = `${date.toISOString().split("T")[0]}|${amount.toFixed(2)}|${merchant.toLowerCase().trim()}`;
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 32);
}

export interface ParsedTransaction {
  date: Date;
  amount: number;
  type: "debit" | "credit";
  merchant: string;
  rawMerchant: string;
  category: string;
  description: string | null;
  importHash: string;
  source: "csv";
}

export interface ParseResult {
  valid: ParsedTransaction[];
  skipped: number;
  errors: string[];
}

// Flexible header detection
const DATE_KEYS = ["date", "transaction date", "trans date", "posted date"];
const AMOUNT_KEYS = ["amount", "debit", "credit", "transaction amount"];
const MERCHANT_KEYS = ["description", "merchant", "name", "payee", "memo", "vendor"];

function findKey(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

export function parseCSV(csvText: string): ParseResult {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = result.meta.fields ?? [];
  const dateKey = findKey(headers, DATE_KEYS);
  const amountKey = findKey(headers, AMOUNT_KEYS);
  const merchantKey = findKey(headers, MERCHANT_KEYS);

  if (!dateKey || !amountKey || !merchantKey) {
    return {
      valid: [],
      skipped: result.data.length,
      errors: [
        `Could not detect required columns. Found: ${headers.join(", ")}. Need: date, amount, and description/merchant columns.`,
      ],
    };
  }

  const valid: ParsedTransaction[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const row of result.data as Record<string, string>[]) {
    const rawDate = row[dateKey];
    const rawAmount = row[amountKey];
    const rawMerchant = row[merchantKey] ?? "";

    const date = parseDate(rawDate);
    const amount = parseAmount(rawAmount);

    if (!date) { skipped++; continue; }
    if (amount === null || amount <= 0) { skipped++; continue; }
    if (!rawMerchant.trim()) { skipped++; continue; }

    const merchant = rawMerchant.trim();
    const isCredit =
      (row["type"] ?? row["transaction type"] ?? "").toLowerCase().includes("credit") ||
      (rawAmount.startsWith("-"));

    valid.push({
      date,
      amount,
      type: isCredit ? "credit" : "debit",
      merchant,
      rawMerchant: merchant,
      category: normalizeCategory(merchant),
      description: row["notes"] ?? row["memo"] ?? null,
      importHash: importHash(date, amount, merchant),
      source: "csv",
    });
  }

  if (errors.length === 0 && result.errors.length > 0) {
    errors.push(...result.errors.slice(0, 3).map((e) => e.message));
  }

  return { valid, skipped, errors };
}
