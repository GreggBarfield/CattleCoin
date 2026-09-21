-- =============================================================================
-- 015_HerdStartingValue.sql   (requires 008, 011, 012)
-- Plan step 9: a rancher can raise money on their own herd. The herd's own
-- value (its listing price) is booked as the herd's starting cost, the same way
-- a feedlot's purchase price is, so investors share only the GAIN above that
-- value and get their own money back first.
--
--   herd_expenses   new category 'herd_value' and new source 'value'
--                   (booked by the site, never typed in by the owner)
--
-- Safe to run more than once.
-- =============================================================================

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
    CHECK (category IN ('feed', 'yardage', 'vet', 'death_loss_reserve', 'lrp_premium', 'purchase', 'herd_value', 'other'));
END $$;

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'herd_expenses'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE herd_expenses DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE herd_expenses
    ADD CONSTRAINT chk_herd_expenses_source CHECK (source IN ('manual', 'purchase', 'lrp', 'value'));
END $$;

SELECT 'starting-value costs' AS what, COUNT(*) AS rows FROM herd_expenses WHERE category = 'herd_value';
