import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import type { CurrentUser } from "@/context/AuthContext";
import { StageUpdate } from "@/pages/StageUpdate";

vi.mock("@/lib/herdLifecycle", async () => {
  const actual = await vi.importActual<typeof import("@/lib/herdLifecycle")>("@/lib/herdLifecycle");
  return {
    ...actual,
    getHerdsByOwner: vi.fn(),
    getStageHistory: vi.fn(),
    postStageChange: vi.fn(),
  };
});
import { getHerdsByOwner, getStageHistory, postStageChange } from "@/lib/herdLifecycle";
import type { OwnedHerd, StageHistoryResult } from "@/lib/herdLifecycle";

const USER: CurrentUser = { userId: "u1", slug: "rancher1", role: "rancher", email: "r@test.com", token: "tok" };

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/rancher/stages"]}>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );
}

function herd(over: Partial<OwnedHerd>): OwnedHerd {
  return {
    herd_id: "aaaaaaaa-0000-0000-0000-000000000000",
    herd_name: "Spring Steers",
    head_count: 40,
    dominant_stage: "FEEDLOT",
    purchase_status: "pending",
    feedlot_status: "pending",
    cattle_count: 38,
    created_at: "2026-09-01T12:00:00Z",
    ...over,
  };
}

function history(over: Partial<StageHistoryResult> = {}): StageHistoryResult {
  return {
    herd: { herdId: "aaaaaaaa-0000-0000-0000-000000000000", herdName: "Spring Steers", dominantStage: "FEEDLOT" },
    stages: ["RANCH", "BACKGROUNDING", "FEEDLOT", "PROCESSING", "DISTRIBUTION"],
    history: [
      {
        historyId: "h1", herdId: "aaaaaaaa-0000-0000-0000-000000000000", fromStage: "BACKGROUNDING",
        toStage: "FEEDLOT", changedBy: "rancher1", changedAt: "2026-09-10T12:00:00Z", note: null, isCorrection: false,
      },
    ],
    ...over,
  };
}

function renderPage() {
  localStorage.setItem("cattlecoin_user", JSON.stringify(USER));
  return render(<Wrapper><StageUpdate /></Wrapper>);
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getHerdsByOwner).mockReset();
  vi.mocked(getStageHistory).mockReset();
  vi.mocked(postStageChange).mockReset();
});

describe("StageUpdate - C4 dropdown disambiguation", () => {
  test("shows the stated head count, not the registered-cattle count, when names are unique", async () => {
    vi.mocked(getHerdsByOwner).mockResolvedValue({ count: 1, items: [herd({})] });
    renderPage();
    const select = await screen.findByRole("combobox");
    fireEvent.click(select);
    await waitFor(() => expect(screen.getByText(/Spring Steers \(40 head\)/)).toBeTruthy());
    expect(screen.queryByText(/38/)).toBeNull();
  });

  test("disambiguates two herds sharing a name using the posted date", async () => {
    const a = herd({ herd_id: "aaaaaaaa-1111-0000-0000-000000000000", head_count: 40, created_at: "2026-09-01T12:00:00Z" });
    const b = herd({ herd_id: "bbbbbbbb-2222-0000-0000-000000000000", head_count: 55, created_at: "2026-09-15T12:00:00Z" });
    vi.mocked(getHerdsByOwner).mockResolvedValue({ count: 2, items: [a, b] });
    renderPage();
    const select = await screen.findByRole("combobox");
    fireEvent.click(select);
    await waitFor(() => {
      expect(screen.getByText(/Spring Steers \(40 head, posted Sep 1, 2026\)/)).toBeTruthy();
      expect(screen.getByText(/Spring Steers \(55 head, posted Sep 15, 2026\)/)).toBeTruthy();
    });
  });
});

describe("StageUpdate - C6 empty state", () => {
  test("shows a Post a lot link when the rancher has no herds", async () => {
    vi.mocked(getHerdsByOwner).mockResolvedValue({ count: 0, items: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/don't have any herds yet/i)).toBeTruthy());
    const link = screen.getByRole("link", { name: /post a lot/i });
    expect(link.getAttribute("href")).toBe("/rancher/new");
  });
});

describe("StageUpdate - C5 history copy", () => {
  test("history description is no longer self-contradictory", async () => {
    vi.mocked(getHerdsByOwner).mockResolvedValue({ count: 1, items: [herd({})] });
    vi.mocked(getStageHistory).mockResolvedValue(history());
    renderPage();
    const select = await screen.findByRole("combobox");
    fireEvent.click(select);
    fireEvent.click(await screen.findByText(/Spring Steers/));
    await waitFor(() => expect(screen.getByText("Most recent change first.")).toBeTruthy());
    expect(screen.queryByText(/Oldest to newest/i)).toBeNull();
  });
});

describe("StageUpdate - C2 confirm before advance", () => {
  test("clicking Move does not call the API until confirmed", async () => {
    vi.mocked(getHerdsByOwner).mockResolvedValue({ count: 1, items: [herd({})] });
    vi.mocked(getStageHistory).mockResolvedValue(history());
    vi.mocked(postStageChange).mockResolvedValue({
      message: "Stage updated to PROCESSING.",
      herdId: "aaaaaaaa-0000-0000-0000-000000000000",
      dominantStage: "PROCESSING",
      entry: {
        historyId: "h2", herdId: "aaaaaaaa-0000-0000-0000-000000000000", fromStage: "FEEDLOT",
        toStage: "PROCESSING", changedBy: "rancher1", changedAt: "2026-09-23T12:00:00Z", note: null, isCorrection: false,
      },
    });

    renderPage();
    const select = await screen.findByRole("combobox");
    fireEvent.click(select);
    fireEvent.click(await screen.findByText(/Spring Steers/));

    const moveButton = await screen.findByRole("button", { name: /move to processing/i });
    fireEvent.click(moveButton);

    // still not confirmed - the API must not have fired yet
    expect(postStageChange).not.toHaveBeenCalled();
    expect(await screen.findByText(/This can't be undone/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /yes, move it/i }));
    await waitFor(() => expect(postStageChange).toHaveBeenCalledWith(
      "aaaaaaaa-0000-0000-0000-000000000000",
      { stage: "PROCESSING", note: undefined }
    ));
  });

  test("Cancel backs out of the confirm step without calling the API", async () => {
    vi.mocked(getHerdsByOwner).mockResolvedValue({ count: 1, items: [herd({})] });
    vi.mocked(getStageHistory).mockResolvedValue(history());

    renderPage();
    const select = await screen.findByRole("combobox");
    fireEvent.click(select);
    fireEvent.click(await screen.findByText(/Spring Steers/));

    const moveButton = await screen.findByRole("button", { name: /move to processing/i });
    fireEvent.click(moveButton);
    fireEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /move to processing/i })).toBeTruthy());
    expect(postStageChange).not.toHaveBeenCalled();
  });
});
