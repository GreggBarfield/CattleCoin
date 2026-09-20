import { HttpError } from "./routeHelpers.js";

// Moves a sold herd to the platform buyer when an admin approves the sale.
// Runs inside the approval transaction (pass its client), so either the
// whole handover happens or none of it does.
//
//   1. A new herd is created in the buyer's account (same head count and
//      details, feedlot_status 'pending' = not open to investors yet).
//   2. The animal records move to the new herd. One animal is one row (its
//      registration number is unique), so the animals are moved, not copied.
//      The seller's herd stays as the closed, sold record.
//   3. The price paid is booked as the new herd's first cost (category
//      'purchase', self-billed), so the buyer's own sale later is figured
//      after the cost of buying the cattle.
//   4. A herd_transfers row records what moved, and the sale points at the
//      new herd.
// The seller's LRP policies are not moved (an insurance policy belongs to
// whoever bought it).
export async function transferHerdToBuyer(client, saleId) {
  const saleRes = await client.query(
    `SELECT sale_id, herd_id, seller_user_id, buyer_user_id, gross_amount, sale_date::text AS sale_date
       FROM herd_sales WHERE sale_id = $1 FOR UPDATE`,
    [saleId]
  );
  if (saleRes.rowCount === 0) throw new HttpError(404, "Sale not found.");
  const sale = saleRes.rows[0];
  if (!sale.buyer_user_id) return null; // outside buyer: nothing to hand over

  const already = await client.query("SELECT 1 FROM herd_transfers WHERE sale_id = $1", [saleId]);
  if (already.rowCount > 0) throw new HttpError(409, "This sale has already been handed over to the buyer.");

  const herdRes = await client.query("SELECT * FROM herds WHERE herd_id = $1 FOR UPDATE", [sale.herd_id]);
  if (herdRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
  const old = herdRes.rows[0];

  const buyerRes = await client.query("SELECT user_id, role, slug FROM users WHERE user_id = $1", [sale.buyer_user_id]);
  const sellerRes = await client.query("SELECT slug FROM users WHERE user_id = $1", [sale.seller_user_id]);
  if (buyerRes.rowCount === 0) throw new HttpError(409, "The buyer's account no longer exists.");
  const buyer = buyerRes.rows[0];
  const sellerSlug = sellerRes.rows[0]?.slug ?? "seller";

  const isFeedlot = buyer.role === "feedlot";
  const baseName = old.herd_name ?? "Herd";
  const newName = (isFeedlot ? `${baseName} - Finishing` : baseName).slice(0, 120);

  const ins = await client.query(
    `INSERT INTO herds
       (rancher_id, herd_name, head_count, listing_price, purchase_status, verified_flag,
        dominant_stage, breed_code, season, cohort_label,
        feedlot_status, ownership_model, source_herd_id)
     VALUES ($1, $2, $3, NULL, 'pending', $4, $5, $6, $7, $8, 'pending', 'sold_outright', $9)
     RETURNING herd_id, herd_name, head_count`,
    [
      buyer.user_id, newName, old.head_count, old.verified_flag,
      isFeedlot ? "FEEDLOT" : old.dominant_stage,
      old.breed_code, old.season, old.cohort_label, old.herd_id,
    ]
  );
  const newHerd = ins.rows[0];

  const moved = await client.query(
    "UPDATE animals SET herd_id = $1 WHERE herd_id = $2 RETURNING animal_id",
    [newHerd.herd_id, old.herd_id]
  );
  const animalIds = moved.rows.map((r) => r.animal_id);

  await client.query(
    `INSERT INTO herd_transfers
       (sale_id, from_herd_id, to_herd_id, from_user_id, to_user_id, animal_count, animal_ids, purchase_price)
     VALUES ($1, $2, $3, $4, $5, $6, $7::bigint[], $8)`,
    [saleId, old.herd_id, newHerd.herd_id, sale.seller_user_id, sale.buyer_user_id,
     animalIds.length, animalIds, sale.gross_amount]
  );

  await client.query(
    `INSERT INTO herd_expenses (herd_id, category, description, amount, accrued_date, billing_direction, source)
     VALUES ($1, 'purchase', $2, $3, $4::date, 'self', 'purchase')`,
    [newHerd.herd_id, `Purchase of "${baseName}" from ${sellerSlug}`.slice(0, 255), sale.gross_amount, sale.sale_date]
  );

  await client.query("UPDATE herd_sales SET new_herd_id = $2 WHERE sale_id = $1", [saleId, newHerd.herd_id]);

  const warnings = [];
  if (animalIds.length !== Number(old.head_count)) {
    warnings.push(
      `The herd says ${old.head_count} head but ${animalIds.length} animal records moved. ` +
        "The new herd keeps the same head count; correct the animal list if needed."
    );
  }

  return {
    newHerdId: newHerd.herd_id,
    newHerdName: newHerd.herd_name,
    headCount: newHerd.head_count,
    animalsMoved: animalIds.length,
    purchaseExpense: Number(sale.gross_amount),
    warnings,
  };
}
