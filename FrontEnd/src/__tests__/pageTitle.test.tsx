import { describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Link, Route, Routes } from "react-router-dom";
import { pageTitleFor } from "@/lib/pageTitle";
import { PageTitle } from "@/components/layout/PageTitle";

describe("pageTitleFor (E3)", () => {
  const cases: Array<[string, string]> = [
    ["/", "CattleCoin"],
    ["/login", "Sign in - CattleCoin"],
    ["/signup", "Create account - CattleCoin"],
    ["/investor/inv1/dashboard", "Dashboard - CattleCoin"],
    ["/investor/inv1/holdings", "Marketplace - CattleCoin"],
    ["/investor/inv1/holdings/abc-123", "Herd details - CattleCoin"],
    ["/investor/inv1/cow/cow-9", "Animal details - CattleCoin"],
    ["/investor/inv1/money", "My Money - CattleCoin"],
    ["/investor/inv1/statements/sale-1", "Settlement statement - CattleCoin"],
    ["/invest/herd-1", "Invest - CattleCoin"],
    ["/rancher", "My Herds - CattleCoin"],
    ["/rancher/new", "Post a Lot - CattleCoin"],
    ["/rancher/stages", "Herd Stages - CattleCoin"],
    ["/feedlot", "My Herds - CattleCoin"],
    ["/feedlot/new", "Post a Lot - CattleCoin"],
    ["/feedlot/stages", "Herd Stages - CattleCoin"],
    ["/feedlot/carcass", "Carcass Records - CattleCoin"],
    ["/admin", "Admin - CattleCoin"],
    ["/admin/fees", "Fee setup - CattleCoin"],
    ["/admin/herd-ops", "Herd operations - CattleCoin"],
    ["/account", "My Account - CattleCoin"],
    ["/FAQ", "FAQ - CattleCoin"],
  ];

  test.each(cases)("%s -> %s", (path, title) => {
    expect(pageTitleFor(path)).toBe(title);
  });

  test("a trailing slash and different letter case give the same title", () => {
    expect(pageTitleFor("/rancher/")).toBe("My Herds - CattleCoin");
    expect(pageTitleFor("/faq")).toBe("FAQ - CattleCoin");
  });

  test("an unknown URL gets the not-found title", () => {
    expect(pageTitleFor("/this-page-does-not-exist")).toBe("Page not found - CattleCoin");
    expect(pageTitleFor("/rancher/nope")).toBe("Page not found - CattleCoin");
  });

  test("no title ever uses the old 'Cattle Token' name", () => {
    for (const [path] of cases) {
      expect(pageTitleFor(path)).not.toMatch(/cattle token/i);
    }
  });
});

describe("PageTitle component (E3)", () => {
  test("sets the tab title on load and updates it when the page changes", () => {
    document.title = "something else";

    render(
      <MemoryRouter initialEntries={["/rancher"]}>
        <PageTitle />
        <Link to="/FAQ">go to faq</Link>
        <Routes>
          <Route path="*" element={<div>page body</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(document.title).toBe("My Herds - CattleCoin");

    fireEvent.click(screen.getByText("go to faq"));
    expect(document.title).toBe("FAQ - CattleCoin");
  });
});
