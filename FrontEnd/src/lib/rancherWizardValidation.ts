// Pure validation/text helpers for the Post a Lot wizard (FrontEnd/src/pages/Rancher.tsx).
// Kept in their own module (rather than exported from Rancher.tsx) so the
// page component stays fast-refresh friendly, and so they're easy to unit
// test directly without driving the full wizard UI.

export interface HerdFormDataShape {
  name: string;
  genetics_label: string;
  breed_code: string;
  season: string;
  listing_price: string;
  head_count: string;
}

// B4: the herd's stated Head Count and the number of cows actually
// uploaded can differ - this warns (but never blocks) when they don't
// match.
export function headCountMismatchWarning(cowCount: number, headCount: number): string | null {
  if (!Number.isFinite(headCount) || headCount <= 0 || cowCount === headCount) return null;
  return cowCount < headCount
    ? `You've uploaded ${cowCount} of the ${headCount} head this lot lists. You can upload more before continuing, or continue and update the head count later.`
    : `You've uploaded ${cowCount} cows, more than the ${headCount} head this lot lists. Double-check the file before continuing.`;
}

// Fields missing from step 1, by their on-screen labels (B6: a specific
// message instead of the generic "All fields are required.").
export function missingHerdFields(h: HerdFormDataShape): string[] {
  const missing: string[] = [];
  if (!h.name.trim()) missing.push("Lot Name");
  if (!h.genetics_label.trim()) missing.push("Genetics Label");
  if (!h.breed_code.trim()) missing.push("Breed Code");
  if (!h.season) missing.push("Season");
  if (!h.listing_price) missing.push("Listing Price");
  if (!h.head_count) missing.push("Head Count");
  return missing;
}
