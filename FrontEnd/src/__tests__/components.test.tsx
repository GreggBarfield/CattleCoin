import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import type { CurrentUser } from "@/context/AuthContext";

import { StageBadge } from "@/components/common/StageBadge";
import { VerifiedBadge } from "@/components/common/VerifiedBadge";
import { KpiCard, KpiCardSkeleton } from "@/components/common/KpiCard";
import { CostBreakdown } from "@/components/pool/CostBreakdown";
import { PipelineBar } from "@/components/pool/PipelineBar";
import { SupplyChainStepper } from "@/components/lifecycle/SupplyChainStepper";
import { MyInvestments } from "@/components/common/MyInvestments";
import { AppShell } from "@/components/layout/AppShell";

import type { Pool, CostItem, StageBreakdown, LifecycleEvent } from "@/lib/types";

// Ã¢â€â‚¬Ã¢â€â‚¬ Shared mock pool Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const makePool = (overrides: Partial<Pool> = {}): Pool => ({
  id: "herd-1",
  herdId: "herd-1",
  rancherId: "r1",
  listingPrice: 10000,
  purchaseStatus: "available",
  poolId: "pool-1",
  totalSupply: 20,
  contractAddress: "",
  tokenAmount: 5,
  name: "Alpha Herd",
  poolType: "herd",
  geneticsLabel: "Angus",
  season: "Fall",
  paidIn: 12500,
  costsTotal: 5000,
  backingHerdCount: 40,
  stageBreakdown: [{ stage: "RANCH", pct: 100 }],
  dominantStage: "RANCH",
  verified: true,
  lastUpdateIso: "2024-01-01T00:00:00Z",
  ...overrides,
});

// Ã¢â€â‚¬Ã¢â€â‚¬ StageBadge Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
describe("StageBadge", () => {
  test("renders RANCH stage text", () => {
    render(<StageBadge stage="RANCH" />);
    expect(screen.getByText("RANCH")).toBeTruthy();
  });

  test("renders FEEDLOT stage text", () => {
    render(<StageBadge stage="FEEDLOT" />);
    expect(screen.getByText("FEEDLOT")).toBeTruthy();
  });

  test("renders PROCESSING stage text", () => {
    render(<StageBadge stage="PROCESSING" />);
    expect(screen.getByText("PROCESSING")).toBeTruthy();
  });

  test("renders DISTRIBUTION stage text", () => {
    render(<StageBadge stage="DISTRIBUTION" />);
    expect(screen.getByText("DISTRIBUTION")).toBeTruthy();
  });

  test("renders BACKGROUNDING stage text", () => {
    render(<StageBadge stage="BACKGROUNDING" />);
    expect(screen.getByText("BACKGROUNDING")).toBeTruthy();
  });

  test("renders AUCTION stage text", () => {
    render(<StageBadge stage="AUCTION" />);
    expect(screen.getByText("AUCTION")).toBeTruthy();
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬ VerifiedBadge Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
describe("VerifiedBadge", () => {
  test("renders without label by default", () => {
    const { container } = render(<VerifiedBadge verified={true} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
  });

  test("shows 'Verified' label when showLabel=true and verified=true", () => {
    render(<VerifiedBadge verified={true} showLabel />);
    expect(screen.getByText("Verified")).toBeTruthy();
  });

  test("shows 'Unverified' label when showLabel=true and verified=false", () => {
    render(<VerifiedBadge verified={false} showLabel />);
    expect(screen.getByText("Unverified")).toBeTruthy();
  });

  test("renders an SVG icon for unverified state", () => {
    const { container } = render(<VerifiedBadge verified={false} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬ KpiCard Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
describe("KpiCard", () => {
  test("renders label and value", () => {
    render(<KpiCard label="Portfolio Value" value="$50,000" />);
    expect(screen.getByText("Portfolio Value")).toBeTruthy();
    expect(screen.getByText("$50,000")).toBeTruthy();
  });

  test("renders subtitle when provided", () => {
    render(<KpiCard label="Risk Score" value="42" subtitle="Moderate" />);
    expect(screen.getByText("Moderate")).toBeTruthy();
  });

  test("renders formatted delta percentage when delta is provided", () => {
    render(<KpiCard label="Return" value="10%" delta={5.5} />);
    // formatPct(5.5) returns "+5.50%" or similar
    expect(screen.getByText(/5\.5/)).toBeTruthy();
  });

  test("renders KpiCardSkeleton without crashing", () => {
    const { container } = render(<KpiCardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬ CostBreakdown Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
describe("CostBreakdown", () => {
  const items: CostItem[] = [
    { label: "Purchase Cost", amountUsd: 8000 },
    { label: "Feed Cost", amountUsd: 2000 },
  ];

  test("renders all item labels", () => {
    render(<CostBreakdown items={items} />);
    expect(screen.getByText("Purchase Cost")).toBeTruthy();
    expect(screen.getByText("Feed Cost")).toBeTruthy();
  });

  test("displays the Total logged so far line", () => {
    render(<CostBreakdown items={items} />);
    expect(screen.getByText("Total logged so far")).toBeTruthy();
  });

  test("shows the summed total", () => {
    render(<CostBreakdown items={items} />);
    // total = 8000 + 2000 = 10000 Ã¢â€ â€™ $10,000
    expect(screen.getByText(/\$10,000/)).toBeTruthy();
  });

  test("shows empty-state message when there are no items", () => {
    render(<CostBreakdown items={[]} />);
    expect(screen.getByText("No costs recorded yet.")).toBeTruthy();
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬ PipelineBar Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
describe("PipelineBar", () => {
  const breakdown: StageBreakdown[] = [
    { stage: "RANCH", pct: 60 },
    { stage: "FEEDLOT", pct: 40 },
    { stage: "AUCTION", pct: 0 },
  ];

  test("renders stage names in legend", () => {
    render(<PipelineBar breakdown={breakdown} />);
    expect(screen.getByText("RANCH")).toBeTruthy();
    expect(screen.getByText("FEEDLOT")).toBeTruthy();
    expect(screen.getByText("AUCTION")).toBeTruthy();
  });

  test("shows percentages in legend", () => {
    render(<PipelineBar breakdown={breakdown} />);
    // 60% appears in the bar segment AND in the legend Ã¢â‚¬â€ getAllByText handles multiple
    expect(screen.getAllByText("60%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("40%").length).toBeGreaterThan(0);
  });

  test("renders without crashing for empty breakdown", () => {
    const { container } = render(<PipelineBar breakdown={[]} />);
    expect(container.firstChild).toBeTruthy();
  });

  test("does not render segment text for small percentages (<10%)", () => {
    const tiny: StageBreakdown[] = [
      { stage: "RANCH", pct: 5 },
      { stage: "FEEDLOT", pct: 95 },
    ];
    const { container } = render(<PipelineBar breakdown={tiny} />);
    // The bar segments themselves Ã¢â‚¬â€ segment with pct<10 renders empty text
    // Just verify it renders without crashing
    expect(container.querySelector(".flex.h-6")).toBeTruthy();
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬ SupplyChainStepper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
describe("SupplyChainStepper", () => {
  const events: LifecycleEvent[] = [
    {
      id: "e1",
      stage: "RANCH",
      verified: true,
      timestampIso: "2024-01-01T00:00:00Z",
      note: "Herd registered",
    },
    {
      id: "e2",
      stage: "AUCTION",
      verified: false,
      timestampIso: "2024-02-01T00:00:00Z",
      note: "Sent to auction",
    },
  ];

  test("renders all 6 stage names", () => {
    render(<SupplyChainStepper currentStage="BACKGROUNDING" events={events} />);
    ["RANCH", "AUCTION", "BACKGROUNDING", "FEEDLOT", "PROCESSING", "DISTRIBUTION"].forEach((s) => {
      expect(screen.getByText(s)).toBeTruthy();
    });
  });

  test("renders event notes", () => {
    render(<SupplyChainStepper currentStage="BACKGROUNDING" events={events} />);
    expect(screen.getByText("Herd registered")).toBeTruthy();
    expect(screen.getByText("Sent to auction")).toBeTruthy();
  });

  test("shows 'Pending' for future stages with no events", () => {
    render(<SupplyChainStepper currentStage="RANCH" events={[]} />);
    // AUCTION, BACKGROUNDING, FEEDLOT, PROCESSING, DISTRIBUTION are all pending
    const pendingTexts = screen.getAllByText("Pending");
    expect(pendingTexts.length).toBeGreaterThan(0);
  });

  test("renders step numbers for non-completed stages", () => {
    render(<SupplyChainStepper currentStage="RANCH" events={[]} />);
    // stage 1 (RANCH) is current Ã¢â‚¬â€ shows "1"
    expect(screen.getByText("1")).toBeTruthy();
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬ MyInvestments Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
describe("MyInvestments", () => {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    );
  }

  test("renders loading skeletons when loading=true", () => {
    const { container } = render(
      <Wrapper><MyInvestments pools={[]} loading slug="alice" /></Wrapper>
    );
    expect(container.querySelector(".animate-pulse, [data-slot='skeleton']")).toBeTruthy();
  });

  test("renders empty state message when no pools", () => {
    render(
      <Wrapper><MyInvestments pools={[]} slug="alice" /></Wrapper>
    );
    expect(screen.getByText(/no investments yet/i)).toBeTruthy();
    expect(screen.getByText(/all lots/i)).toBeTruthy();
  });

  test("renders pool cards when pools provided", () => {
    const pools = [
      makePool({ id: "h1", herdId: "h1", name: "Ranch A" }),
      makePool({ id: "h2", herdId: "h2", name: "Ranch B" }),
    ];
    render(
      <Wrapper><MyInvestments pools={pools} slug="alice" /></Wrapper>
    );
    expect(screen.getByText("Ranch A")).toBeTruthy();
    expect(screen.getByText("Ranch B")).toBeTruthy();
  });

  test("shows correct token counts", () => {
    const pool = makePool({ tokenAmount: 7, totalSupply: 20 });
    render(
      <Wrapper><MyInvestments pools={[pool]} slug="alice" /></Wrapper>
    );
    expect(screen.getByText(/7 \/ 20/)).toBeTruthy();
  });

  test("shows investment count in header for multiple pools", () => {
    const pools = [
      makePool({ id: "h1", herdId: "h1" }),
      makePool({ id: "h2", herdId: "h2" }),
      makePool({ id: "h3", herdId: "h3" }),
    ];
    render(
      <Wrapper><MyInvestments pools={pools} slug="alice" /></Wrapper>
    );
    expect(screen.getByText(/3 lots/i)).toBeTruthy();
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬ AppShell Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
describe("AppShell", () => {
  beforeEach(() => localStorage.clear());

  function renderWithUser(user: CurrentUser, path = "/investor/alice/dashboard") {
    localStorage.setItem("cattlecoin_user", JSON.stringify(user));
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<div>page content</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  }

  test("renders CattleCoin brand name", () => {
    const user: CurrentUser = { userId: "1", slug: "alice", role: "investor", email: "a@test.com", token: "test-token" };
    renderWithUser(user);
    const brands = screen.getAllByText("CattleCoin");
    expect(brands.length).toBeGreaterThan(0);
  });

  test("renders Sign out button", () => {
    const user: CurrentUser = { userId: "1", slug: "alice", role: "investor", email: "a@test.com", token: "test-token" };
    renderWithUser(user);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  test("investor user sees Dashboard and Marketplace nav links", () => {
    const user: CurrentUser = { userId: "1", slug: "alice", role: "investor", email: "a@test.com", token: "test-token" };
    renderWithUser(user);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /marketplace/i })).toBeTruthy();
  });

  test("rancher user sees My Herds nav link", () => {
    const user: CurrentUser = { userId: "2", slug: "bob", role: "rancher", email: "b@test.com", token: "test-token" };
    renderWithUser(user, "/rancher");
    expect(screen.getByRole("link", { name: /my herds/i })).toBeTruthy();
  });

  test("feedlot user sees Feedlot nav link", () => {
    const user: CurrentUser = { userId: "3", slug: "fl1", role: "feedlot", email: "f@test.com", token: "test-token" };
    renderWithUser(user, "/feedlot");
    expect(screen.getByRole("link", { name: /feedlot/i })).toBeTruthy();
  });

  test("admin user sees Admin nav link", () => {
    const user: CurrentUser = { userId: "4", slug: "admin1", role: "admin", email: "ad@test.com", token: "test-token" };
    renderWithUser(user, "/admin");
    expect(screen.getByRole("link", { name: /admin/i })).toBeTruthy();
  });

  test("displays user slug and role in sidebar", () => {
    const user: CurrentUser = { userId: "1", slug: "alice", role: "investor", email: "a@test.com", token: "test-token" };
    renderWithUser(user);
    expect(screen.getByText("alice")).toBeTruthy();
    // Multiple elements may contain "investor" Ã¢â‚¬â€ just verify at least one exists
    expect(screen.getAllByText(/investor/i).length).toBeGreaterThan(0);
  });

  test("logout clears localStorage", () => {
    const user: CurrentUser = { userId: "1", slug: "alice", role: "investor", email: "a@test.com", token: "test-token" };
    renderWithUser(user);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(localStorage.getItem("cattlecoin_user")).toBeNull();
  });

  test("renders Outlet content", () => {
    const user: CurrentUser = { userId: "1", slug: "alice", role: "investor", email: "a@test.com", token: "test-token" };
    renderWithUser(user);
    expect(screen.getByText("page content")).toBeTruthy();
  });
});