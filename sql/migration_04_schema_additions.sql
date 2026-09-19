-- =============================================================================
-- Migration 04: Schema additions and cleanup
-- =============================================================================
-- Run AFTER migration_03_triggers.sql.
--
-- What this does:
--   1. Adds preferredSubcategories text[] to users (for onboarding chips)
--   2. Drops users.stats jsonb (was never populated, always {booksReadCount:0})
--   3. Updates create_user_profile() to match the new users schema
-- =============================================================================

-- ── preferredSubcategories ────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS "preferredSubcategories" text[] DEFAULT '{}';

-- ── Drop unused stats jsonb ───────────────────────────────────────────────────
-- This column was a Firebase-era denormalized counter that was never updated
-- after signup. Per-user reading counts are derived from readingList at query time.
ALTER TABLE users DROP COLUMN IF EXISTS stats;

-- ── Update create_user_profile to match new schema ────────────────────────────
CREATE OR REPLACE FUNCTION create_user_profile(
  p_id                 uuid,
  p_email              text,
  p_display_name       text,
  p_language           text,
  p_country            text,
  p_catalog_preference text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (
    id, email, "displayName", language, country,
    "catalogPreference", "onboardingComplete",
    "preferredSubcategories", "createdAt", "lastLoginAt"
  )
  VALUES (
    p_id, p_email, p_display_name, p_language, p_country,
    p_catalog_preference, false,
    '{}', now(), now()
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;