import { ensureInvestorWallet } from "./wallets.js";
import { transferHerdTokens } from "../blockchain/herdToken.js";

// Sends the tokens for one recorded purchase to the investor's wallet and
// records the result on the purchase's `transactions` row. Never throws: the
// investor's payment has already gone through, so a blockchain problem must not
// turn into a failed purchase. A failure is saved as 'failed' for the retry sweep.
// `db` can be the pool.
export async function deliverTokens(db, transactionId) {
  try {
    const r = await db.query(
      `SELECT t.transaction_id, t.user_id, t.amount, t.chain_status, tp.contract_address
         FROM transactions t
         JOIN token_pools tp ON tp.pool_id = t.pool_id
        WHERE t.transaction_id = $1 AND t.type = 'buy'`,
      [transactionId]
    );
    if (r.rows.length === 0) return { status: "not_found" };
    const row = r.rows[0];
    if (row.chain_status !== "pending" && row.chain_status !== "failed") {
      return { status: row.chain_status || "untracked" };
    }

    if (!row.contract_address) {
      await db.query("UPDATE transactions SET chain_status = 'skipped' WHERE transaction_id = $1", [transactionId]);
      return { status: "skipped" };
    }

    // Claim the row so two sweeps (or a sweep and the original call) never send twice.
    const claimed = await db.query(
      `UPDATE transactions SET chain_status = 'sending', chain_attempted_at = NOW()
        WHERE transaction_id = $1 AND chain_status IN ('pending', 'failed')
        RETURNING transaction_id`,
      [transactionId]
    );
    if (claimed.rows.length === 0) return { status: "already_handled" };

    try {
      const wallet = await ensureInvestorWallet(db, row.user_id);
      const txHash = await transferHerdTokens({
        contractAddress: row.contract_address,
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
      WHERE chain_status IN ('pending', 'failed')
      ORDER BY created_at LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const row of todo.rows) {
    results.push({ transactionId: row.transaction_id, ...(await deliverTokens(db, row.transaction_id)) });
  }
  return results;
}
