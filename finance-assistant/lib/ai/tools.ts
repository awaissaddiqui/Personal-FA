import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "query_transactions",
      description:
        "Query the user's transactions with optional filters. Returns summary stats and a capped list of matching transactions. Use this for specific spending questions (how much on X, biggest purchase, etc.).",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: "ISO date string YYYY-MM-DD (inclusive)",
          },
          endDate: {
            type: "string",
            description: "ISO date string YYYY-MM-DD (inclusive)",
          },
          category: {
            type: "string",
            description: "Category to filter by (e.g. groceries, dining, transport)",
          },
          merchant: {
            type: "string",
            description: "Merchant name substring to filter by",
          },
          type: {
            type: "string",
            enum: ["debit", "credit"],
            description: "Transaction type filter",
          },
          limit: {
            type: "number",
            description: "Max transactions to return (default 20, max 50)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monthly_aggregates",
      description:
        "Get pre-computed monthly spending totals grouped by category. ALWAYS use this for trend analysis, historical comparisons, and 'am I spending more than usual' questions. Much cheaper than loading raw transactions.",
      parameters: {
        type: "object",
        properties: {
          monthsBack: {
            type: "number",
            description: "How many months of history to retrieve (e.g. 12 for a full year)",
          },
          category: {
            type: "string",
            description: "Optional: filter to one category",
          },
        },
        required: ["monthsBack"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_budget_status",
      description:
        "Get all budgets with current month spending vs limits. Use for budget-related questions.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_subscriptions",
      description:
        "Get the list of detected recurring subscriptions for the user.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_merchant",
      description:
        "Look up what an unfamiliar merchant or charge likely is. Uses cache first, then LLM inference.",
      parameters: {
        type: "object",
        properties: {
          merchantName: {
            type: "string",
            description: "The merchant name as it appears on the bank statement",
          },
        },
        required: ["merchantName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "store_memory",
      description:
        "Store a user preference or personal financial fact for future conversations.",
      parameters: {
        type: "object",
        properties: {
          rawFact: {
            type: "string",
            description: "The original statement from the user",
          },
          type: {
            type: "string",
            enum: ["income_info", "exclusion_rule", "goal", "preference", "context"],
          },
          key: { type: "string", description: "Structured key for the fact" },
          value: { type: "string", description: "Structured value" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for retrieval (e.g. ['budget', 'food'])",
          },
        },
        required: ["rawFact", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_anomalies",
      description:
        "Get unusual spending patterns detected for the current month compared to the user's baseline.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];
