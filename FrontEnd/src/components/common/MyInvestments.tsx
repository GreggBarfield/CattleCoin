import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StageBadge } from "@/components/common/StageBadge";
import { VerifiedBadge } from "@/components/common/VerifiedBadge";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Pool, PurchaseStatus } from "@/lib/types";

const STATUS_STYLES: Record<PurchaseStatus, string> = {
  available: "bg-green-50 text-green-700 border-green-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  sold: "bg-slate-50 text-slate-600 border-slate-200",
};

interface MyInvestmentsProps {
  pools: Pool[];
  loading?: boolean;
  /** Investor slug — used to build the correct navigation URL */
  slug: string;
}

export function MyInvestments({ pools, loading, slug }: MyInvestmentsProps) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Investments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (pools.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Investments</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">
            No investments yet. Browse <button
              className="text-blue-600 underline underline-offset-2"
              onClick={() => navigate(`/investor/${slug}/holdings`)}
            >all lots</button> to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          My Investments ({pools.length} lot{pools.length !== 1 ? "s" : ""})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pools.map((pool) => (
            <button
              key={pool.id}
              onClick={() => navigate(`/investor/${slug}/holdings/${pool.id}`)}
              className={cn(
                "text-left rounded-lg border border-border bg-card p-4",
                "hover:border-primary/40 hover:shadow-sm transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{pool.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {pool.geneticsLabel}
                  </p>
                </div>
                <VerifiedBadge verified={pool.verified} />
              </div>

              {/* Stage */}
              <div className="mb-3">
                <StageBadge stage={pool.dominantStage} />
              </div>

              {/* Tokens owned */}
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Tokens Owned</span>
                <span className="font-semibold text-primary">
                  {pool.tokenAmount.toLocaleString()} / {pool.totalSupply.toLocaleString()}
                </span>
              </div>

              {/* Paid in - real money, not a projected value */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Paid In</span>
                <span className="font-semibold">{formatUsd(pool.paidIn ?? 0)}</span>
              </div>

              {/* Status badge */}
              <div className="mt-2 pt-2 border-t border-border">
                <Badge
                  variant="outline"
                  className={cn("text-[10px] px-1.5 py-0", STATUS_STYLES[pool.purchaseStatus])}
                >
                  {pool.purchaseStatus.charAt(0).toUpperCase() + pool.purchaseStatus.slice(1)}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}