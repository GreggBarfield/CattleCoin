-- =============================================================================
-- 019_CostVerification.sql   (requires 012)
-- Cost verification: make it hard to pad a herd's costs, and let investors
-- see and challenge what the owner logs.
--
--   1. herd_expenses          vendor, invoice number, verification status
--   2. herd_expense_history   can now record an admin "verify" and "flag"
--   3. herd_expense_documents the invoice or receipt files (kept in the database)
--   4. herd_expense_disputes  an investor's challenge to a cost, the owner's
--                             reply and the admin's ruling
--   5. investor_cost_seen     when an investor last looked at a herd's costs
--                             (drives the "new costs" alert)
--
-- verification_status (owner-typed costs only; system-booked costs are shown
-- as 'system' by the API and never use this column):
--   unverified  no invoice on file and nobody has checked it
--   documented  an invoice or receipt is attached
--   verified    an admin checked it
--   flagged     an admin flagged it, or a dispute against it was upheld
--
-- Safe to run more than once. Additive: rolling the code back never needs a
-- database rollback.
-- =============================================================================

-- 1. Costs: who it was paid to, which invoice, and where verification stands.
ALTER TABLE herd_expenses
  ADD COLUMN IF NOT EXISTS vendor_name         VARCHAR(120),
  ADD COLUMN IF NOT EXISTS invoice_number      VARCHAR(60),
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(12) NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS verification_note   VARCHAR(255);

DO $$ BEGIN
  ALTER TABLE herd_expenses ADD CONSTRAINT chk_herd_expenses_verification
    CHECK (verification_status IN ('unverified', 'documented', 'verified', 'flagged'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Finds the same vendor + invoice number used on more than one cost.
CREATE INDEX IF NOT EXISTS ix_herd_expenses_invoice
  ON herd_expenses (LOWER(BTRIM(vendor_name)), LOWER(BTRIM(invoice_number)))
  WHERE vendor_name IS NOT NULL AND invoice_number IS NOT NULL;

-- 2. History: the action list grows by 'verify' and 'flag'. The original
--    check in 012 was unnamed, so find it by what it checks.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'herd_expense_history'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE herd_expense_history DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE herd_expense_history ADD CONSTRAINT chk_herd_expense_history_action
    CHECK (action IN ('create', 'update', 'void', 'verify', 'flag'));
END $$;

-- 3. Invoice and receipt files. Kept in the database so the existing backups
--    cover them. A file is never deleted. sha256 lets the system notice the
--    same file attached to more than one cost.
CREATE TABLE IF NOT EXISTS herd_expense_documents (
  doc_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id           UUID NOT NULL REFERENCES herd_expenses(expense_id) ON DELETE CASCADE,
  herd_id              UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  filename             VARCHAR(200) NOT NULL,
  content_type         VARCHAR(100) NOT NULL
                         CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes           INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256               CHAR(64) NOT NULL,
  data                 BYTEA NOT NULL,
  uploaded_by_user_id  UUID REFERENCES users(user_id) ON DELETE SET NULL,
  uploaded_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_herd_expense_documents_expense ON herd_expense_documents (expense_id);
CREATE INDEX IF NOT EXISTS ix_herd_expense_documents_sha     ON herd_expense_documents (sha256);
CREATE UNIQUE INDEX IF NOT EXISTS ux_herd_expense_documents_once
  ON herd_expense_documents (expense_id, sha256);

-- 4. Disputes. One open dispute per investor per cost.
--    open      waiting for the owner's reply and an admin ruling
--    upheld    the admin agreed the cost is wrong (the cost is flagged; the
--              admin then corrects or voids it)
--    dismissed the admin did not agree
CREATE TABLE IF NOT EXISTS herd_expense_disputes (
  dispute_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id           UUID NOT NULL REFERENCES herd_expenses(expense_id) ON DELETE CASCADE,
  herd_id              UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  raised_by_user_id    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  note                 VARCHAR(1000) NOT NULL,
  status               VARCHAR(10) NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'upheld', 'dismissed')),
  owner_response       VARCHAR(1000),
  owner_responded_at   TIMESTAMP,
  resolution_note      VARCHAR(1000),
  resolved_by_user_id  UUID REFERENCES users(user_id) ON DELETE SET NULL,
  resolved_at          TIMESTAMP,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_herd_expense_disputes_herd    ON herd_expense_disputes (herd_id, status);
CREATE INDEX IF NOT EXISTS ix_herd_expense_disputes_expense ON herd_expense_disputes (expense_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_herd_expense_disputes_one_open
  ON herd_expense_disputes (expense_id, raised_by_user_id) WHERE status = 'open';

-- 5. When an investor last looked at a herd's costs.
CREATE TABLE IF NOT EXISTS investor_cost_seen (
  user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  herd_id   UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  seen_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, herd_id)
);

SELECT 'documents' AS what, COUNT(*) AS rows FROM herd_expense_documents
UNION ALL
SELECT 'disputes', COUNT(*) FROM herd_expense_disputes
UNION ALL
SELECT 'costs unverified', COUNT(*) FROM herd_expenses
 WHERE source = 'manual' AND status = 'active' AND verification_status = 'unverified';
