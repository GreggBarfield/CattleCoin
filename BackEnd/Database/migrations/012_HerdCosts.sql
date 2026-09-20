-- =============================================================================
-- 012_HerdCosts.sql   (requires 008, 011)
-- Plan step 6: the feeder's own costs and LRP insurance records.
--
--   1. herd_expenses        who logged it, where it came from, void tracking
--   2. herd_expense_history one row per create / change / void of a cost
--   3. herd_lrp_policies    who logged it, when it last changed
--   4. herd_lrp_history     one row per create / change of an LRP record
--
-- A voided cost is kept (never deleted) and is left out of the sale split.
-- Safe to run more than once.
-- =============================================================================

-- 1. Costs: status, source, who, void details.
--    source: manual   = typed in by the herd owner
--            purchase = booked by the system when the herd was bought (step 5)
--            lrp      = booked by the system from an LRP record's premium
ALTER TABLE herd_expenses
  ADD COLUMN IF NOT EXISTS status             VARCHAR(10) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS source             VARCHAR(10) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lrp_policy_id      UUID REFERENCES herd_lrp_policies(policy_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS voided_at          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS voided_by_user_id  UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason        VARCHAR(255);

DO $$ BEGIN
  ALTER TABLE herd_expenses ADD CONSTRAINT chk_herd_expenses_status CHECK (status IN ('active', 'voided'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE herd_expenses ADD CONSTRAINT chk_herd_expenses_source CHECK (source IN ('manual', 'purchase', 'lrp'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rows that already exist: the step 5 purchase cost and any LRP premium cost
-- were system-booked.
UPDATE herd_expenses SET source = 'purchase' WHERE category = 'purchase'    AND source = 'manual';
UPDATE herd_expenses SET source = 'lrp'      WHERE category = 'lrp_premium' AND source = 'manual';

CREATE INDEX IF NOT EXISTS ix_herd_expenses_herd_status ON herd_expenses (herd_id, status);

-- 2. Cost history. before/after hold the fields that changed.
CREATE TABLE IF NOT EXISTS herd_expense_history (
  history_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id         UUID NOT NULL REFERENCES herd_expenses(expense_id) ON DELETE CASCADE,
  herd_id            UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  action             VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update', 'void')),
  changed_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  changed_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason             VARCHAR(255),
  before_values      JSONB,
  after_values       JSONB
);
CREATE INDEX IF NOT EXISTS ix_herd_expense_history_expense ON herd_expense_history (expense_id, changed_at);
CREATE INDEX IF NOT EXISTS ix_herd_expense_history_herd    ON herd_expense_history (herd_id);

-- 3. LRP records: who entered it, last change.
ALTER TABLE herd_lrp_policies
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMP;

-- 4. LRP history.
CREATE TABLE IF NOT EXISTS herd_lrp_history (
  history_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id          UUID NOT NULL REFERENCES herd_lrp_policies(policy_id) ON DELETE CASCADE,
  herd_id            UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  action             VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update')),
  changed_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  changed_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason             VARCHAR(255),
  before_values      JSONB,
  after_values       JSONB
);
CREATE INDEX IF NOT EXISTS ix_herd_lrp_history_policy ON herd_lrp_history (policy_id, changed_at);

SELECT 'active costs' AS what, COUNT(*) AS rows FROM herd_expenses WHERE status = 'active'
UNION ALL
SELECT 'cost history rows', COUNT(*) FROM herd_expense_history
UNION ALL
SELECT 'lrp policies', COUNT(*) FROM herd_lrp_policies;
