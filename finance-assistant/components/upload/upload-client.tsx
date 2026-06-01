"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

type UploadResult = {
  success: boolean;
  imported?: number;
  skipped?: number;
  total?: number;
  errors?: string[];
  error?: string;
};

export default function UploadClient() {
  const [csvResult, setCsvResult] = useState<UploadResult | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvDragging, setCsvDragging] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  async function uploadCSV(file: File) {
    setCsvLoading(true);
    setCsvResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload/csv", { method: "POST", body: formData });
      const data = await res.json();
      setCsvResult(data);
    } catch {
      setCsvResult({ success: false, error: "Upload failed. Please try again." });
    } finally {
      setCsvLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setCsvDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadCSV(file);
  }

  return (
    <div className="space-y-6">
      {/* CSV Upload */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-1">Bank Statement CSV</h2>
        <p className="text-sm text-gray-500 mb-4">
          Export your transactions from your bank and upload here. Most banks export CSV with columns for date, amount, and description.
        </p>

        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
            csvDragging
              ? "border-blue-400 bg-blue-50"
              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
          )}
          onDragOver={(e) => { e.preventDefault(); setCsvDragging(true); }}
          onDragLeave={() => setCsvDragging(false)}
          onDrop={handleDrop}
          onClick={() => csvRef.current?.click()}
        >
          <div className="text-3xl mb-2">📄</div>
          <p className="text-sm font-medium text-gray-700">
            {csvLoading ? "Processing…" : "Drop CSV here or click to browse"}
          </p>
          <p className="text-xs text-gray-400 mt-1">Supports most bank export formats · Max 20MB</p>
        </div>

        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadCSV(file);
            e.target.value = "";
          }}
        />

        {csvLoading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-blue-600">
            <span className="animate-spin">⚙️</span>
            Parsing and importing transactions…
          </div>
        )}

        {csvResult && (
          <div
            className={cn(
              "mt-4 rounded-lg p-4 text-sm",
              csvResult.success
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-red-50 border border-red-200 text-red-800"
            )}
          >
            {csvResult.success ? (
              <>
                <p className="font-medium">✅ Import complete</p>
                <p className="mt-1">
                  {csvResult.imported?.toLocaleString()} new transactions imported
                  {csvResult.skipped ? `, ${csvResult.skipped} skipped (duplicates or invalid)` : ""}
                </p>
                <p className="text-xs mt-1 text-green-600">
                  Aggregates and subscription detection running in background.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">❌ {csvResult.error}</p>
                {csvResult.errors?.map((e, i) => (
                  <p key={i} className="text-xs mt-0.5">{e}</p>
                ))}
              </>
            )}
          </div>
        )}

        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs font-medium text-gray-600 mb-1">Supported column names</p>
          <div className="grid grid-cols-3 gap-1 text-xs text-gray-500">
            <span>Date: <code>date, transaction date</code></span>
            <span>Amount: <code>amount, debit, credit</code></span>
            <span>Merchant: <code>description, merchant, payee</code></span>
          </div>
        </div>
      </div>

      {/* Receipt tip */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-1">Receipt Photos</h2>
        <p className="text-sm text-gray-500">
          Upload receipt photos directly from the{" "}
          <a href="/chat" className="text-blue-600 hover:underline">Chat</a> page
          using the 📸 button. The AI will extract the details automatically.
        </p>
      </div>
    </div>
  );
}
