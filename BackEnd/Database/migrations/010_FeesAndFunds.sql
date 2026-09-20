-- =============================================================================
-- 010_FeesAndFunds.sql
-- Platform fees and the investor-money ledger. Requires 008 and 009.
--
--   1. investor_payments       what each investor actually paid for tokens
--                              (their cost basis; also the "money raised")
--   2. platform_fee_defaults   one row: the platform's standard fee terms
--                              (all placeholders at 0 until set by an admin)
--   3. herd_fee_terms          the fee terms for one herd, adjustable per deal
--                              until the first investor buys or money is released
--   4. investor_fee_overrides  a different exit profit fee for one investor
--                              (all herds, or one herd)
--   5. fee_audit_log           every change to any fee term
--   6. herd_releases           investor money released to the producer, with the
--                              raise fee and per-head fee taken out
--   7. herd_sales / herd_payouts get columns to carry the fee breakdown, and
--      herd_payouts gains a 'platform' recipient (the fee CattleCoin keeps).
--
-- Every fee starts at 0. Nothing is charged until an admin sets real numbers.
-- This records fees. It does not move money.
-- Safe to run more than once.
-- =============================================================================

-- 1. Investor payments (idempotent per Stripe payment)
CREATE TABLE IF NOT EXISTS investor_payments (
  payment_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  herd_id                  UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES users(user_id),
  tokens                   BIGINT NOT NULL CHECK (tokens > 0),
  amount                   DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
  stripe_payment_intent_id VARCHAR(120) UNIQUE,
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_investor_payments_herd ON investor_payments (herd_id);
CREATE INDEX IF NOT EXISTS ix_investor_payments_user ON investor_payments (user_id);

-- 2. Platform fee defaults (single row, id = 1). All placeholders.
CREATE TABLE IF NOT EXISTS platform_fee_defaults (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  raise_fee_pct       DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (raise_fee_pct >= 0 AND raise_fee_pct <= 100),
  exit_profit_fee_pct DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (exit_profit_fee_pct >= 0 AND exit_profit_fee_pct <= 100),
  exit_fee_payer      VARCHAR(10)  NOT NULL DEFAULT 'investor' CHECK (exit_fee_payer IN ('investor', 'producer')),
  per_head_fee        DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (per_head_fee >= 0),
  per_head_fee_timing VARCHAR(10)  NOT NULL DEFAULT 'raise' CHECK (per_head_fee_timing IN ('raise', 'exit')),
  updated_by_user_id  UUID REFERENCES users(user_id),
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO platform_fee_defaults (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3. Per-herd fee terms
CREATE TABLE IF NOT EXISTS herd_fee_terms (
  herd_id             UUID PRIMARY KEY REFERENCES herds(herd_id) ON DELETE CASCADE,
  raise_fee_pct       DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (raise_fee_pct >= 0 AND raise_fee_pct <= 100),
  exit_profit_fee_pct DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (exit_profit_fee_pct >= 0 AND exit_profit_fee_pct <= 100),
  exit_fee_payer      VARCHAR(10)  NOT NULL DEFAULT 'investor' CHECK (exit_fee_payer IN ('investor', 'producer')),
  per_head_fee        DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (per_head_fee >= 0),
  per_head_fee_timing VARCHAR(10)  NOT NULL DEFAULT 'raise' CHECK (per_head_fee_timing IN ('raise', 'exit')),
  note                VARCHAR(255),
  locked_at           TIMESTAMP,
  updated_by_user_id  UUID REFERENCES users(user_id),
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Per-investor exit profit fee overrides (herd_id NULL = every herd)
CREATE TABLE IF NOT EXISTS investor_fee_overrides (
  override_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_user_id    UUID NOT NULL REFERENCES users(user_id),
  herd_id             UUID REFERENCES herds(herd_id) ON DELETE CASCADE,
  exit_profit_fee_pct DECIMAL(5,2) NOT NULL CHECK (exit_profit_fee_pct >= 0 AND exit_profit_fee_pct <= 100),
  note                VARCHAR(255),
  created_by_user_id  UUID REFERENCES users(user_id),
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_override_herd
  ON investor_fee_overrides (investor_user_id, herd_id) WHERE herd_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_override_all
  ON investor_fee_overrides (investor_user_id) WHERE herd_id IS NULL;

-- 5. Audit trail (no foreign keys on herd/investor so history survives deletes)
CREATE TABLE IF NOT EXISTS fee_audit_log (
  audit_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action             VARCHAR(40) NOT NULL,
  herd_id            UUID,
  investor_user_id   UUID,
  old_values         JSONB,
  new_values         JSONB,
  changed_by_user_id UUID REFERENCES users(user_id),
  changed_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_fee_audit_herd ON fee_audit_log (herd_id);

-- 6. Releases of investor money to the producer
CREATE TABLE IF NOT EXISTS herd_releases (
  release_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  herd_id            UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  producer_user_id   UUID NOT NULL REFERENCES users(user_id),
  gross_amount       DECIMAL(14,2) NOT NULL CHECK (gross_amount > 0),
  raise_fee_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0,
  raise_fee          DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (raise_fee >= 0),
  per_head_fee       DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (per_head_fee >= 0),
  net_to_producer    DECIMAL(14,2) NOT NULL CHECK (net_to_producer >= 0),
  status             VARCHAR(10) NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'paid')),
  note               VARCHAR(255),
  released_by_user_id UUID REFERENCES users(user_id),
  released_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at            TIMESTAMP,
  paid_by_user_id    UUID REFERENCES users(user_id),
  payment_reference  VARCHAR(120),
  CONSTRAINT chk_herd_releases_sum CHECK (gross_amount = raise_fee + per_head_fee + net_to_producer)
);
CREATE INDEX IF NOT EXISTS ix_herd_releases_herd ON herd_releases (herd_id);
CREATE INDEX IF NOT EXISTS ix_herd_releases_producer ON herd_releases (producer_user_id);

-- 7. Fee columns on sales and payouts
ALTER TABLE herd_sales
  ADD COLUMN IF NOT EXISTS platform_fees_total DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS fee_terms_snapshot  JSONB;

ALTER TABLE herd_payouts
  ADD COLUMN IF NOT EXISTS gross_before_fees DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS fee_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_basis        DECIMAL(14,2);

ALTER TABLE herd_payouts DROP CONSTRAINT IF EXISTS herd_payouts_recipient_type_check;
ALTER TABLE herd_payouts ADD CONSTRAINT herd_payouts_recipient_type_check
  CHECK (recipient_type IN ('investor', 'owner', 'provider', 'platform'));

-- Verify
SELECT 'investor_payments' AS tbl, COUNT(*) AS rows FROM investor_payments
UNION ALL SELECT 'platform_fee_defaults', COUNT(*) FROM platform_fee_defaults
UNION ALL SELECT 'herd_fee_terms', COUNT(*) FROM herd_fee_terms
UNION ALL SELECT 'investor_fee_overrides', COUNT(*) FROM investor_fee_overrides
UNION ALL SELECT 'fee_audit_log', COUNT(*) FROM fee_audit_log
UNION ALL SELECT 'herd_releases', COUNT(*) FROM herd_releases;
