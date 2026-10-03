import { readChainId, readTokenBalance, describeNetwork } from "../blockchain/chainRead.js";

// What an investor sees about their wallet: the address, which network it is on,
// and for each lot they bought into, how many tokens were bought, whether the
// tokens have been sent to the wallet yet, and how many the wallet really holds
// on the blockchain right now. Identity is always the caller's own userId.
// The wallet's private key is never read here.
//
// Delivery status is shown in plain words:
//   delivered     tokens are in the wallet (a transaction hash proves it)
//   sending       payment recorded, tokens on their way
//   retrying      the last send did not go through; the system tries again by itself
//   waiting       lot has no token contract yet (it is created at the next attempt)
//   not_on_chain  bought before wallets existed; recorded in the ledger only
export function plainStatus(chainStatus) {
  switch (chainStatus) {
    case "delivered": return "delivered";
    case "pending":
    case "sending":   return "sending";
    case "failed":    return "retrying";
    case "skipped":   return "waiting";
    default:          return "not_on_chain";
  }
}

const joinUrl = (base, path) => (base ? `${base}${path}` : null);

// `db` is the pool. `chain` can be swapped in tests.
export async function getWalletView(db, userId, chain = { readChainId, readTokenBalance }) {
  const u = await db.query("SELECT wallet_address FROM users WHERE user_id = $1", [userId]);
  const address = u.rows[0]?.wallet_address || null;

  const buys = await db.query(
    `SELECT t.transaction_id, t.pool_id, t.amount, t.chain_status, t.blockchain_tx_hash, t.created_at,
            tp.contract_address, h.herd_id, h.herd_name
       FROM transactions t
       JOIN token_pools tp ON tp.pool_id = t.pool_id
       LEFT JOIN herds h ON h.herd_id = tp.herd_id
      WHERE t.user_id = $1 AND t.type = 'buy'
      ORDER BY t.created_at`,
    [userId]
  );

  const chainId = await chain.readChainId();
  const network = describeNetwork(chainId);
  const base = network?.explorerBase ?? null;

  const lotsById = new Map();
  for (const r of buys.rows) {
    let lot = lotsById.get(r.pool_id);
    if (!lot) {
      lot = {
        poolId: r.pool_id,
        herdId: r.herd_id,
        herdName: r.herd_name || "Herd",
        contractAddress: r.contract_address || null,
        contractUrl: null,
        tokensPurchased: 0,
        tokensDelivered: 0,
        onChainBalance: null,
        purchases: [],
      };
      lotsById.set(r.pool_id, lot);
    }
    const tokens = parseInt(r.amount, 10) || 0;
    const status = plainStatus(r.chain_status);
    lot.tokensPurchased += tokens;
    if (status === "delivered") lot.tokensDelivered += tokens;
    lot.purchases.push({
      transactionId: r.transaction_id,
      tokens,
      status,
      txHash: r.blockchain_tx_hash || null,
      txUrl: r.blockchain_tx_hash ? joinUrl(base, `/tx/${r.blockchain_tx_hash}`) : null,
      purchasedAt: r.created_at,
    });
  }
  const lots = [...lotsById.values()];

  if (address && chainId != null) {
    await Promise.all(
      lots.map(async (lot) => {
        if (!lot.contractAddress) return;
        lot.onChainBalance = await chain.readTokenBalance({ contractAddress: lot.contractAddress, address });
        lot.contractUrl = joinUrl(base, `/token/${lot.contractAddress}?a=${address}`);
      })
    );
  }

  return {
    asOfIso: new Date().toISOString(),
    hasWallet: Boolean(address),
    address,
    addressUrl: address ? joinUrl(base, `/address/${address}`) : null,
    network,
    chainReachable: chainId != null,
    lots,
  };
}
