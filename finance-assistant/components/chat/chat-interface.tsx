"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
}

const SUGGESTED_PROMPTS = [
  "How much did I spend last month?",
  "What are my biggest expenses this month?",
  "Am I spending more than usual on dining?",
  "Show me my recurring subscriptions",
  "Where can I cut back on spending?",
  "Summarize my finances",
];

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const createConversation = useCallback(async () => {
    if (conversationId) return conversationId;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New conversation" }),
    });
    const conv = await res.json();
    setConversationId(conv.id);
    return conv.id;
  }, [conversationId]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setActiveTools([]);

    const convId = await createConversation();

    const assistantMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "",
      toolsUsed: [],
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const allMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: allMessages, conversationId: convId }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const toolsUsed: string[] = [];

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n").filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          const json = line.slice(6);
          try {
            const event = JSON.parse(json);
            if (event.type === "delta") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: m.content + event.content }
                    : m
                )
              );
            } else if (event.type === "tool_call") {
              toolsUsed.push(event.name);
              setActiveTools([...toolsUsed]);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, toolsUsed: [...toolsUsed] } : m
                )
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: "Sorry, something went wrong. Please try again." }
                    : m
                )
              );
            }
          } catch {
            // malformed SSE line, skip
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: "Connection error. Please try again." }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      setActiveTools([]);
    }
  }

  async function handleReceiptUpload(file: File) {
    setUploadingImage(true);
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: `📸 Uploading receipt: ${file.name}`,
    };
    setMessages((prev) => [...prev, userMsg]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload/receipt", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: "assistant", content: `❌ ${data.error}` },
        ]);
        return;
      }

      const { extraction, status, confidence } = data;
      const confidencePct = Math.round((confidence ?? 0) * 100);

      let reply = "";
      if (status === "processed" && extraction.merchant && extraction.amount) {
        reply = `✅ Receipt processed (${confidencePct}% confidence)\n\n**${extraction.merchant}** — $${extraction.amount.toFixed(2)}\nDate: ${extraction.date ?? "unknown"}\n\nTransaction saved automatically.`;
      } else if (status === "needs_review") {
        reply = `⚠️ Partial extraction (${confidencePct}% confidence)\n\nI could read some details:\n- Merchant: ${extraction.merchant ?? "unclear"}\n- Amount: ${extraction.amount ? `$${extraction.amount.toFixed(2)}` : "unclear"}\n- Date: ${extraction.date ?? "unclear"}\n\n${extraction.notes ? `Notes: ${extraction.notes}` : ""}`;
      } else {
        reply = `❌ Could not read receipt. ${extraction?.notes ?? "Please try a clearer photo."}`;
      }

      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "assistant", content: reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "assistant", content: "Failed to upload receipt. Please try again." },
      ]);
    } finally {
      setUploadingImage(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const TOOL_LABELS: Record<string, string> = {
    query_transactions: "Reading transactions…",
    get_monthly_aggregates: "Analyzing spending history…",
    get_budget_status: "Checking budgets…",
    get_subscriptions: "Loading subscriptions…",
    lookup_merchant: "Looking up merchant…",
    store_memory: "Saving preference…",
    get_anomalies: "Checking for anomalies…",
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-100 px-6 py-3 flex items-center gap-2">
        <span className="text-lg">💬</span>
        <h1 className="font-semibold text-gray-900 text-sm">Finance Assistant</h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto chat-scroll px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-4xl mb-3">💰</div>
            <h2 className="font-semibold text-gray-900 mb-1">Ask about your finances</h2>
            <p className="text-sm text-gray-500 mb-6 max-w-sm">
              Ask questions about spending, upload receipts, set budgets, or find out what that mystery charge is.
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-lg">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left text-xs border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-600"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-900"
              )}
            >
              {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {msg.toolsUsed.map((t) => (
                    <span key={t} className="text-xs bg-white/20 rounded px-1.5 py-0.5 opacity-70">
                      {t.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-500">
              {activeTools.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="animate-pulse">⚙️</span>
                  {TOOL_LABELS[activeTools[activeTools.length - 1]] ?? "Thinking…"}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className="animate-bounce">●</span>
                  <span className="animate-bounce [animation-delay:0.1s]">●</span>
                  <span className="animate-bounce [animation-delay:0.2s]">●</span>
                </span>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadingImage}
            title="Upload receipt"
            className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            📸
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleReceiptUpload(file);
              e.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your spending…"
            rows={1}
            className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-32 overflow-y-auto"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="shrink-0 bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-center">
          Press Enter to send · Shift+Enter for new line · 📸 to upload receipt
        </p>
      </div>
    </div>
  );
}
