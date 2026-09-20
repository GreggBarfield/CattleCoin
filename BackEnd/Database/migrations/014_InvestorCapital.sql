-- =============================================================================
-- 014_InvestorCapital.sql   (requires 009)
-- Plan step 8: at a sale, investors get back the money they actually paid in
-- FIRST, then share the profit (or the loss) by token share. The payout row
-- records how much of the investor's payout was their own money coming back.
--
--   herd_payouts.capital_returned   the part of an investor payout that is the
--                                   investor's own paid-in money (0 for every
--                                   other kind of payout row, and for sales
--                                   approved before this rule existed)
--
-- Safe to run more than once.
-- =============================================================================

ALTER TABLE herd_payouts
  ADD COLUMN IF NOT EXISTS capital_returned DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (capital_returned >= 0);

SELECT 'payout rows with capital returned' AS what, COUNT(*) AS rows FROM herd_payouts WHERE capital_returned > 0;
