import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import type { CurrentUser } from "@/context/AuthContext";
import { CarcassEntry } from "@/pages/CarcassEntry";
import { StageUpdate } from "@/pages/StageUpdate";
import { noHerdsMessage } from "@/lib/herdBase";

vi.mock("@/lib/herdLifecycle", async () => {
  const actual = await vi.importActual<typeof import("@/lib/herdLifecycle")>("@/lib/herdLifecycle");
  return {
    ...actual,
    getHerdsByOwner: vi.fn(),
    getHerdAnimals: vi.fn(),
    getHerdCarcass: vi.fn(),
    getStageHistory: vi.fn(),
  };
});
import { getHerdsByOwner } from "@/lib/herdLifecycle";

const FEEDLOT: CurrentUser = { userId: "f1", slug: "feeder-test", role: "feedlot", email: "f@test.com", token: "tok" };
const RANCHER: CurrentUser = { userId: "r1", slug: "rancher1", role: "rancher", email: "r@test.com", token: "tok" };

function renderAs(user: CurrentUser, path: string, page: React.ReactNode) {
  localStorage.setItem("cattlecoin_user", JSON.stringify(user));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>{page}</AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getHerdsByOwner).mockReset();
  vi.mocked(getHerdsByOwner).mockResolvedValue({ count: 0, items: [] });
});

describe("noHerdsMessage (FD-B3)", () => {
  test("a feedlot is told how herds arrive; a rancher keeps the short line", () => {
    expect(noHerdsMessage("feedlot")).toMatch(/accept an offer to buy it/);
    expect(noHerdsMessage("feedlot")).toMatch(/post one of your own/);
    expect(noHerdsMessage("rancher")).toBe("You don't have any herds yet.");
    expect(noHerdsMessage(undefined)).toBe("You don't have any herds yet.");
  });
});

describe("Carcass Records with no herds (FD-B3)", () => {
  test("a new feedlot sees what to do next, with links to My Herds and Post a lot", async () => {
    renderAs(FEEDLOT, "/feedlot/carcass", <CarcassEntry />);
    await waitFor(() => expect(screen.getByText(/accept an offer to buy it/i)).toBeTruthy());
    expect(screen.getByRole("link", { name: /go to my herds/i }).getAttribute("href")).toBe("/feedlot");
    expect(screen.getByRole("link", { name: /post a lot/i }).getAttribute("href")).toBe("/feedlot/new");
  });
});

describe("Herd Stages with no herds (FD-B3)", () => {
  test("a new feedlot sees the same explanation and a Post a lot link under /feedlot", async () => {
    renderAs(FEEDLOT, "/feedlot/stages", <StageUpdate />);
    await waitFor(() => expect(screen.getByText(/accept an offer to buy it/i)).toBeTruthy());
    expect(screen.getByRole("link", { name: /post a lot/i }).getAttribute("href")).toBe("/feedlot/new");
  });

  test("a rancher still sees the short line", async () => {
    renderAs(RANCHER, "/rancher/stages", <StageUpdate />);
    await waitFor(() => expect(screen.getByText(/don't have any herds yet/i)).toBeTruthy());
    expect(screen.queryByText(/accept an offer/i)).toBeNull();
    expect(screen.getByRole("link", { name: /post a lot/i }).getAttribute("href")).toBe("/rancher/new");
  });
});
