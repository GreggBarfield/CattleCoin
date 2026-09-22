import { formatUsd } from "@/lib/utils";
import type { CostItem } from "@/lib/types";

interface CostBreakdownProps {
  items: CostItem[];
}

// Real logged costs for this herd, by category - see
// step-dashboard-real-numbers.md. This used to be "Budget Breakdown", a
// fabricated split of the listing price into cost/revenue percentages that
// had no connection to the real books; now it's the herd's actual active
// costs, same categories My Money and the admin Herd operations screen use.
export function CostBreakdown({ items }: CostBreakdownProps) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">No costs recorded yet.</p>;
  }

  const total = items.reduce((s, i) => s + i.amountUsd, 0);
  const maxBar = Math.max(...items.map((i) => i.amountUsd), 1);

  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span>{item.label}</span>
            <span className="font-medium">{formatUsd(item.amountUsd)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-red-400"
              style={{ width: `${(item.amountUsd / maxBar) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
        <span>Total logged so far</span>
        <span className="text-red-600">{formatUsd(total)}</span>
      </div>
    </div>
  );
}