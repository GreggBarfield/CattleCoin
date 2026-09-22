// â”€â”€ Supply Chain Stages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type Stage =
  | "RANCH"
  | "AUCTION"
  | "BACKGROUNDING"
  | "FEEDLOT"
  | "PROCESSING"
  | "DISTRIBUTION";

export const STAGES: Stage[] = [
  "RANCH",
  "AUCTION",
  "BACKGROUNDING",
  "FEEDLOT",
  "PROCESSING",
  "DISTRIBUTION",
];

// â”€â”€ Pool / Herd (ERC-20 concept) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Combines Herd + TokenPool + Ownership data for investor view

export type PoolType = "herd";

export type StageBreakdown = {
  stage: Stage;
  pct: number; // 0-100, all should sum to 100
};

export type PurchaseStatus = "available" | "sold" | "pending";

export type Pool = {
  // Routing / display identifier
  id: string;              // same as herdId, used for URL routing

  // Herd table fields
  herdId: string;          // Herd.herd_id (uuid)
  rancherId: string;       // Herd.rancher_id â†’ User.user_id
  listingPrice: number;    // Herd.listing_price (was totalCostUsd)
  purchaseStatus: PurchaseStatus; // Herd.purchase_status

  // TokenPool table fields
  poolId: string;          // TokenPool.pool_id (uuid)
  totalSupply: number;     // TokenPool.total_supply (was erc20Balance)
  contractAddress: string; // TokenPool.contract_address

  // Ownership table fields (investor-specific)
  tokenAmount: number;     // Ownership.token_amount (investor's held tokens)

  // Display / denormalized fields
  name: string;
  poolType: PoolType;
  cohortLabel?: string;
  geneticsLabel: string;   // derived from breed_code of cattle in herd
  season: "Spring" | "Fall";

  // Computed / derived fields
  backingHerdCount: number;    // COUNT of Cow rows with this herd_id
  stageBreakdown: StageBreakdown[];
  dominantStage: Stage;
  verified: boolean;           // aggregate of CowHealth.verified_flag
  lastUpdateIso: string;

  tokensSold?: number;
  tokensRemaining?: number;
  investorAllocation?: number;  // floor(totalSupply * investorPct / 100)
  investorPct?: number | null;  // % set by feedlot
  riskScore?: number | null;

  // Real ledger numbers - no projected value or profit. See
  // step-dashboard-real-numbers.md (these replaced a listing-price x 1.25 /
  // x 1.40 formula that had no connection to the real books).
  totalRaised?: number;   // GET /api/pools[/:id]: money actually raised from ALL investors so far (herd-level, public)
  costsTotal?: number;    // both routes: money actually spent on this herd so far (active costs only)
  paidIn?: number;        // GET /api/investors/:slug/holdings|portfolio: THIS investor's own money paid in so far
  estimatedExtra?: number | null; // this investor's estimated basis for tokens held with no payment on record (older demo data)
  state?: "open" | "sale_pending" | "sold" | "closed";
  sale?: { saleId: string; status: string; saleDate: string | null } | null;
  payout?: {
    amount: number;
    capitalReturned: number;
    profitShare: number | null;
    exitFee: number;
    status: "owed" | "paid";
    paidAt: string | null;
    paymentReference: string | null;
    profit: number | null;   // realized profit/loss (amount paid - what this investor put in) - only present once sold and paid out
  } | null;
};

// â”€â”€ Cow (maps to backend Cow table + joined data) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CowHealth = "On Track" | "Watch" | "Issue";

export type SexCode = "B" | "C" | "H" | "S"; // Bull, Calf, Heifer, Steer

export const SEX_LABELS: Record<SexCode, string> = {
  B: "Bull",
  C: "Calf",
  H: "Heifer",
  S: "Steer",
};

export type Cow = {
  // Backend Cow table fields
  cowId: string;                    // string of bigint cow_id (used for routing)
  herdId: string;                   // FK â†’ Herd (was poolId)
  registrationNumber: string;       // Cow.registration_number
  officialId: string;               // Cow.official_id
  animalName: string;               // Cow.animal_name
  breedCode: string;                // Cow.breed_code (was breed)
  sexCode: SexCode;                 // Cow.sex_code
  birthDate: string;                // Cow.birth_date (ISO date)
  sireRegistrationNumber: string;   // Cow.sire_registration_number
  damRegistrationNumber: string;    // Cow.dam_registration_number
  isGenomicEnhanced: boolean;       // Cow.is_genomic_enhanced
  createdAt: string;                // Cow.created_at (ISO timestamp)

  // Derived / computed from joined tables
  stage: Stage;                     // derived from herd purchase_status / lifecycle
  weightLbs: number;                // latest CowWeights.weight_lbs (was weightLb)
  health: CowHealth;                // derived from CowHealth.verified_flag
  daysInStage: number;              // computed
  costToDateUsd: number;            // computed proportional from Herd.listing_price
  totalValue: number;               // CowValuation.total_value (was projectedExitUsd)
  verified: boolean;                // CowHealth.verified_flag
};

// â”€â”€ CowWeights (backend CowWeights table) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type WeightType = "birth" | "weaning" | "yearling" | "sale";

export type CowWeight = {
  weightId: number;          // CowWeights.weight_id (bigint)
  cowId: string;             // FK â†’ Cow
  weightDate: string;        // CowWeights.weight_date (ISO date)
  weightLbs: number;         // CowWeights.weight_lbs
  weightType: WeightType;    // CowWeights.weight_type
  locationCode: string;      // CowWeights.location_code
};

// â”€â”€ CowEPDs (backend CowEPDs table â€” Expected Progeny Differences) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CowEPD = {
  cowEpdId: number;          // CowEPDs.cow_epd_id (bigint)
  cowId: string;             // FK â†’ Cow
  traitCode: string;         // CowEPDs.trait_code (WW, YW, CW, MARB, etc.)
  epdValue: number;          // CowEPDs.epd_value
  accuracy: number;          // CowEPDs.accuracy (0-1)
  percentileRank: number;    // CowEPDs.percentile_rank (0-100)
  evaluationDate: string;    // CowEPDs.evaluation_date (ISO date)
};

// â”€â”€ CowHealthRecord (backend CowHealth table) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CowHealthRecord = {
  healthRecordId: number;    // CowHealth.health_record_id (bigint)
  cowId: string;             // FK â†’ Cow
  vaccineName: string;       // CowHealth.vaccine_name
  administrationDate: string;// CowHealth.administration_date (ISO date)
  healthProgramName: string; // CowHealth.health_program_name (NHTC, IMI Global, etc.)
  certificationNumber: string; // CowHealth.certification_number
  verifiedFlag: boolean;     // CowHealth.verified_flag
};

// â”€â”€ CowValuation (backend CowValuation table) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CowValuation = {
  valuationId: number;       // CowValuation.valuation_id (bigint)
  cowId: string;             // FK â†’ Cow
  valuationDate: string;     // CowValuation.valuation_date (ISO timestamp)
  geneticsScore: number;     // CowValuation.genetics_score
  healthScore: number;       // CowValuation.health_score
  weightScore: number;       // CowValuation.weight_score
  certificationScore: number;// CowValuation.certification_score
  totalValue: number;        // CowValuation.total_value
  valuationMethodVersion: string; // CowValuation.valuation_method_version
};

// â”€â”€ Lifecycle Event â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type LifecycleEvent = {
  id: string;
  poolId?: string;
  cowId?: string;
  stage: Stage;
  verified: boolean;
  timestampIso: string;
  note: string;
};

// â”€â”€ Time Series â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type SeriesPoint = {
  dateIso: string;
  value: number;
};

// â”€â”€ Cost Breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Real logged costs by category (see step-dashboard-real-numbers.md). Used to
// be a "Budget Breakdown" with a fabricated cost/revenue split; now it's just
// the herd's real active costs, same categories as My Money / Herd operations.

export type CostItem = {
  label: string;
  amountUsd: number;
};

// â”€â”€ Document â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type Document = {
  title: string;
  type: "certificate" | "inspection" | "transfer" | "grade" | "insurance" | "other";
  url: string;
};

// â”€â”€ Cow Detail (aggregate API response for single cow) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CowDetailData = {
  cow: Cow;
  weights: CowWeight[];
  epds: CowEPD[];
  healthRecords: CowHealthRecord[];
  valuations: CowValuation[];
};

// â”€â”€ Pool Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type PoolDetail = {
  pool: Pool;
  lifecycle: LifecycleEvent[];
  costBreakdown: CostItem[];
  documents: Document[];
};

// â”€â”€ Portfolio Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Real money totals across everything this investor holds or has held - no
// projected value, no 30-day change, no fabricated chart. See
// step-dashboard-real-numbers.md.

export type PortfolioTotals = {
  paidIn: number;
  estimatedExtra: number;
  stillInvested: number;
  receivedFromSales: number;
  owedFromSales: number;
};

export type PortfolioSummary = {
  asOfIso: string;
  totals: PortfolioTotals;
  poolsHeld: number;
  avgRisk: number | null; // 0-100, null if none of the held herds have a risk score
  recentEvents: LifecycleEvent[];
  topPools: Pool[];
};

// â”€â”€ Invest Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type HerdInvestInfo = {
  herdId: string;
  herdName: string;
  purchaseStatus: PurchaseStatus;
  listingPrice: number;
  dominantStage: Stage;
  breedCode: string;
  riskScore: number | null;
  totalSupply: number;
  investorAllocation: number;   // tokens available to investors (= floor(totalSupply * investorPct/100))
  investorPct: number | null;   // % of herd the feedlot made available
  tokensSold: number;
  tokensAvailable: number;
  pricePerToken: number;
  contractAddress: string;
  isAvailable: boolean;
};

export type InvestPayload = {
  herdId: string;
  investorSlug: string;
  tokensToBuy: number;
  walletAddress?: string;
  fullName?: string;
  email?: string;
};

export type InvestResult = {
  success: boolean;
  message: string;
  tokensRemaining: number;
  newStatus: string;
};

// â”€â”€ Feedlot Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type FeedlotStatus = "pending" | "listed" | "sold";

/** A herd as seen by the feedlot â€” either pending (available to claim) or already claimed */
export type FeedlotHerd = {
  herdId:        string;
  herdName:      string;
  rancherId:     string;
  listingPrice:  number;
  headCount:     number;
  breedCode:     string;
  geneticsLabel: string;
  dominantStage: Stage;
  season:        string;
  verified:      boolean;
  riskScore:     number | null;
  feedlotStatus: FeedlotStatus;
  investorPct:   number | null;   // % of herd available to investors (set when claimed)
  createdAt:     string | null;

  // Only present for claimed herds (dashboard view)
  totalSupply?:             number;
  investorAllocation?:      number; // tokens available to investors = floor(totalSupply * investorPct/100)
  investorTokensSold?:      number;
  investorTokensRemaining?: number;
};

export type FeedlotDashboard = {
  feedlotSlug:   string;
  claimedHerds:  FeedlotHerd[];
};

export type FeedlotClaimPayload = {
  feedlotSlug: string;
  herdId:      string;
  investorPct: number;
};

export type FeedlotClaimResult = {
  success:       boolean;
  message:       string;
  herdId:        string;
  herdName:      string;
  feedlotStatus: FeedlotStatus;
  investorPct:   number;
};