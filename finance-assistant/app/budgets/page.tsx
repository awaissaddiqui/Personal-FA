import BudgetsClient from "@/components/budgets/budgets-client";

export default function BudgetsPage() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Budgets</h1>
        <p className="text-sm text-gray-500 mt-1">Set monthly spending limits per category.</p>
      </div>
      <BudgetsClient />
    </div>
  );
}
