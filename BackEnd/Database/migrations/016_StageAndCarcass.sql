-- =============================================================================
-- 016_StageAndCarcass.sql   (requires 002, 008, 012)
-- Plan step 9 (remainder): wire dominant_stage into real transitions, and add
-- per-animal carcass grade records. Record-keeping only - neither of these
-- feeds the settlement math yet (that is a later step, once a retained-
-- ownership payout is designed).
--
--   1. herds.dominant_stage   now constrained to a fixed list (was free text)
--   2. herd_stage_history     one row per stage change
--   3. carcass_records        one row per animal per carcass result
--   4. carcass_record_history one row per create / change / void
--
-- Safe to run more than once.
-- =============================================================================

-- 1. Constrain dominant_stage to the five real stages (matches the values this
--    app already treats as canonical: portfolio.js/investors.js ALL_STAGES,
--    and the 004 migration's own backfill). A few display-only spots in
--    pools.js/investors.js also list a sixth "AUCTION" stage that was never
--    actually assigned to a herd anywhere - a pre-existing cosmetic
--    inconsistency, left alone here, not a real value to allow storing.
UPDATE herds SET dominant_stage = 'RANCH' WHERE dominant_stage IS NULL;

DO $$ BEGIN
  ALTER TABLE herds
    ADD CONSTRAINT chk_herds_dominant_stage
    CHECK (dominant_stage IN ('RANCH', 'BACKGROUNDING', 'FEEDLOT', 'PROCESSING', 'DISTRIBUTION'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE herds
  ADD COLUMN IF NOT EXISTS dominant_stage_updated_at TIMESTAMP;

-- 2. Stage history. One row per change, oldest first tells the story of a herd
--    moving from calf to rail.
CREATE TABLE IF NOT EXISTS herd_stage_history (
  history_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  herd_id            UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  from_stage         VARCHAR(30),
  to_stage           VARCHAR(30) NOT NULL,
  changed_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  changed_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note               VARCHAR(255),
  is_correction      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS ix_herd_stage_history_herd ON herd_stage_history (herd_id, changed_at);

-- 3. Carcass records: one per animal per carcass result. Real per-animal data,
--    not a herd average - USDA quality/yield grades vary animal to animal.
--    This only records what the packer reported; it does not drive any payout.
CREATE TABLE IF NOT EXISTS carcass_records (
  record_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id               BIGINT NOT NULL REFERENCES animals(animal_id) ON DELETE CASCADE,
  herd_id                 UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  sale_id                 UUID REFERENCES herd_sales(sale_id) ON DELETE SET NULL,
  hot_carcass_weight_lbs  DECIMAL(8,2),
  quality_grade           VARCHAR(20),
  yield_grade              DECIMAL(3,1),
  dressing_pct            DECIMAL(5,2),
  backfat_in               DECIMAL(4,2),
  ribeye_area_sqin        DECIMAL(5,2),
  marbling_score          VARCHAR(30),
  grid_premium_discount   DECIMAL(10,2),
  source                  VARCHAR(20) NOT NULL DEFAULT 'manual',
  status                  VARCHAR(10) NOT NULL DEFAULT 'active',
  verified                BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP,
  voided_at                TIMESTAMP,
  voided_by_user_id       UUID REFERENCES users(user_id) ON DELETE SET NULL,
  void_reason              VARCHAR(255),
  CONSTRAINT chk_carcass_quality_grade
    CHECK (quality_grade IS NULL OR quality_grade IN
      ('Prime', 'Choice', 'Select', 'Standard', 'Utility', 'Commercial', 'Cutter', 'Canner')),
  CONSTRAINT chk_carcass_yield_grade CHECK (yield_grade IS NULL OR (yield_grade >= 1.0 AND yield_grade <= 5.9)),
  CONSTRAINT chk_carcass_source CHECK (source IN ('manual', 'agent_report', 'packer_feed')),
  CONSTRAINT chk_carcass_status CHECK (status IN ('active', 'voided'))
);
CREATE INDEX IF NOT EXISTS ix_carcass_records_herd   ON carcass_records (herd_id, status);
CREATE INDEX IF NOT EXISTS ix_carcass_records_animal ON carcass_records (animal_id);

-- 4. Carcass record history.
CREATE TABLE IF NOT EXISTS carcass_record_history (
  history_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id           UUID NOT NULL REFERENCES carcass_records(record_id) ON DELETE CASCADE,
  herd_id              UUID NOT NULL REFERENCES herds(herd_id) ON DELETE CASCADE,
  action                 VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update', 'void')),
  changed_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  changed_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason               VARCHAR(255),
  before_values     JSONB,
  after_values       JSONB
);
CREATE INDEX IF NOT EXISTS ix_carcass_record_history_record ON carcass_record_history (record_id, changed_at);
CREATE INDEX IF NOT EXISTS ix_carcass_record_history_herd   ON carcass_record_history (herd_id);

SELECT 'herds with a stage now constrained' AS what, COUNT(*) AS rows FROM herds
UNION ALL
SELECT 'stage history rows', COUNT(*) FROM herd_stage_history
UNION ALL
SELECT 'carcass records', COUNT(*) FROM carcass_records;