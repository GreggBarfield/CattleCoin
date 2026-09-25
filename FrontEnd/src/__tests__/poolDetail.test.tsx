import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PoolDetail } from "@/pages/PoolDetail";
import type { PoolDetail as PoolDetailType, Pool, Cow } from "@/lib/types";

// Fix #17: two investor-facing bugs on the herd detail page.
// I4 - a non-functional "Add Cattle" button (no onClick handler at all).
// I5 - a hardcoded "Documents" card with 3 fake href="#" links that went
// nowhere. The backend now sends an empty documents array, and the page's
// existing `documents.length > 0` guard hides the card entirely.

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getPoolById: vi.fn(),
    getPoolCows: vi.fn(),
    getInvestorHoldings: vi.fn(),
  };
});

import { getPoolById, getPoolCows, getInvestorHoldings } from "@/lib/api";

const pool: Pool = {
  id: "795c41d1-9fa7-4018-8567-47e923344d17",
  herdId: "795c41d1-9fa7-4018-8567-47e923344d17",
  rancherId: "r1",
  listingPrice: 175723.59,
  purchaseStatus: "available",
  poolId: "p1",
  totalSupply: 50000,
  contractAddress: "",
  tokenAmount: 0,
  name: "Angus Finishing D",
  poolType: "herd",
  geneticsLabel: "Angus",
  season: "Fall",
  backingHerdCount: 1,
  stageBreakdown: [],
  dominantStage: "FEEDLOT",
  verified: true,
  lastUpdateIso: "2026-09-01T00:00:00.000Z",
  tokensSold: 21500,
  tokensRemaining: 21000,
  investorAllocation: 42500,
  investorPct: 85,
  riskScore: 35,
  totalRaised: 75432,
  costsTotal: 12000,
};

const poolDetail: PoolDetailType = {
  pool,
  lifecycle: [],
  costBreakdown: [],
  documents: [],
};

const cow: Cow = {
  cowId: "1001",
  herdId: pool.herdId,
  registrationNumber: "REG-1001",
  officialId: "",
  animalName: "Animal 1001",
  breedCode: "AN",
  sexCode: "S",
  birthDate: "2024-01-01",
  sireRegistrationNumber: "",
  damRegistrationNumber: "",
  isGenomicEnhanced: false,
  createdAt: "2024-06-01T00:00:00.000Z",
  stage: "FEEDLOT",
  weightLbs: 850,
  health: "On Track",
  daysInStage: 14,
  costToDateUsd: 1234,
  totalValue: 2468,
  verified: true,
};

function renderPoolDetail() {
  return render(
    <MemoryRouter initialEntries={[`/investor/investor10/holdings/${pool.herdId}`]}>
      <Routes>
        <Route path="/investor/:slug/holdings/:id" element={<PoolDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PoolDetail investor view (fix #17)", () => {
  test("does not render the non-functional Add Cattle button (I4)", async () => {
    vi.mocked(getPoolById).mockResolvedValue(poolDetail);
    vi.mocked(getPoolCows).mockResolvedValue([cow]);
    vi.mocked(getInvestorHoldings).mockResolvedValue([]);
    renderPoolDetail();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Angus Finishing D" })).toBeTruthy(),
    );
    expect(screen.queryByText("Add Cattle")).toBeNull();
  });

  test("hides the Documents card when there are no real documents (I5)", async () => {
    vi.mocked(getPoolById).mockResolvedValue(poolDetail);
    vi.mocked(getPoolCows).mockResolvedValue([cow]);
    vi.mocked(getInvestorHoldings).mockResolvedValue([]);
    renderPoolDetail();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Angus Finishing D" })).toBeTruthy(),
    );
    expect(screen.queryByText("Documents")).toBeNull();
    expect(screen.queryByText("Certificate of Origin")).toBeNull();
  });
});
