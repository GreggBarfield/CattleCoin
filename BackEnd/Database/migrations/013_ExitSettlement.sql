-- =============================================================================
-- 013_ExitSettlement.sql   (requires 009, 011, 012)
-- Plan step 7: the exit sale (a feeder herd sold to a packer or another buyer)
-- records the actual load and any LRP insurance payout, and admin corrections
-- to a pending sale are kept on record.
--
--   1. herd_sales         head sold / head lost, live weight, price per cwt,
--                         LRP indemnity (insurance payout) and a note.
--                         gross_amount stays "what the buyer pays"; the LRP
--                         indemnity is added on top of it when the proceeds
--                         are split (the buyer's purchase cost is not changed).
--   2. herd_sale_history  admin corrections to a pending sale (who, why, before/after).
--
-- Safe to run more than once.
-- =============================================================================

ALTER TABLE herd_sales
  ADD COLUMN IF NOT EXISTS head_sold       INT           CHECK (head_sold > 0),
  ADD COLUMN IF NOT EXISTS head_lost       INT           CHECK (head_lost >= 0),
  ADD COLUMN IF NOT EXISTS live_weight_lbs DECIMAL(12,2) CHECK (live_weight_lbs > 0),
  ADD COLUMN IF NOT EXISTS price_per_cwt   DECIMAL(10,2) CHECK (price_per_cwt >= 0),
  ADD COLUMN IF NOT EXISTS lrp_indemnity   DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (lrp_indemnity >= 0),
  ADD COLUMN IF NOT EXISTS lrp_note        VARCHAR(255);

-- Load numbers come as a set: weight and price together, and a load needs a head count.
DO $$ BEGIN
  ALTER TABLE herd_sales
    ADD CONSTRAINT chk_herd_sales_load
    CHECK (
      (live_weight_lbs IS NULL) = (price_per_cwt IS NULL)
      AND (live_weight_lbs IS NULL OR head_sold IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS herd_sale_history (
  history_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID NOT NULL REFERENCES herd_sales(sale_id) ON DELETE CASCADE,
  action      VARCHAR(20) NOT NULL,
  changed_by  UUID REFERENCES users(user_id),
  reason      VARCHAR(255),
  before_data JSONB,
  after_data  JSONB,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_herd_sale_history_sale ON herd_sale_history (sale_id);

SELECT 'sales with load numbers' AS what, COUNT(*) AS rows FROM herd_sales WHERE live_weight_lbs IS NOT NULL
UNION ALL
SELECT 'sales with an LRP payout', COUNT(*) FROM herd_sales WHERE lrp_indemnity > 0
UNION ALL
SELECT 'sale corrections', COUNT(*) FROM herd_sale_history;
