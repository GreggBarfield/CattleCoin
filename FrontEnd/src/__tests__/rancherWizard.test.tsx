import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { Rancher } from "@/pages/Rancher";
import { headCountMismatchWarning, missingHerdFields } from "@/lib/rancherWizardValidation";

// Post a Lot (punch list B2/B3): Back from step 2 then submitting step 1
// again must never create a second herd, and a half-built herd (0 cattle)
// can be resumed via ?herd=<id> instead of starting over.
//
// Step 1's submit is a native <form onSubmit>. jsdom's number-input step
// validation (step="0.01" on the price field) has a float-precision bug
// that reports a false stepMismatch for whole-dollar values, which silently
// blocks a button-click submit here even though real browsers submit fine.
// Tests dispatch the form's submit event directly to route around that
// jsdom quirk rather than clicking the submit button.

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    postRancherCreateHerd: vi.fn(),
    postRancherRegisterCattleBulk: vi.fn(),
    postRancherOpenToInvestors: vi.fn(),
  };
});
import { postRancherCreateHerd, postRancherRegisterCattleBulk } from "@/lib/api";

vi.mock("@/lib/rancherHerds", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherHerds")>("@/lib/rancherHerds");
  return { ...actual, getHerdDetail: vi.fn() };
});
import { getHerdDetail } from "@/lib/rancherHerds";

const RANCHER_USER = { userId: "r10", slug: "rancher10", role: "rancher" as const, email: "r10@example.com", token: "tok" };

const UPLOAD_CATTLE_TEXT = /Import individual cow records from a CSV file/;

function renderWizard(initialPath = "/rancher/new") {
  localStorage.setItem("cattlecoin_user", JSON.stringify(RANCHER_USER));
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/rancher/new" element={<Rancher />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

function fillStep1(headCount = "20") {
  fireEvent.change(screen.getByPlaceholderText(/Spring Angus/), { target: { value: "Test Lot" } });
  fireEvent.change(screen.getByPlaceholderText(/Angus x Hereford/), { target: { value: "Angus" } });
  fireEvent.change(screen.getByPlaceholderText("e.g. AN"), { target: { value: "AN" } });
  fireEvent.click(screen.getByRole("button", { name: "Spring" }));
  fireEvent.change(screen.getByPlaceholderText("e.g. 250000"), { target: { value: "40000" } });
  fireEvent.change(screen.getByPlaceholderText("e.g. 50"), { target: { value: headCount } });
}

function submitStep1(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form")!);
}

describe("Post a Lot wizard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(postRancherCreateHerd).mockReset().mockResolvedValue({
      message: "Herd created successfully.",
      herd: { herd_id: "h1", herd_name: "Test Lot", listing_price: 40000, purchase_status: "pending" },
    });
    vi.mocked(postRancherRegisterCattleBulk).mockReset();
    vi.mocked(getHerdDetail).mockReset();
  });

  test("Back to step 1 then submitting again does not create a second herd", async () => {
    const { container } = renderWizard();
    fillStep1();
    submitStep1(container);
    await waitFor(() => expect(screen.getByText(UPLOAD_CATTLE_TEXT)).toBeTruthy());
    expect(postRancherCreateHerd).toHaveBeenCalledTimes(1);

    // Back to step 1: it's locked (fields disabled, button says Continue)
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByText(/already created/)).toBeTruthy());
    expect(screen.getByPlaceholderText(/Spring Angus/)).toBeDisabled();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeTruthy();
    submitStep1(container);

    await waitFor(() => expect(screen.getByText(UPLOAD_CATTLE_TEXT)).toBeTruthy());
    // still only the one herd - no second POST
    expect(postRancherCreateHerd).toHaveBeenCalledTimes(1);
  });

  test("resuming a half-built herd via ?herd= jumps straight to step 2", async () => {
    vi.mocked(getHerdDetail).mockResolvedValue({
      herd_id: "h9", rancher_id: "r10", herd_name: "Resumed Lot", cohort_label: "Angus x Hereford",
      breed_code: "AN", season: "Fall", head_count: 25, listing_price: 50000, cattle_count: 0,
    });
    const { container } = renderWizard("/rancher/new?herd=h9");

    await waitFor(() => expect(screen.getByText(UPLOAD_CATTLE_TEXT)).toBeTruthy());
    expect(postRancherCreateHerd).not.toHaveBeenCalled();

    // Back shows the locked, pre-filled step 1 - no second herd created
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByDisplayValue("Resumed Lot")).toBeTruthy());
    submitStep1(container);
    await waitFor(() => expect(screen.getByText(UPLOAD_CATTLE_TEXT)).toBeTruthy());
    expect(postRancherCreateHerd).not.toHaveBeenCalled();
  });

  test("resuming a herd that already has cattle shows a message instead of the wizard", async () => {
    vi.mocked(getHerdDetail).mockResolvedValue({
      herd_id: "h9", rancher_id: "r10", herd_name: "Full Lot", cohort_label: null,
      breed_code: "AN", season: "Fall", head_count: 25, listing_price: 50000, cattle_count: 25,
    });
    renderWizard("/rancher/new?herd=h9");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already has cattle/));
    expect(screen.getByRole("link", { name: /Back to My Herds/ }).getAttribute("href")).toBe("/rancher");
  });

  test("resuming someone else's herd is refused", async () => {
    vi.mocked(getHerdDetail).mockResolvedValue({
      herd_id: "h9", rancher_id: "someone-else", herd_name: "Not Mine", cohort_label: null,
      breed_code: "AN", season: "Fall", head_count: 25, listing_price: 50000, cattle_count: 0,
    });
    renderWizard("/rancher/new?herd=h9");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/doesn't belong to your account/));
  });

  // B1: the group birth date / sale date / sale location fields are gone -
  // they were required but silently discarded (never sent to the backend).
  test("step 1 no longer asks for group birth date, sale date, or sale location", () => {
    renderWizard();
    expect(screen.queryByText("Group Birth Date")).toBeNull();
    expect(screen.queryByText("Expected Sale Date")).toBeNull();
    expect(screen.queryByText("Sale Location")).toBeNull();
    expect(document.querySelectorAll('input[type="date"]').length).toBe(0);
  });

  // B5: Head Count 19 used to be silently blocked by the browser's own
  // min=20 validation, leaving a stale "All fields are required." message
  // on screen. It should now show the specific, correct message.
  test("Head Count under 20 shows the real error, not a stale generic one", async () => {
    const { container } = renderWizard();
    fillStep1("19");
    submitStep1(container);
    await waitFor(() =>
      expect(screen.getByText("Head count must be at least 20.")).toBeTruthy()
    );
    expect(postRancherCreateHerd).not.toHaveBeenCalled();
  });

  // B6: a specific, per-field message instead of "All fields are
  // required.", and it clears as soon as the rancher starts fixing it.
  test("missing fields are named specifically, and the error clears as you type", async () => {
    const { container } = renderWizard();
    submitStep1(container);
    await waitFor(() =>
      expect(
        screen.getByText(/^Missing: Lot Name, Genetics Label, Breed Code, Season, Listing Price, Head Count\.$/)
      ).toBeTruthy()
    );
    fireEvent.change(screen.getByPlaceholderText(/Spring Angus/), { target: { value: "Test Lot" } });
    expect(screen.queryByText(/^Missing:/)).toBeNull();
  });

  // B8: a downloadable CSV template using the same headers the importer
  // auto-maps against (see B7).
  test("Download CSV template button is present on step 2", async () => {
    const { container } = renderWizard();
    fillStep1();
    submitStep1(container);
    await waitFor(() => expect(screen.getByText(UPLOAD_CATTLE_TEXT)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Download CSV template/ })).toBeTruthy();
  });
});

// B4: headCountMismatchWarning is a pure function (driving the real CSV
// drag-and-drop importer in jsdom to populate the cattle queue isn't
// practical) - unit tested directly instead of through the rendered page.
describe("headCountMismatchWarning (B4)", () => {
  test("no warning when the count matches", () => {
    expect(headCountMismatchWarning(20, 20)).toBeNull();
  });
  test("no warning when head count isn't a usable number yet", () => {
    expect(headCountMismatchWarning(5, NaN)).toBeNull();
    expect(headCountMismatchWarning(5, 0)).toBeNull();
  });
  test("warns when fewer cows were uploaded than the head count", () => {
    expect(headCountMismatchWarning(18, 20)).toMatch(/uploaded 18 of the 20 head/);
  });
  test("warns when more cows were uploaded than the head count", () => {
    expect(headCountMismatchWarning(22, 20)).toMatch(/uploaded 22 cows, more than the 20 head/);
  });
});

// B6: missingHerdFields is the pure function behind the step 1 error
// message (see the "missing fields are named specifically" test above,
// which exercises it through the rendered form).
describe("missingHerdFields (B6)", () => {
  const FULL = {
    name: "Test Lot",
    genetics_label: "Angus",
    breed_code: "AN",
    season: "Spring" as const,
    listing_price: "40000",
    head_count: "20",
  };
  test("nothing missing when every field is filled", () => {
    expect(missingHerdFields(FULL)).toEqual([]);
  });
  test("names each missing field", () => {
    expect(missingHerdFields({ ...FULL, name: "", breed_code: "" })).toEqual([
      "Lot Name",
      "Breed Code",
    ]);
  });
});
