// Plan step 9 (remainder): a herd's dominant_stage, wired to real transitions
// instead of being purely cosmetic. Record-keeping only - nothing in the
// settlement math reads this; it exists so a herd's custody stages are a real,
// auditable timeline instead of a display field anyone could set to anything.
//
// Order matters: STAGES is the one true progression a herd moves through.
// The owner can only move a herd to the stage right after its current one -
// no skipping ahead, no going back - so the history reads as a real timeline.
// An admin can set a herd to any stage, forward or back, with a reason - for
// fixing a mistake, not for day-to-day handling.
export const STAGES = ["RANCH", "BACKGROUNDING", "FEEDLOT", "PROCESSING", "DISTRIBUTION"];

export function shapeStageEntry(r) {
  return {
    historyId:    r.history_id,
    herdId:       r.herd_id,
    fromStage:    r.from_stage ?? null,
    toStage:      r.to_stage,
    changedBy:    r.changed_by_slug ?? null,
    changedAt:    r.changed_at,
    note:         r.note ?? null,
    isCorrection: r.is_correction,
  };
}

// Can this person move the herd from `from` to `to` right now?
// Returns { ok, status, message, isCorrection }.
export function stageChangeRule({ isAdmin, isOwner, from, to }) {
  const no = (status, message) => ({ ok: false, status, message });
  if (!STAGES.includes(to)) return no(400, `stage must be one of: ${STAGES.join(", ")}.`);
  if (to === from) return no(409, `This herd is already at ${to}.`);
  if (isAdmin) return { ok: true, isCorrection: true };
  if (!isOwner) return no(403, "Only the herd's owner or an admin can change its stage.");
  const fromIdx = STAGES.indexOf(from);
  const toIdx = STAGES.indexOf(to);
  if (toIdx !== fromIdx + 1) {
    const next = STAGES[fromIdx + 1] ?? null;
    return no(
      400,
      next
        ? `The next stage from ${from} is ${next}. Ask an admin for anything else.`
        : `This herd is already at the last stage (${from}). Ask an admin for anything else.`
    );
  }
  return { ok: true, isCorrection: false };
}