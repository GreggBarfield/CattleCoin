import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard, KpiCardSkeleton } from "@/components/common/KpiCard";
import { StageBadge } from "@/components/common/StageBadge";
import { VerifiedBadge } from "@/components/common/VerifiedBadge";
import { PoolsTable, PoolsTableSkeleton } from "@/components/tables/PoolsTable";
import { MyInvestments } from "@/components/common/MyInvestments";
import type { PoolSortKey } from "@/components/tables/PoolsTable";
import { getInvestorPortfolio, getInvestorHoldings } from "@/lib/api";
import type { PortfolioSummary, Pool } from "@/lib/types";
import { formatUsd, formatDateTime } from "@/lib/utils";

export function InvestorDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const resolvedSlug = slug ?? "";

  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [holdings, setHoldings] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PoolSortKey>("paidIn");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!resolvedSlug) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getInvestorPortfolio(resolvedSlug),
      getInvestorHoldings(resolvedSlug),
    ])
      .then(([portfolio, pools]) => {
        setData(portfolio);
        setHoldings(pools);
      })
      .catch(() => setError("Failed to load dashboard data."))
      .finally(() => setLoading(false));
  }, [resolvedSlug]);

  // Build a herdId -> herdName lookup for use in recent events
  const herdNameMap = new Map<string, string>(
    holdings.map((p) => [p.herdId, p.name])
  );

  function handleSort(key: PoolSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (error) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-red-600">{error}</p>
        <button
          className="px-4 py-2 bg-slate-100 rounded text-sm"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Investor Dashboard</h1>
          <p className="text-sm text-slate-500 capitalize mt-0.5">
            {resolvedSlug.replace("investor", "Investor ")}
          </p>
        </div>
        {data && (
          <span className="text-xs text-slate-400">
            as of {formatDateTime(data.asOfIso)}
          </span>
        )}
      </div>

      {/* KPI Cards — all labeled */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          <>
            <KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton />
          </>
        ) : data ? (
          <>
            <KpiCard
              label="Paid In"
              value={formatUsd(data.totals.paidIn)}
              subtitle="total across all your lots"
              trend="neutral"
            />
            <KpiCard
              label="Still Invested"
              value={formatUsd(data.totals.stillInvested)}
              subtitle="paid in, not yet sold"
              trend="neutral"
            />
            <KpiCard
              label="Owed To You"
              value={formatUsd(data.totals.owedFromSales)}
              subtitle="from approved sales, not yet paid"
              trend={data.totals.owedFromSales > 0 ? "up" : "neutral"}
            />
            <KpiCard
              label="Lots Held"
              value={data.poolsHeld.toString()}
              subtitle="active investments"
              trend="neutral"
            />
          </>
        ) : null}
      </div>

      {/* My Investments — clickable cards, each navigates to /investor/:slug/holdings/:id */}
      <MyInvestments pools={holdings} loading={loading} slug={resolvedSlug} />

      {/* Recent Lifecycle Events — show herd name not raw UUID */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Lifecycle Events</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : data ? (
            <ul className="divide-y text-sm">
              {data.recentEvents.map((ev) => (
                <li key={ev.id} className="py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {ev.poolId && (
                      <Link
                        to={`/investor/${resolvedSlug}/holdings/${ev.poolId}`}
                        className="font-medium text-blue-600 hover:underline truncate block"
                      >
                        {/* Show herd name — fall back to ID only if name unavailable */}
                        {herdNameMap.get(ev.poolId) ?? ev.poolId}
                      </Link>
                    )}
                    <p className="text-slate-600 truncate">{ev.note}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StageBadge stage={ev.stage} />
                    {ev.verified && <VerifiedBadge verified={true} />}
                    <span className="text-xs text-slate-400">
                      {formatDateTime(ev.timestampIso)}
                    </span>
                  </div>
                </li>
              ))}
              {data.recentEvents.length === 0 && (
                <li className="py-6 text-center text-slate-400 text-sm">
                  No recent events.
                </li>
              )}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {/* Top Lots — "View all" goes to /investor/:slug/holdings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Top Lots by Value</CardTitle>
          <Link
            to={`/investor/${resolvedSlug}/holdings`}
            className="text-sm text-blue-600 hover:underline"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <PoolsTableSkeleton />
          ) : data ? (
            <PoolsTable
              pools={data.topPools}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              slug={resolvedSlug}
              compact
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}