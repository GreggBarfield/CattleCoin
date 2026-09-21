import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LotsTable } from "@/components/marketplace/LotsTable";
import { DivisionExplainer, RetainedComingSoon } from "@/components/marketplace/ProductPanels";
import { getMarketplace } from "@/lib/marketplace";
import type { Division, MarketLot } from "@/lib/marketplace";
import { cn } from "@/lib/utils";

type DivisionFilter = Division | "all";
type Availability = "available" | "all";
type Sort = "newest" | "price_low" | "tokens_left";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

// The marketplace: every lot open to investors, split by who is raising the
// money (Cow-Calf or Feeders) and how the investor is paid. Real numbers only.
export function Holdings() {
  const { slug } = useParams<{ slug: string }>();
  const resolvedSlug = slug ?? "";
  const [result, setResult] = useState<{ lots: MarketLot[] | null; error: string | null } | null>(null);

  const [division, setDivision] = useState<DivisionFilter>("all");
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<Availability>("available");
  const [verifiedFilter, setVerifiedFilter] = useState("ALL");
  const [sort, setSort] = useState<Sort>("newest");

  useEffect(() => {
    let alive = true;
    getMarketplace()
      .then((lots) => alive && setResult({ lots, error: null }))
      .catch(() => alive && setResult({ lots: null, error: "Failed to load lots." }));
    return () => {
      alive = false;
    };
  }, []);

  const loading = result === null;
  const error = result?.error ?? null;
  const all = result?.lots ?? [];

  const countOf = (d: DivisionFilter) => (d === "all" ? all.length : all.filter((l) => l.division === d).length);

  const filtered = all
    .filter((l) => division === "all" || l.division === division)
    .filter((l) => availability === "all" || l.canInvest)
    .filter((l) => verifiedFilter === "ALL" || (verifiedFilter === "VERIFIED" ? l.verified : !l.verified))
    .filter((l) => {
      const q = search.trim().toLowerCase();
      return !q || l.name.toLowerCase().includes(q) || l.breed.toLowerCase().includes(q) || l.herdId.toLowerCase().includes(q);
    });
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "price_low") return (a.pricePerToken ?? Infinity) - (b.pricePerToken ?? Infinity);
    if (sort === "tokens_left") return b.tokensRemaining - a.tokensRemaining;
    return 0; // newest first is the order the server sends
  });

  const filtersActive = search !== "" || verifiedFilter !== "ALL" || availability !== "available" || sort !== "newest";
  function clearFilters() {
    setSearch("");
    setVerifiedFilter("ALL");
    setAvailability("available");
    setSort("newest");
  }

  if (error) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-red-600">{error}</p>
        <button className="px-4 py-2 bg-slate-100 rounded text-sm" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  const tabs: { key: DivisionFilter; label: string }[] = [
    { key: "all", label: "All lots" },
    { key: "cow-calf", label: "Cow-Calf" },
    { key: "feeder", label: "Feeders" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketplace</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Lots open to investors. Pick a division to see how that kind of lot works.
          </p>
        </div>
        {!loading && (
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {all.length} lots
          </span>
        )}
      </div>

      {/* Division switch */}
      <div role="tablist" aria-label="Division" className="inline-flex rounded-lg border bg-slate-50 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={division === t.key}
            onClick={() => setDivision(t.key)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              division === t.key ? "bg-white shadow-sm text-foreground" : "text-slate-600 hover:text-foreground",
            )}
          >
            {t.label} {!loading && <span className="text-xs text-slate-500">({countOf(t.key)})</span>}
          </button>
        ))}
      </div>

      <DivisionExplainer division={division} />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Search lots..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <select
          aria-label="Availability"
          className={SELECT_CLASS}
          value={availability}
          onChange={(e) => setAvailability(e.target.value as Availability)}
        >
          <option value="available">Open to buy now</option>
          <option value="all">Include fully subscribed</option>
        </select>
        <select
          aria-label="Verified"
          className={SELECT_CLASS}
          value={verifiedFilter}
          onChange={(e) => setVerifiedFilter(e.target.value)}
        >
          <option value="ALL">Verified or not</option>
          <option value="VERIFIED">Verified only</option>
          <option value="UNVERIFIED">Not verified</option>
        </select>
        <select aria-label="Sort by" className={SELECT_CLASS} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="newest">Newest first</option>
          <option value="price_low">Price per token, low to high</option>
          <option value="tokens_left">Most tokens left</option>
        </select>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Lots */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-slate-500 space-y-2">
          <p>{all.length === 0 ? "No lots are open to investors right now." : "No lots match your filters."}</p>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <LotsTable lots={sorted} slug={resolvedSlug} />
      )}

      <RetainedComingSoon />
    </div>
  );
}
