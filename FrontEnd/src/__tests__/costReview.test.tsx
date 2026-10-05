import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { InvoiceUpload, StatusBadge, SignalList } from "@/components/costs/CostEvidence";
import { DisputeForm, OwnerDisputes } from "@/components/costs/DisputeParts";
import { TrackRecordCard } from "@/components/pool/TrackRecordCard";
import { checkInvoiceFile, pctText, fileSize, MAX_INVOICE_BYTES } from "@/lib/costReview";
import type { Dispute, TrackRecord } from "@/lib/costReview";

vi.mock("@/lib/costReview", async () => {
  const actual = await vi.importActual<typeof import("@/lib/costReview")>("@/lib/costReview");
  return {
    ...actual,
    uploadInvoice: vi.fn(), disputeCost: vi.fn(), respondToDispute: vi.fn(), getTrackRecordByHerd: vi.fn(),
  };
});
import { uploadInvoice, disputeCost, respondToDispute, getTrackRecordByHerd } from "@/lib/costReview";

beforeEach(() => vi.clearAllMocks());

describe("invoice file checks", () => {
  test("accepts a normal PDF and rejects the obvious mistakes", () => {
    expect(checkInvoiceFile({ name: "a.pdf", size: 1000, type: "application/pdf" })).toBeNull();
    expect(checkInvoiceFile({ name: "a.png", size: 1000, type: "image/png" })).toBeNull();
    expect(checkInvoiceFile({ name: "a.pdf", size: 0, type: "application/pdf" })).toMatch(/empty/);
    expect(checkInvoiceFile({ name: "a.pdf", size: MAX_INVOICE_BYTES + 1, type: "application/pdf" })).toMatch(/5 MB/);
    expect(checkInvoiceFile({ name: "a.exe", size: 10, type: "application/x-msdownload" })).toMatch(/PDF, JPEG or PNG/);
  });
  test("small formatters", () => {
    expect(pctText(25)).toBe("+25.00%");
    expect(pctText(-3.5)).toBe("-3.50%");
    expect(pctText(null)).toBe("-");
    expect(fileSize(2048)).toBe("2 KB");
    expect(fileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("status badge and warnings", () => {
  test("system costs show no badge; manual ones do", () => {
    const { rerender } = render(<StatusBadge status="system" />);
    expect(screen.queryByTestId("verification-badge")).toBeNull();
    rerender(<StatusBadge status="unverified" />);
    expect(screen.getByTestId("verification-badge").textContent).toBe("No invoice yet");
    rerender(<StatusBadge status="verified" />);
    expect(screen.getByTestId("verification-badge").textContent).toBe("Checked by CattleCoin");
  });
  test("the no-invoice warning is not repeated under the badge", () => {
    render(<SignalList signals={[{ code: "no_invoice", label: "No invoice or receipt on file" }, { code: "flagged", label: "Flagged by an admin", note: "looks doubled" }]} />);
    expect(screen.queryByText(/No invoice or receipt/)).toBeNull();
    expect(screen.getByText(/Flagged by an admin: looks doubled/)).toBeTruthy();
  });
});

describe("invoice upload", () => {
  const pick = (file: File) => fireEvent.change(screen.getByTestId("invoice-input"), { target: { files: [file] } });

  test("sends the chosen file and reports the server message", async () => {
    vi.mocked(uploadInvoice).mockResolvedValue({ message: "Invoice attached." });
    const done = vi.fn();
    render(<InvoiceUpload expenseId="e1" onDone={done} />);
    const f = new File(["%PDF-1.4 x"], "inv.pdf", { type: "application/pdf" });
    pick(f);
    await waitFor(() => expect(done).toHaveBeenCalledWith("Invoice attached."));
    expect(uploadInvoice).toHaveBeenCalledWith("e1", f);
  });
  test("a bad file is stopped before it is sent", async () => {
    render(<InvoiceUpload expenseId="e1" onDone={vi.fn()} />);
    pick(new File(["x"], "a.exe", { type: "application/x-msdownload" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/PDF, JPEG or PNG/);
    expect(uploadInvoice).not.toHaveBeenCalled();
  });
  test("a server refusal is shown", async () => {
    vi.mocked(uploadInvoice).mockRejectedValue(new Error("That file does not look like a PDF, JPEG or PNG."));
    render(<InvoiceUpload expenseId="e1" onDone={vi.fn()} />);
    pick(new File(["x"], "a.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/does not look like/);
  });
});

describe("investor question on a cost", () => {
  test("needs a few words, then sends the note", async () => {
    vi.mocked(disputeCost).mockResolvedValue({ message: "Dispute sent." });
    const done = vi.fn();
    render(<DisputeForm expenseId="e1" onDone={done} />);
    fireEvent.click(screen.getByText("Question this cost"));
    fireEvent.click(screen.getByText("Send question"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/what looks wrong/);
    expect(disputeCost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("What looks wrong with this cost"), { target: { value: "Feed price looks doubled" } });
    fireEvent.click(screen.getByText("Send question"));
    await waitFor(() => expect(done).toHaveBeenCalledWith("Dispute sent."));
    expect(disputeCost).toHaveBeenCalledWith("e1", "Feed price looks doubled");
  });
  test("a server error (already open) is shown and the form stays", async () => {
    vi.mocked(disputeCost).mockRejectedValue(new Error("You already have an open dispute on this cost."));
    render(<DisputeForm expenseId="e1" onDone={vi.fn()} />);
    fireEvent.click(screen.getByText("Question this cost"));
    fireEvent.change(screen.getByLabelText("What looks wrong with this cost"), { target: { value: "still wrong" } });
    fireEvent.click(screen.getByText("Send question"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already have an open/);
    expect(screen.getByLabelText("What looks wrong with this cost")).toBeTruthy();
  });
});

describe("owner replies to a dispute", () => {
  const d = (over: Partial<Dispute> = {}): Dispute => ({
    disputeId: "d1", expenseId: "e1", cost: { category: "feed", amount: 5000, description: null },
    note: "Looks doubled", status: "open", ownerResponse: null, ownerRespondedAt: null, resolutionNote: null,
    resolvedAt: null, createdAt: "2026-09-20T12:00:00Z", raisedByMe: false, ...over,
  });
  test("nothing shows with no disputes", () => {
    const { container } = render(<OwnerDisputes disputes={[]} onDone={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
  test("open dispute with no reply shows the box and sends the reply", async () => {
    vi.mocked(respondToDispute).mockResolvedValue({ message: "Reply saved." });
    const done = vi.fn();
    render(<OwnerDisputes disputes={[d()]} onDone={done} />);
    expect(screen.getByText(/Looks doubled/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your reply"), { target: { value: "Two loads, invoice attached" } });
    fireEvent.click(screen.getByText("Send reply"));
    await waitFor(() => expect(done).toHaveBeenCalledWith("Reply saved."));
    expect(respondToDispute).toHaveBeenCalledWith("d1", "Two loads, invoice attached");
  });
  test("already replied or ruled on: no reply box, ruling is shown", () => {
    render(<OwnerDisputes disputes={[d({ status: "upheld", ownerResponse: "ok", resolutionNote: "Cost was wrong" })]} onDone={vi.fn()} />);
    expect(screen.queryByLabelText("Your reply")).toBeNull();
    expect(screen.getByText(/Cost was wrong/)).toBeTruthy();
    expect(screen.getByText("Upheld by CattleCoin")).toBeTruthy();
  });
});

describe("producer track record card", () => {
  const rec = (over: Partial<TrackRecord> = {}): TrackRecord => ({
    producer: { slug: "rancher10", division: "feeder", memberSince: "2026-01-01T00:00:00Z" },
    label: "limited",
    herds: { completedWithInvestors: 2, openToInvestorsNow: 1 },
    investorOutcomes: { capitalRaised: 180000, capitalReturned: 225000, weightedOutcomePct: 25, herdsMadeWhole: 1, herdsNotMadeWhole: 1, bestOutcomePct: 33.33, worstOutcomePct: -8.33 },
    costs: { manualCosts: 4, withInvoice: 3, withInvoicePct: 75, everFlagged: 1 },
    disputes: { raised: 2, upheld: 1, dismissed: 1, open: 0 },
    history: [{ herdName: "Herd A", saleDate: "2026-06-01", investors: 3, paidIn: 60000, paidOut: 80000, outcomePct: 33.33, madeWhole: true }],
    notice: "Results of herds this producer has already sold.",
    ...over,
  });
  test("shows the facts, the loss included", async () => {
    vi.mocked(getTrackRecordByHerd).mockResolvedValue(rec());
    render(<TrackRecordCard herdId="h1" />);
    expect(await screen.findByText(/Producer track record: rancher10/)).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByText("+25.00%")).toBeTruthy();
    expect(screen.getByText("+33.33% / -8.33%")).toBeTruthy();
    expect(screen.getByText("3 of 4 (75%)")).toBeTruthy();
    expect(screen.getByText("2 raised, 1 upheld, 1 dismissed")).toBeTruthy();
    expect(screen.getByText(/already sold/)).toBeTruthy();
  });
  test("a new producer is plainly labeled new", async () => {
    vi.mocked(getTrackRecordByHerd).mockResolvedValue(rec({
      label: "new", herds: { completedWithInvestors: 0, openToInvestorsNow: 1 }, history: [],
      investorOutcomes: { capitalRaised: 0, capitalReturned: 0, weightedOutcomePct: null, herdsMadeWhole: 0, herdsNotMadeWhole: 0, bestOutcomePct: null, worstOutcomePct: null },
      costs: { manualCosts: 0, withInvoice: 0, withInvoicePct: null, everFlagged: 0 },
      disputes: { raised: 0, upheld: 0, dismissed: 0, open: 0 },
    }));
    render(<TrackRecordCard herdId="h1" />);
    expect(await screen.findByText(/no completed herds with investors yet/)).toBeTruthy();
    expect(screen.queryByText("Herds sold with investors")).toBeNull();
    expect(screen.getByText("none logged yet")).toBeTruthy();
  });
  test("stays out of the way when the server refuses", async () => {
    vi.mocked(getTrackRecordByHerd).mockRejectedValue(new Error("nope"));
    const { container } = render(<TrackRecordCard herdId="h1" />);
    await waitFor(() => expect(getTrackRecordByHerd).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
