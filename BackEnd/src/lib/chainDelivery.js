import { ensureInvestorWallet } from "./wallets.js";
import { transferHerdTokens, deployHerdTokenQueued } from "../blockchain/herdToken.js";

// Makes sure a herd's token pool has its on-chain token contract, creating it
// the first time it is needed. Lots opened to investors through the newer flow
// never went through the old Publish step that used to create the contract, so
// the first purchase does it. A database lock per pool means two purchases (or
// the retry script running alongside the site) can never create two contracts.
// Returns the contract address.
const contractInFlight = new Map();
export function ensureHerdContract(db, poolId) {
  // Purchases of the same lot that arrive together share one attempt in this process,
  // so they do not each tie up a database connection waiting for the lock below.
  if (contractInFlight.has(poolId)) return contractInFlight.get(poolId);
  const p = ensureHerdContractLocked(db, poolId).finally(() => contractInFlight.delete(poolId));
  contractInFlight.set(poolId, p);
  return p;
}

async function ensureHerdContractLocked(db, poolId) {
  const isPool = typeof db.totalCount === "number";
  const client = isPool ? await db.connect() : db;
  const lockKey = "herdtoken:" + poolId;
  try {
    if (isPool) await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    const r = await client.query(
      `SELECT tp.contract_address, tp.total_supply, tp.herd_id, h.herd_name, h.breed_code
         FROM token_pools tp
         LEFT JOIN herds h ON h.herd_id = tp.herd_id
        WHERE tp.pool_id = $1`,
      [poolId]
    );
    if (r.rows.length === 0) throw new Error("Token pool not found");
    const p = r.rows[0];
    if (p.contract_address) return p.contract_address;

    const deployed = await deployHerdTokenQueued({
      herdId: p.herd_id,
      herdName: p.herd_name,
      breedCode: p.breed_code,
      totalSupply: Number(p.total_supply),
    });
    await client.query(
      "UPDATE token_pools SET contract_address = $2 WHERE pool_id = $1 AND contract_address IS NULL",
      [poolId, deployed.contractAddress]
    );
    return deployed.contractAddress;
  } finally {
    if (isPool) {
      try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]); } catch { /* connection is released next */ }
      client.release();
    }
  }
}

// Sends the tokens for one recorded purchase to the investor's wallet and
// records the result on the purchase's `transactions` row. Never throws: the
// investor's payment has already gone through, so a blockchain problem must not
// turn into a failed purchase. A failure is saved as 'failed' for the retry sweep.
// `db` can be the pool.
export async function deliverTokens(db, transactionId) {
  try {
    const r = await db.query(
      `SELECT t.transaction_id, t.user_id, t.pool_id, t.amount, t.chain_status, tp.contract_address
         FROM transactions t
         JOIN token_pools tp ON tp.pool_id = t.pool_id
        WHERE t.transaction_id = $1 AND t.type = 'buy'`,
      [transactionId]
    );
    if (r.rows.length === 0) return { status: "not_found" };
    const row = r.rows[0];
    // 'skipped' is what older versions wrote when a herd had no token contract yet;
    // those purchases are now picked up too, because the contract gets created on demand.
    if (row.chain_status !== "pending" && row.chain_status !== "failed" && row.chain_status !== "skipped") {
      return { status: row.chain_status || "untracked" };
    }

    // Claim the row so two sweeps (or a sweep and the original call) never send twice.
    const claimed = await db.query(
      `UPDATE transactions SET chain_status = 'sending', chain_attempted_at = NOW()
        WHERE transaction_id = $1 AND chain_status IN ('pending', 'failed', 'skipped')
        RETURNING transaction_id`,
      [transactionId]
    );
    if (claimed.rows.length === 0) return { status: "already_handled" };

    try {
      const contractAddress = row.contract_address || (await ensureHerdContract(db, row.pool_id));
      const wallet = await ensureInvestorWallet(db, row.user_id);
      const txHash = await transferHerdTokens({
        contractAddress,
        toAddress: wallet,
        tokens: parseInt(row.amount, 10),
      });
      await db.query(
        "UPDATE transactions SET chain_status = 'delivered', blockchain_tx_hash = $2 WHERE transaction_id = $1",
        [transactionId, txHash]
      );
      return { status: "delivered", txHash };
    } catch (err) {
      console.error("deliverTokens failed for", transactionId, "-", err.message);
      await db.query("UPDATE transactions SET chain_status = 'failed' WHERE transaction_id = $1", [transactionId]);
      return { status: "failed", error: err.message };
    }
  } catch (err) {
    console.error("deliverTokens error for", transactionId, "-", err.message);
    return { status: "error", error: err.message };
  }
}

// Retries purchases that are still waiting, or that failed earlier. Also picks up
// rows stuck on 'sending' after a crash, once the attempt is over 10 minutes old.
export async function retryPendingDeliveries(db, limit = 25) {
  await db.query(
    `UPDATE transactions SET chain_status = 'failed'
      WHERE chain_status = 'sending' AND chain_attempted_at < NOW() - INTERVAL '10 minutes'`
  );
  const todo = await db.query(
    `SELECT transaction_id FROM transactions
      WHERE chain_status IN ('pending', 'failed', 'skipped')
      ORDER BY created_at LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const row of todo.rows) {
    results.push({ transactionId: row.transaction_id, ...(await deliverTokens(db, row.transaction_id)) });
  }
  return results;
}
