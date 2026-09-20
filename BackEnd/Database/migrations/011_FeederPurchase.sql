-- =============================================================================
-- 011_FeederPurchase.sql   (requires 008, 009)
-- Plan step 5: the feeder purchase flow (a producer buys a whole herd from
-- another producer on the platform).
--
--   1. herd_sales     buyer acceptance columns + the herd created for the buyer
--   2. herds          source_herd_id (which herd this one was bought from)
--   3. herd_transfers one row per completed purchase: what moved, who to whom
--   4. herd_expenses  new cost category 'purchase' (the buyer's cost of buying)
--
-- Safe to run more than once.
-- =============================================================================

-- 1. Buyer acceptance + link to the herd created for the buyer.
--    buyer_response: not_required (outside buyer, nothing to accept)
--                    waiting | accepted | declined (platform buyer)
ALTER TABLE herd_sales
  ADD COLUMN IF NOT EXISTS buyer_response      VARCHAR(12) NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS buyer_responded_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS buyer_response_note VARCHAR(255),
  ADD COLUMN IF NOT EXISTS new_herd_id         UUID REFERENCES herds(herd_id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE herd_sales
    ADD CONSTRAINT chk_herd_sales_buyer_response
    CHECK (buyer_response IN ('not_required', 'waiting', 'accepted', 'declined'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A sale that is still waiting for approval and names a platform buyer must
-- now be accepted by that buyer first.
UPDATE herd_sales
   SET buyer_response = 'waiting'
 WHERE status = 'pending_approval'
   AND buyer_user_id IS NOT NULL
   AND buyer_response = 'not_required';

-- 2. Where a bought herd came from.
ALTER TABLE herds
  ADD COLUMN IF NOT EXISTS source_herd_id UUID REFERENCES herds(herd_id) ON DELETE SET NULL;

-- 3. Transfer record (one per approved sale to a platform buyer).
--    animal_ids keeps the list of animals that moved, because the animal
--    records themselves now point at the buyer's herd.
CREATE TABLE IF NOT EXISTS herd_transfers (
  transfer_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id        UUID NOT NULL UNIQUE REFERENCES herd_sales(sale_id) ON DELETE CASCADE,
  from_herd_id   UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  to_herd_id     UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  from_user_id   UUID NOT NULL REFERENCES users(user_id),
  to_user_id     UUID NOT NULL REFERENCES users(user_id),
  animal_count   INT  NOT NULL DEFAULT 0,
  animal_ids     BIGINT[] NOT NULL DEFAULT '{}',
  purchase_price DECIMAL(12,2) NOT NULL CHECK (purchase_price >= 0),
  transferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_herd_transfers_from ON herd_transfers (from_herd_id);
CREATE INDEX IF NOT EXISTS ix_herd_transfers_to   ON herd_transfers (to_herd_id);

-- 4. Add 'purchase' to the allowed expense categories. The old check is found
--    by what it says (not by name) and replaced.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'herd_expenses'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%death_loss_reserve%'
  LOOP
    EXECUTE format('ALTER TABLE herd_expenses DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE herd_expenses
    ADD CONSTRAINT herd_expenses_category_check
    CHECK (category IN ('feed', 'yardage', 'vet', 'death_loss_reserve', 'lrp_premium', 'purchase', 'other'));
END $$;

SELECT 'herd_transfers' AS tbl, COUNT(*) AS rows FROM herd_transfers
UNION ALL
SELECT 'herd_sales waiting for buyer', COUNT(*) FROM herd_sales WHERE buyer_response = 'waiting';
