import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ChevronRight, FileText, ShieldCheck, ClipboardList,
  ArrowLeftRight, Award, Shield, ExternalLink, TrendingUp,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard, KpiCardSkeleton } from "@/components/common/KpiCard";
import { SupplyChainStepper } from "@/components/lifecycle/SupplyChainStepper";
import { PipelineBar } from "@/components/pool/PipelineBar";
import { CostBreakdown } from "@/components/pool/CostBreakdown";
import { CowsTable, CowsTableSkeleton } from "@/components/tables/CowsTable";
import { HerdMoneyCards } from "@/components/pool/HerdMoneyCards";
import { getPoolById, getPoolCows, getInvestorHoldings } from "@/lib/api";
import type { PoolDetail as PoolDetailType, Cow, PurchaseStatus } from "@/lib/types";
import { formatUsd, formatNumber } from "@/lib/utils";

const DOC_ICONS: Record<string, React.ElementType> = {
  certificate: Award,
  inspection: ClipboardList,
  transfer: ArrowLeftRight,
  grade: ShieldCheck,
  insurance: Shield,
  other: FileText,
};

const STATUS_STYLES: Record<PurchaseStatus, string> = {
  available: "bg-green-50 text-green-700 border-green-200",
  pending:   "bg-yellow-50 text-yellow-700 border-yellow-200",
  sold:      "bg-slate-50 text-slate-600 border-slate-200",
};

function abbreviateAddress(addr: string): string {
  if (!addr || addr === "#" || addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export function PoolDetail() {
  // Route: /investor/:slug/holdings/:id
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const resolvedSlug = slug ?? "";

  const [data, setData] = useState<PoolDetailType | null>(null);
  const [cows, setCows] = useState<Cow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cowsLoading, setCowsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [investorTokenAmount, setInvestorTokenAmount] = useState<number>(0);

  function handleRemoveCow(cowId: string) {
    setCows((prev) => prev.filter((c) => c.cowId !== cowId));
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setCowsLoading(true);

    // Fetch herd detail, cows, and investor holdings in parallel
    Promise.all([
      getPoolById(id),
      getPoolCows(id).catch(() => [] as Cow[]),
      getInvestorHoldings(resolvedSlug).catch(() => []),
    ])
      .then(([herdDetail, cowList, holdings]) => {
        if (!herdDetail) {
          setNotFound(true);
        } else {
          setData(herdDetail);
          setCows(cowList);
          // Find THIS investor's token amount for this specific herd
          const thisHerd = holdings.find((h) => h.herdId === id);
          setInvestorTokenAmount(thisHerd?.tokenAmount ?? 0);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => {
        setLoading(false);
        setCowsLoading(false);
      });
  }, [id, resolvedSlug]);

  if (notFound) {
    return (
      <div className="p-8 text-center space-y-3">
        <h2 className="text-lg font-semibold">Herd not found</h2>
        <p className="text-slate-500">No herd with ID "{id}" exists.</p>
        <Link to={`/investor/${resolvedSlug}/holdings`}>
          <Button variant="outline">Back to Marketplace</Button>
        </Link>
      </div>
    );
  }

  // â”€â”€ Derived values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const pool = data?.pool;
  const totalSupply = pool?.totalSupply ?? 1;

  // Investor-specific: how many tokens THIS investor owns in this herd
  const tokenAmount = investorTokenAmount;
  const ownershipPct = totalSupply > 0 ? tokenAmount / totalSupply : 0;
  const isOwner = tokenAmount > 0;

  // Tokens still available to purchase on the market
  const tokensRemaining = pool
    ? (pool.tokensRemaining ?? Math.max(0, totalSupply - ((pool as any).tokensSold ?? 0)))
    : 0;

  const isAvailable =
    !loading &&
    pool?.purchaseStatus !== "sold" &&
    tokensRemaining > 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-slate-500">
        <Link to={`/investor/${resolvedSlug}/holdings`} className="hover:underline">
          Marketplace
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        {loading ? <Skeleton className="h-4 w-24" /> : <span>{pool?.name}</span>}
      </nav>

      {/* Title row */}
      {loading ? (
        <Skeleton className="h-8 w-64" />
      ) : pool ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{pool.name}</h1>
              <Badge variant="outline">Lot</Badge>
              <Badge variant="outline" className={STATUS_STYLES[pool.purchaseStatus]}>
                {pool.purchaseStatus.charAt(0).toUpperCase() + pool.purchaseStatus.slice(1)}
              </Badge>
              {pool.cohortLabel && <Badge variant="secondary">{pool.cohortLabel}</Badge>}
              <Badge variant="secondary">{pool.geneticsLabel}</Badge>
            </div>
            {pool.contractAddress && pool.contractAddress !== "" && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span>Contract:</span>
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  {abbreviateAddress(pool.contractAddress)}
                </code>
              </div>
            )}
          </div>

          {isAvailable && (
            <Link to={`/invest/${pool.herdId}`}>
              <Button className="bg-green-600 hover:bg-green-700 text-white gap-2">
                <TrendingUp className="h-4 w-4" />
                Invest in This Herd
              </Button>
            </Link>
          )}
        </div>
      ) : null}

      {/* KPI Cards â€” all investor-specific and labeled */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          <><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /></>
        ) : pool ? (
          <>
            {/* 1. Real money raised so far, from all investors - not a projected value */}
            <KpiCard
              label="Raised So Far"
              value={formatUsd(pool.totalRaised ?? 0)}
              subtitle={`Listed at ${formatUsd(pool.listingPrice)}`}
              trend="neutral"
            />

            {/* 2. Real costs logged so far - not a projected return */}
            <KpiCard
              label="Costs So Far"
              value={formatUsd(pool.costsTotal ?? 0)}
              subtitle="active costs logged for this herd"
              trend="neutral"
            />

            {/* 3. THIS investor's tokens â€” not aggregate */}
            <KpiCard
              label="Your Tokens"
              value={
                isOwner
                  ? `${formatNumber(tokenAmount)} / ${formatNumber(totalSupply)}`
                  : "None"
              }
              subtitle={
                isOwner
                  ? `You own ${(ownershipPct * 100).toFixed(1)}% of this herd`
                  : "You have no stake in this herd"
              }
              trend="neutral"
            />

            {/* 4. Risk score */}
            <KpiCard
              label="Risk Score"
              value={(pool as any).riskScore != null ? String((pool as any).riskScore) : "-"}
              subtitle="0 = low, 100 = high"
              trend="neutral"
            />
          </>
        ) : null}
      </div>

      {/* Investor money: what you paid, what the herd has cost, LRP */}
      {id && <HerdMoneyCards herdId={id} slug={resolvedSlug} />}

      {/* Two column: Pipeline + Stepper | Budget + Chart */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Supply Chain Pipeline</CardTitle></CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-full" /> : pool ? (
                <PipelineBar breakdown={pool.stageBreakdown} />
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Lifecycle Progress</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : data ? (
                <SupplyChainStepper events={data.lifecycle} currentStage={pool!.dominantStage} />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Cost Breakdown</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : data ? (
                <CostBreakdown items={data.costBreakdown} />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Documents */}
      {!loading && data && data.documents.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Documents</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {data.documents.map((doc) => {
              const Icon = DOC_ICONS[doc.type] ?? FileText;
              return (
                <a
                  key={doc.title}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                >
                  <Icon className="h-4 w-4" />
                  {doc.title}
                  <ExternalLink className="h-3 w-3" />
                </a>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Cattle Records */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Individual Cattle Records ({cowsLoading ? "..." : cows.length} head)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {cowsLoading ? (
            <CowsTableSkeleton />
          ) : cows.length === 0 ? (
            <p className="p-6 text-center text-slate-500 text-sm">
              No cattle records found for this lot.
            </p>
          ) : (
            <CowsTable cows={cows} onRemove={handleRemoveCow} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}