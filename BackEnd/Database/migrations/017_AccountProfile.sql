-- =============================================================================
-- 017_AccountProfile.sql   (requires 002)
-- Punch list fix #10 (D8): the account page. Adds optional contact fields a
-- user can fill in for themselves. Every column is nullable with no default,
-- so existing accounts and the previous backend code are unaffected.
--
--   users.full_name      the person's name (the login username is still slug)
--   users.business_name  ranch / feedlot / company name
--   users.phone          one phone number, free text
--   users.address_line1 / address_line2 / city / state / postal_code
--                        mailing address
--   users.profile_updated_at  when the user last saved any of the above
--
-- Email stays view-only on the account page for now (it is part of the login
-- token), so nothing here touches users.email.
--
-- Safe to run more than once.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name          VARCHAR(120),
  ADD COLUMN IF NOT EXISTS business_name      VARCHAR(160),
  ADD COLUMN IF NOT EXISTS phone              VARCHAR(40),
  ADD COLUMN IF NOT EXISTS address_line1      VARCHAR(160),
  ADD COLUMN IF NOT EXISTS address_line2      VARCHAR(160),
  ADD COLUMN IF NOT EXISTS city               VARCHAR(80),
  ADD COLUMN IF NOT EXISTS state              VARCHAR(40),
  ADD COLUMN IF NOT EXISTS postal_code        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMP;
