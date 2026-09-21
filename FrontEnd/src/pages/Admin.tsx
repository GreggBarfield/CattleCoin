import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  BellRing,
  Building2,
  CircleDollarSign,
  Calculator,
  FileText,
  Info,
  type LucideIcon,
  RefreshCw,
  Save,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AdminStats = {
  label: string;
  value: string;
  detail: string;
};

type ContractDraft = {
  marketplaceAddress: string;
  treasuryAddress: string;
  settlementWindowHours: string;
  mintCooldownMinutes: string;
};

type PricingDraft = {
  livePricePerPound: string;
  priceFloor: string;
  priceCeiling: string;
  premiumMode: string;
};

type ValuationDraft = {
  stageBasePriceFormula: string;
  gradePremiumFormula: string;
  qualityFormula: string;
  sustainabilityFormula: string;
  listingDiscount: string;
  formulaPreview: string;
};

type EnvDraft = {
  rpcUrl: string;
  indexerUrl: string;
  authDomain: string;
  payoutWallet: string;
};

type OperationsDraft = {
  emergencyPause: boolean;
  requireManualReview: boolean;
  autoPublishLots: boolean;
  notificationsEmail: string;
};

type ManagedActor = {
  id: string;
  name: string;
  role: "Rancher" | "Investor";
  status: "Active" | "Paused" | "Removed";
  activity: string;
  note: string;
};

const ADMIN_STATS: AdminStats[] = [
  {
    label: "Contracts live",
    value: "4",
    detail: "Marketplace, escrow, payout, registry",
  },
  {
    label: "Valuation rules",
    value: "5",
    detail: "Base price, 3 multipliers, and listing discount",
  },
  {
    label: "Protected variables",
    value: "12",
    detail: "Operational values reviewed before release",
  },
  {
    label: "Pending changes",
    value: "3",
    detail: "Local-only edits not yet pushed anywhere",
  },
];

const STATUS_ITEMS = [
  {
    title: "Marketplace contract",
    value: "0x8FA2...B19C",
    status: "Healthy",
  },
  {
    title: "Treasury settlement",
    value: "22 hour settlement window",
    status: "Watching",
  },
  {
    title: "Oracle pricing rule",
    value: "Weighted cash market feed",
    status: "Healthy",
  },
];

const INITIAL_ACTORS: ManagedActor[] = [
  {
    id: "acct-r001",
    name: "Double Creek Ranch",
    role: "Rancher",
    status: "Active",
    activity: "Uploading health and weight updates",
    note: "Compliant submissions in the last 7 days",
  },
  {
    id: "acct-i204",
    name: "Lone Star Growth Fund",
    role: "Investor",
    status: "Paused",
    activity: "Submitting high-frequency lot bids",
    note: "Paused pending admin review",
  },
  {
    id: "acct-r118",
    name: "Prairie Ridge Beef Co.",
    role: "Rancher",
    status: "Active",
    activity: "Publishing new lot inventory",
    note: "Awaiting valuation formula update",
  },
];

function SectionLabel({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function FieldShell({
  label,
  hint,
  description,
  children,
}: {
  label: string;
  hint: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {description ? (
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground"
              title={description}
              aria-label={description}
            >
              <Info className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </label>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-start justify-between gap-4 rounded-xl border p-4 text-left transition-colors",
        checked
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-background hover:bg-accent/40"
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div
        className={cn(
          "relative mt-1 h-6 w-11 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5"
          )}
        />
      </div>
    </button>
  );
}

export function Admin() {
  const [contractDraft, setContractDraft] = useState<ContractDraft>({
    marketplaceAddress: "0x8FA2f9041aC89E61A12B88B3A1F6b4D9912cB19C",
    treasuryAddress: "0x4D32bA13d3B62d7bA8F4F0f28A89C902C8Aee221",
    settlementWindowHours: "22",
    mintCooldownMinutes: "45",
  });
  const [pricingDraft, setPricingDraft] = useState<PricingDraft>({
    livePricePerPound: "1.92",
    priceFloor: "1.70",
    priceCeiling: "2.15",
    premiumMode: "balanced",
  });
  const [valuationDraft, setValuationDraft] = useState<ValuationDraft>({
    stageBasePriceFormula:
      "Stage Base Price = real USDA / Texas auction price for that weight class (for example, 550 lb steers at $/cwt)",
    gradePremiumFormula:
      "GP(G) = 1 + 0.10 x (G - 50) / 50, clipped at 0.95-1.10",
    qualityFormula:
      "QM(H,C) = 0.95 + 0.20 x H/100 + 0.10 x C/100, clipped at 0.90-1.25",
    sustainabilityFormula:
      "SM(S) = 0.92 + 0.20 x S/100, clipped at 0.92-1.12",
    listingDiscount: "0.90",
    formulaPreview:
      "fairValue = Stage Base Price x Grade Premium(G) x Quality(H,C) x Sustainability(S); listingPrice = fairValue x 0.90",
  });
  const [envDraft, setEnvDraft] = useState<EnvDraft>({
    rpcUrl: "https://rpc.cattlecoin.internal",
    indexerUrl: "https://indexer.cattlecoin.internal",
    authDomain: "admin.cattlecoin.local",
    payoutWallet: "ops-payout-hot-wallet",
  });
  const [operationsDraft, setOperationsDraft] = useState<OperationsDraft>({
    emergencyPause: false,
    requireManualReview: true,
    autoPublishLots: false,
    notificationsEmail: "ops@cattlecoin.local",
  });
  const [managedActors, setManagedActors] = useState<ManagedActor[]>(INITIAL_ACTORS);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityRoleFilter, setActivityRoleFilter] = useState<
    "all" | ManagedActor["role"]
  >("all");

  const filteredActors = managedActors.filter((actor) => {
    const matchesRole =
      activityRoleFilter === "all" || actor.role === activityRoleFilter;
    const searchValue = activitySearch.trim().toLowerCase();
    const matchesSearch =
      searchValue.length === 0 ||
      actor.name.toLowerCase().includes(searchValue) ||
      actor.id.toLowerCase().includes(searchValue) ||
      actor.activity.toLowerCase().includes(searchValue) ||
      actor.note.toLowerCase().includes(searchValue);

    return matchesRole && matchesSearch;
  });

  function updateActorStatus(id: string, status: ManagedActor["status"]) {
    setManagedActors((current) =>
      current.map((actor) =>
        actor.id === id
          ? {
              ...actor,
              status,
              note:
                status === "Removed"
                  ? "Removed from platform activity by administrator"
                  : status === "Paused"
                    ? "Activity paused by administrator pending review"
                    : "Re-enabled for normal platform activity",
            }
          : actor
      )
    );
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(41,37,36,0.96)_55%,rgba(120,53,15,0.92))] px-6 py-8 text-primary-foreground shadow-sm">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_55%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-white/80">
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin Control Center
            </div>
            <div className="space-y-2">
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
                Manage contracts, cattle pricing, and protected environment values.
              </h2>
              <p className="max-w-2xl text-sm text-white/75">
                This screen is intentionally frontend-only. It behaves like the
                site administrator workspace without sending changes to the backend.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button className="bg-white text-slate-950 hover:bg-white/90">
                <Save className="h-4 w-4" />
                Save Draft
              </Button>
              <Button
                variant="outline"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              >
                <RefreshCw className="h-4 w-4" />
                Simulate Refresh
              </Button>
              <Button asChild className="bg-amber-400 text-slate-950 hover:bg-amber-300">
                <Link to="/admin/fees">Fee setup</Link>
              </Button>
              <Button asChild className="bg-emerald-400 text-slate-950 hover:bg-emerald-300">
                <Link to="/admin/herd-ops">Herd operations</Link>
              </Button>
            </div>
          </div>

          <Card className="border-white/10 bg-white/10 text-white shadow-none backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Release snapshot</CardTitle>
              <CardDescription className="text-white/70">
                Current draft status before an eventual backend integration.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {STATUS_ITEMS.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/10 bg-black/10 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{item.title}</p>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/80">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-white/75">{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ADMIN_STATS.map((stat) => (
          <Card key={stat.label} className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{stat.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="space-y-6">
          <Card className="rounded-3xl">
            <CardHeader>
              <SectionLabel
                icon={FileText}
                title="Contract Settings"
                description="Core contract addresses and timing rules used by the platform."
              />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FieldShell
                label="Marketplace contract"
                hint="Primary registry"
                description="The main smart contract address that manages marketplace listings and contract-level interactions."
              >
                <Input
                  value={contractDraft.marketplaceAddress}
                  onChange={(event) =>
                    setContractDraft((current) => ({
                      ...current,
                      marketplaceAddress: event.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell
                label="Treasury contract"
                hint="Settlement wallet"
                description="The contract or wallet address that receives and routes settlement funds for the platform."
              >
                <Input
                  value={contractDraft.treasuryAddress}
                  onChange={(event) =>
                    setContractDraft((current) => ({
                      ...current,
                      treasuryAddress: event.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell
                label="Settlement window"
                hint="Hours"
                description="How long the platform allows for settlement to complete before the transaction is treated as overdue."
              >
                <Input
                  type="number"
                  value={contractDraft.settlementWindowHours}
                  onChange={(event) =>
                    setContractDraft((current) => ({
                      ...current,
                      settlementWindowHours: event.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell
                label="Mint cooldown"
                hint="Minutes"
                description="The minimum wait time between minting actions to prevent rapid repeated token creation."
              >
                <Input
                  type="number"
                  value={contractDraft.mintCooldownMinutes}
                  onChange={(event) =>
                    setContractDraft((current) => ({
                      ...current,
                      mintCooldownMinutes: event.target.value,
                    }))
                  }
                />
              </FieldShell>
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <SectionLabel
                icon={CircleDollarSign}
                title="Cattle Price Controls"
                description="Adjust pricing assumptions, floor protection, and premium behavior."
              />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FieldShell label="Live cattle price" hint="USD / lb">
                <Input
                  type="number"
                  step="0.01"
                  value={pricingDraft.livePricePerPound}
                  onChange={(event) =>
                    setPricingDraft((current) => ({
                      ...current,
                      livePricePerPound: event.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell label="Pricing mode" hint="Premium schedule">
                <Select
                  value={pricingDraft.premiumMode}
                  onValueChange={(value) =>
                    setPricingDraft((current) => ({
                      ...current,
                      premiumMode: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservative</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="aggressive">Aggressive</SelectItem>
                  </SelectContent>
                </Select>
              </FieldShell>
              <FieldShell label="Price floor" hint="Minimum USD / lb">
                <Input
                  type="number"
                  step="0.01"
                  value={pricingDraft.priceFloor}
                  onChange={(event) =>
                    setPricingDraft((current) => ({
                      ...current,
                      priceFloor: event.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell label="Price ceiling" hint="Maximum USD / lb">
                <Input
                  type="number"
                  step="0.01"
                  value={pricingDraft.priceCeiling}
                  onChange={(event) =>
                    setPricingDraft((current) => ({
                      ...current,
                      priceCeiling: event.target.value,
                    }))
                  }
                />
              </FieldShell>
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <SectionLabel
                icon={Calculator}
                title="Valuation Formula"
                description="Edit the multipliers and displayed formula used by the admin valuation workflow."
              />
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="Stage base price" hint="USDA/Texas market anchor">
                  <Input
                    value={valuationDraft.stageBasePriceFormula}
                    onChange={(event) =>
                      setValuationDraft((current) => ({
                        ...current,
                        stageBasePriceFormula: event.target.value,
                      }))
                    }
                  />
                </FieldShell>
                <FieldShell label="Grade Premium(G)" hint="Genetics multiplier">
                  <Input
                    value={valuationDraft.gradePremiumFormula}
                    onChange={(event) =>
                      setValuationDraft((current) => ({
                        ...current,
                        gradePremiumFormula: event.target.value,
                      }))
                    }
                  />
                </FieldShell>
                <FieldShell label="Quality(H,C)" hint="Health + certifications">
                  <Input
                    value={valuationDraft.qualityFormula}
                    onChange={(event) =>
                      setValuationDraft((current) => ({
                        ...current,
                        qualityFormula: event.target.value,
                      }))
                    }
                  />
                </FieldShell>
                <FieldShell label="Sustainability(S)" hint="Green uplift multiplier">
                  <Input
                    value={valuationDraft.sustainabilityFormula}
                    onChange={(event) =>
                      setValuationDraft((current) => ({
                        ...current,
                        sustainabilityFormula: event.target.value,
                      }))
                    }
                  />
                </FieldShell>
              </div>

              <FieldShell label="Listing discount multiplier" hint="Investor discount from val.html">
                <Input
                  value={valuationDraft.listingDiscount}
                  onChange={(event) =>
                    setValuationDraft((current) => ({
                      ...current,
                      listingDiscount: event.target.value,
                    }))
                  }
                />
              </FieldShell>

              <FieldShell label="Formula preview" hint="Displayed to admins only">
                <textarea
                  className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={valuationDraft.formulaPreview}
                  onChange={(event) =>
                    setValuationDraft((current) => ({
                      ...current,
                      formulaPreview: event.target.value,
                    }))
                  }
                />
              </FieldShell>

              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Current admin formula from val.html
                </p>
                <p className="mt-2 font-mono text-sm text-foreground">
                  {valuationDraft.formulaPreview}
                </p>
                <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Stage Base Price:</span>{" "}
                    {valuationDraft.stageBasePriceFormula}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Grade Premium(G):</span>{" "}
                    {valuationDraft.gradePremiumFormula}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Quality(H,C):</span>{" "}
                    {valuationDraft.qualityFormula}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Sustainability(S):</span>{" "}
                    {valuationDraft.sustainabilityFormula}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Listing discount:</span>{" "}
                    x {valuationDraft.listingDiscount}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="rounded-3xl">
            <CardHeader>
              <SectionLabel
                icon={Building2}
                title="Environment Variables"
                description="Frontend placeholders for internal endpoints and operational values."
              />
            </CardHeader>
            <CardContent className="grid gap-4">
              <FieldShell
                label="RPC endpoint"
                hint="Chain access"
                description="The blockchain node endpoint the app would use to submit requests and read live chain state."
              >
                <Input
                  value={envDraft.rpcUrl}
                  onChange={(event) =>
                    setEnvDraft((current) => ({
                      ...current,
                      rpcUrl: event.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell
                label="Indexer endpoint"
                hint="Analytics feed"
                description="A read-optimized service for querying indexed transaction and asset data more efficiently than raw RPC."
              >
                <Input
                  value={envDraft.indexerUrl}
                  onChange={(event) =>
                    setEnvDraft((current) => ({
                      ...current,
                      indexerUrl: event.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell
                label="Auth domain"
                hint="Admin access"
                description="The trusted domain or hostname used for administrator authentication and session validation."
              >
                <Input
                  value={envDraft.authDomain}
                  onChange={(event) =>
                    setEnvDraft((current) => ({
                      ...current,
                      authDomain: event.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell
                label="Payout wallet alias"
                hint="Treasury routing"
                description="A human-readable internal label for the wallet used to route investor or treasury payouts."
              >
                <Input
                  value={envDraft.payoutWallet}
                  onChange={(event) =>
                    setEnvDraft((current) => ({
                      ...current,
                      payoutWallet: event.target.value,
                    }))
                  }
                />
              </FieldShell>
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <SectionLabel
                icon={BellRing}
                title="Operations"
                description="Manual approval gates and sitewide publishing controls."
              />
            </CardHeader>
            <CardContent className="grid gap-3">
              <ToggleRow
                checked={operationsDraft.emergencyPause}
                onChange={(next) =>
                  setOperationsDraft((current) => ({
                    ...current,
                    emergencyPause: next,
                  }))
                }
                title="Emergency pause"
                description="Freeze admin-triggered changes and hold new release actions."
              />
              <ToggleRow
                checked={operationsDraft.requireManualReview}
                onChange={(next) =>
                  setOperationsDraft((current) => ({
                    ...current,
                    requireManualReview: next,
                  }))
                }
                title="Require manual review"
                description="Keep sensitive pricing and contract drafts in a human approval step."
              />
              <ToggleRow
                checked={operationsDraft.autoPublishLots}
                onChange={(next) =>
                  setOperationsDraft((current) => ({
                    ...current,
                    autoPublishLots: next,
                  }))
                }
                title="Auto-publish approved lots"
                description="Automatically expose ready inventory once internal checks pass."
              />
              <FieldShell label="Notifications email" hint="Alerts and approvals">
                <Input
                  type="email"
                  value={operationsDraft.notificationsEmail}
                  onChange={(event) =>
                    setOperationsDraft((current) => ({
                      ...current,
                      notificationsEmail: event.target.value,
                    }))
                  }
                />
              </FieldShell>
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <SectionLabel
                icon={UserCog}
                title="User Activity Controls"
                description="Pause or remove rancher and investor activity directly from the admin workspace."
              />
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-[1.4fr_0.8fr]">
                <FieldShell label="Search activity" hint="Name, ID, or notes">
                  <Input
                    value={activitySearch}
                    onChange={(event) => setActivitySearch(event.target.value)}
                    placeholder="Search rancher or investor activity"
                  />
                </FieldShell>
                <FieldShell label="User type" hint="Filter by role">
                  <Select
                    value={activityRoleFilter}
                    onValueChange={(value: "all" | ManagedActor["role"]) =>
                      setActivityRoleFilter(value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a user type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All users</SelectItem>
                      <SelectItem value="Rancher">Ranchers</SelectItem>
                      <SelectItem value="Investor">Investors</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldShell>
              </div>

              {filteredActors.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
                  <p className="text-sm font-medium">No matching accounts found.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a different search term or switch the role filter.
                  </p>
                </div>
              ) : null}

              {filteredActors.map((actor) => (
                <div
                  key={actor.id}
                  className="rounded-2xl border border-border bg-background p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="space-y-2">
                        <p className="text-sm font-semibold">{actor.name}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            className={cn(
                              actor.role === "Rancher"
                                ? "border-transparent bg-amber-100 text-amber-900"
                                : "border-transparent bg-sky-100 text-sky-900"
                            )}
                          >
                            {actor.role}
                          </Badge>
                          <Badge
                            variant={
                              actor.status === "Removed"
                                ? "destructive"
                                : actor.status === "Paused"
                                  ? "outline"
                                  : "default"
                            }
                          >
                            {actor.status}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{actor.activity}</p>
                      <p className="text-xs text-muted-foreground">{actor.note}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateActorStatus(actor.id, "Paused")}
                        disabled={actor.status === "Removed"}
                      >
                        Pause Activity
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => updateActorStatus(actor.id, "Active")}
                        disabled={actor.status === "Removed"}
                      >
                        Restore
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => updateActorStatus(actor.id, "Removed")}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

export default Admin;
