import { toCents } from "./routeHelpers.js";
import { loadDefaults, loadHerdTerms, shapeTerms, writeAudit } from "./feeTerms.js";
import { ensureHerdValueCost } from "./costs.js";

// What every herd needs before investors can buy into it:
//   1. a token pool (the off-chain share ledger; total supply = head count)
//   2. fee terms (copied from the platform defaults if the herd has none yet)
//   3. for a rancher-owned herd, its starting value booked as a cost (its
//      listing price), so investors share only the gain above that value
//
// Used by "open to investors" (routes/offering.js) and by the feedlot claim
// route, so no herd can reach investors by either road without both.
// Call inside a transaction, after locking the herd row.
//
// Fee terms lock at the first investor purchase, so the terms in place when a
// herd is opened are the terms the investors buy under.

export async function prepareHerdForInvestors(client, { herdId, actorUserId, listingPriceCents = null }) {
  const herdRes = await client.query("SELECT head_count FROM herds WHERE herd_id = $1", [herdId]);
  const headCount = Number(herdRes.rows[0]?.head_count ?? 0);

  // 1. token pool
  let poolRow;
  let poolCreated = false;
  const existing = await client.query(
    "SELECT pool_id, total_supply, contract_address FROM token_pools WHERE herd_id = $1",
    [herdId]
  );
  if (existing.rowCount > 0) {
    poolRow = existing.rows[0];
  } else {
    const ins = await client.query(
      `INSERT INTO token_pools (herd_id, total_supply) VALUES ($1, $2)
       RETURNING pool_id, total_supply, contract_address`,
      [herdId, headCount]
    );
    poolRow = ins.rows[0];
    poolCreated = true;
  }

  // 2. fee terms
  let termsRow = await loadHerdTerms(client, herdId, { lock: true });
  let termsCreated = false;
  if (!termsRow) {
    const d = await loadDefaults(client);
    const ins = await client.query(
      `INSERT INTO herd_fee_terms
         (herd_id, raise_fee_pct, exit_profit_fee_pct, exit_fee_payer, per_head_fee, per_head_fee_timing,
          note, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [herdId, d.raise_fee_pct, d.exit_profit_fee_pct, d.exit_fee_payer, d.per_head_fee, d.per_head_fee_timing,
       "Copied from the platform defaults when the herd was opened to investors.", actorUserId]
    );
    termsRow = ins.rows[0];
    termsCreated = true;
    await writeAudit(client, {
      action: "herd_terms_created",
      herdId,
      newValues: {
        raiseFeePct: Number(termsRow.raise_fee_pct),
        exitProfitFeePct: Number(termsRow.exit_profit_fee_pct),
        exitFeePayer: termsRow.exit_fee_payer,
        perHeadFee: Number(termsRow.per_head_fee),
        perHeadFeeTiming: termsRow.per_head_fee_timing,
        source: "platform defaults, at listing",
      },
      changedBy: actorUserId,
    });
  }

  // 3. starting value (rancher-owned herds only)
  const value = await ensureHerdValueCost(client, herdId, { priceCents: listingPriceCents, userId: actorUserId });

  const warnings = [];
  if (
    Number(termsRow.raise_fee_pct) === 0 &&
    Number(termsRow.exit_profit_fee_pct) === 0 &&
    toCents(termsRow.per_head_fee) === 0
  ) {
    warnings.push("No platform fee is currently set on this lot. If that changes before an investor buys in, we'll let you know.");
  }

  return {
    pool: {
      poolId: poolRow.pool_id,
      totalSupply: Number(poolRow.total_supply),
      contractAddress: poolRow.contract_address ?? null,
      createdNow: poolCreated,
    },
    terms: shapeTerms(termsRow),
    termsCreated,
    startingValue: value.amountCents != null && (value.booked || value.reason === "already booked")
      ? { booked: true, amount: value.amountCents / 100 }
      : { booked: false },
    warnings,
  };
}
