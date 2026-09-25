import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CowsTable } from "@/components/tables/CowsTable";
import type { Cow } from "@/lib/types";

// Fix #17 (I3): the investor-facing cattle table used to show two fabricated
// money columns - "Investment to Date" and "Total Value" - computed from a
// flat percentage of the herd's listing price, not real per-animal data.
// These tests prove the columns are gone from the investor view.

const cow: Cow = {
  cowId: "1001",
  herdId: "795c41d1-9fa7-4018-8567-47e923344d17",
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

describe("CowsTable investor view (fix #17, I3)", () => {
  test("does not render the fabricated money columns", () => {
    render(<CowsTable cows={[cow]} />);
    expect(screen.queryByText("Investment to Date")).toBeNull();
    expect(screen.queryByText("Total Value")).toBeNull();
    expect(screen.queryByText("$1,234")).toBeNull();
    expect(screen.queryByText("$2,468")).toBeNull();
  });

  test("still renders the real animal columns", () => {
    render(<CowsTable cows={[cow]} />);
    expect(screen.getByText("Cattle ID")).toBeTruthy();
    expect(screen.getByText("Days")).toBeTruthy();
    expect(screen.getByText("Enrolled")).toBeTruthy();
    expect(screen.getByText("1001")).toBeTruthy();
  });
});
