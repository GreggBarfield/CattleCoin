-- 018_InvestorWallets.sql
-- Gives every investor a platform-held wallet (test network only for now) and
-- tracks whether each purchase's tokens have been sent to that wallet on-chain.
-- users.wallet_address already exists (migration 002); this adds the encrypted key.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wallet_key_enc TEXT;

-- NULL = not a tracked purchase (older rows, sells, mints).
-- pending   = purchase recorded, tokens not yet sent on-chain
-- delivered = tokens sent; blockchain_tx_hash holds the proof
-- failed    = send was tried and errored; the retry sweep will try again
-- skipped   = herd has no token contract yet; nothing to send
-- sending   = a send is in progress right now
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS chain_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS chain_attempted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS ix_transactions_chain_todo
  ON transactions (created_at)
  WHERE chain_status IN ('pending', 'failed');
