-- =============================================================================
-- 008_ProducerModel.sql
-- Shared groundwork for the producer model (feeders first, ranchers second).
-- Adds room only - nothing here changes how any existing herd behaves.
--
--   1. herds.ownership_model   sold_outright vs retained_ownership
--   2. herd_expenses           generic expense ledger (any producer, either
--                              billing direction)
--   3. herd_lrp_policies       generic LRP insurance record attached to a herd
--
-- Safe to run more than once (IF NOT EXISTS throughout).
-- =============================================================================

-- 1. Ownership model flag on the herd.
--    sold_outright      - ownership changes hands at each stage (feeders track)
--    retained_ownership - one owner, one continuous pool, calf to rail
--                         (ranchers track, not exercised yet)
ALTER TABLE herds
  ADD COLUMN IF NOT EXISTS ownership_model VARCHAR(20) NOT NULL DEFAULT 'sold_outright'
    CHECK (ownership_model IN ('sold_outright', 'retained_ownership'));

-- 2. Expense ledger.
--    The herd's owner (herds.rancher_id) is always the party who bears the cost.
--    billing_direction says where the bill came from:
--      self    - the owner is carrying its own cost basis (feeder finishing its
--                own cattle). billed_by_user_id stays NULL.
--      service - a third party billed the owner (feedyard billing a
--                rancher-owned herd for yardage/feed). billed_by_user_id is
--                the provider.
CREATE TABLE IF NOT EXISTS herd_expenses (
  expense_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  herd_id           UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  category          VARCHAR(30) NOT NULL
    CHECK (category IN ('feed', 'yardage', 'vet', 'death_loss_reserve', 'lrp_premium', 'other')),
  description       VARCHAR(255),
  amount            DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
  accrued_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  billing_direction VARCHAR(10) NOT NULL DEFAULT 'self'
    CHECK (billing_direction IN ('self', 'service')),
  billed_by_user_id UUID REFERENCES users(user_id),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_herd_expenses_billing CHECK (
    (billing_direction = 'self'    AND billed_by_user_id IS NULL) OR
    (billing_direction = 'service' AND billed_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_herd_expenses_herd ON herd_expenses (herd_id);

-- 3. LRP (Livestock Risk Protection) policy record.
--    CattleCoin does not underwrite anything - this only records a real
--    external policy bought through a USDA-approved agent. Fields are nullable
--    because this is a placeholder until an agent feed exists;
--    agent_verified stays FALSE until a real feed confirms the policy.
CREATE TABLE IF NOT EXISTS herd_lrp_policies (
  policy_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  herd_id            UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  policy_number      VARCHAR(60),
  endorsement_type   VARCHAR(20) NOT NULL DEFAULT 'other'
    CHECK (endorsement_type IN ('feeder_cattle', 'fed_cattle', 'other')),
  coverage_level_pct DECIMAL(5,2)
    CHECK (coverage_level_pct IS NULL OR (coverage_level_pct > 0 AND coverage_level_pct <= 100)),
  floor_price_cwt    DECIMAL(8,2)
    CHECK (floor_price_cwt IS NULL OR floor_price_cwt >= 0),
  premium_amount     DECIMAL(12,2)
    CHECK (premium_amount IS NULL OR premium_amount >= 0),
  effective_date     DATE,
  end_date           DATE,
  agent_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_herd_lrp_dates CHECK (
    effective_date IS NULL OR end_date IS NULL OR end_date >= effective_date
  )
);

CREATE INDEX IF NOT EXISTS ix_herd_lrp_policies_herd ON herd_lrp_policies (herd_id);

-- Verify
SELECT ownership_model, COUNT(*) AS herds FROM herds GROUP BY ownership_model;