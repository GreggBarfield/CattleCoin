-- =============================================================================
-- 009_Settlement.sql
-- Sale / settlement engine tables. A "sale" is one legal change of ownership of
-- a herd (rancher to feedlot, or feeder to a packer). It is submitted by the
-- herd's owner, approved by an admin, and produces payout records for every
-- party owed money out of the proceeds.
--
--   1. herd_sales    one row per sale (pending_approval / approved / rejected /
--                    cancelled). Only one live sale per herd.
--   2. herd_payouts  who is owed what from an approved sale (investors, the
--                    herd's owner, and any service provider billed on the
--                    expense ledger). Rows always add up to the gross price.
--
-- Herd closing: submitting a sale sets herds.feedlot_status = 'sold', which
-- every investor-facing query already treats as "not available" (they all
-- require 'listed'). Reject/cancel restores the status saved in
-- herd_sales.prior_feedlot_status.
--
-- This step records what is owed. It does not move money.
-- Safe to run more than once.
-- =============================================================================

CREATE TABLE IF NOT EXISTS herd_sales (
  sale_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  herd_id              UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  seller_user_id       UUID NOT NULL REFERENCES users(user_id),
  buyer_user_id        UUID REFERENCES users(user_id),
  buyer_name           VARCHAR(160),
  gross_amount         DECIMAL(14,2) NOT NULL CHECK (gross_amount >= 0),
  sale_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'rejected', 'cancelled')),
  prior_feedlot_status VARCHAR(20) NOT NULL,
  expenses_total       DECIMAL(14,2),
  net_amount           DECIMAL(14,2),
  submitted_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by_user_id   UUID REFERENCES users(user_id),
  decided_at           TIMESTAMP,
  decision_note        VARCHAR(255),
  CONSTRAINT chk_herd_sales_buyer CHECK (buyer_user_id IS NOT NULL OR buyer_name IS NOT NULL)
);

-- At most one pending or approved sale per herd (double-sale protection).
CREATE UNIQUE INDEX IF NOT EXISTS ux_herd_sales_one_live
  ON herd_sales (herd_id) WHERE status IN ('pending_approval', 'approved');
CREATE INDEX IF NOT EXISTS ix_herd_sales_seller ON herd_sales (seller_user_id);
CREATE INDEX IF NOT EXISTS ix_herd_sales_buyer  ON herd_sales (buyer_user_id);

CREATE TABLE IF NOT EXISTS herd_payouts (
  payout_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id           UUID NOT NULL REFERENCES herd_sales(sale_id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(user_id),
  recipient_type    VARCHAR(10) NOT NULL
    CHECK (recipient_type IN ('investor', 'owner', 'provider')),
  tokens_held       BIGINT NOT NULL DEFAULT 0 CHECK (tokens_held >= 0),
  share_pct         DECIMAL(9,6),
  amount            DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
  status            VARCHAR(10) NOT NULL DEFAULT 'owed'
    CHECK (status IN ('owed', 'paid')),
  paid_at           TIMESTAMP,
  paid_by_user_id   UUID REFERENCES users(user_id),
  payment_reference VARCHAR(120),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_herd_payouts_recipient UNIQUE (sale_id, user_id, recipient_type)
);

CREATE INDEX IF NOT EXISTS ix_herd_payouts_user ON herd_payouts (user_id);
CREATE INDEX IF NOT EXISTS ix_herd_payouts_sale ON herd_payouts (sale_id);

-- Verify
SELECT 'herd_sales' AS tbl, COUNT(*) AS rows FROM herd_sales
UNION ALL
SELECT 'herd_payouts', COUNT(*) FROM herd_payouts;
