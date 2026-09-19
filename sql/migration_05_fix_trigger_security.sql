-- =============================================================================
-- Migration 05: Add SECURITY DEFINER to all trigger functions
-- =============================================================================
-- Trigger functions run as the calling user by default, which is blocked by RLS
-- on categories, subcategories, book_categories, book_subcategories, bookStats,
-- and books. SECURITY DEFINER makes them execute as the function owner (postgres)
-- and bypass RLS entirely.
--
-- Run this if you see errors like:
--   "new row violates row-level security policy for table categories"
-- =============================================================================

-- ── fn_sync_book_subcategories ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_sync_book_subcategories()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM book_subcategories WHERE book_id = NEW.id;

  IF NEW.subcategories IS NOT NULL AND array_length(NEW.subcategories, 1) > 0 THEN
    INSERT INTO subcategories (name)
    SELECT DISTINCT unnested_sub
    FROM UNNEST(NEW.subcategories) AS unnested_sub
    WHERE unnested_sub IS NOT NULL AND unnested_sub <> ''
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO book_subcategories (book_id, subcategory_id)
    SELECT NEW.id, s.id
    FROM UNNEST(NEW.subcategories) AS unnested_sub
    JOIN subcategories s ON s.name = unnested_sub
    WHERE unnested_sub IS NOT NULL AND unnested_sub <> ''
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ── fn_sync_book_categories ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_sync_book_categories()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM book_categories WHERE book_id = NEW.id;

  IF NEW.categories IS NOT NULL AND array_length(NEW.categories, 1) > 0 THEN
    INSERT INTO categories (name)
    SELECT DISTINCT unnested_cat
    FROM UNNEST(NEW.categories) AS unnested_cat
    WHERE unnested_cat IS NOT NULL AND unnested_cat <> ''
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO book_categories (book_id, category_id)
    SELECT NEW.id, c.id
    FROM UNNEST(NEW.categories) AS unnested_cat
    JOIN categories c ON c.name = unnested_cat
    WHERE unnested_cat IS NOT NULL AND unnested_cat <> ''
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ── fn_activity_sync_views ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_activity_sync_views()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.action = 'view_details' AND NEW."bookId" IS NOT NULL THEN
    INSERT INTO "bookStats" ("bookId", views, "lastActivityAt")
    VALUES (NEW."bookId", 1, now())
    ON CONFLICT ("bookId") DO UPDATE SET
      views            = "bookStats".views + 1,
      "lastActivityAt" = now();
  END IF;
  RETURN NEW;
END;
$$;

-- ── fn_reading_list_sync_stats ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_reading_list_sync_stats()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_status text;
  v_new_status text;
  v_book_id    text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_status := OLD.status;
    v_new_status := NULL;
    v_book_id    := OLD."bookId";
  ELSIF TG_OP = 'INSERT' THEN
    v_old_status := NULL;
    v_new_status := NEW.status;
    v_book_id    := NEW."bookId";
  ELSE
    v_old_status := OLD.status;
    v_new_status := NEW.status;
    v_book_id    := NEW."bookId";
  END IF;

  IF v_old_status IS NOT DISTINCT FROM v_new_status THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO "bookStats" ("bookId", "lastActivityAt")
  VALUES (v_book_id, now())
  ON CONFLICT ("bookId") DO UPDATE SET "lastActivityAt" = now();

  IF v_old_status = 'wishlist'  THEN UPDATE "bookStats" SET wishlist  = GREATEST(0, wishlist  - 1) WHERE "bookId" = v_book_id; END IF;
  IF v_old_status = 'reading'   THEN UPDATE "bookStats" SET reading   = GREATEST(0, reading   - 1) WHERE "bookId" = v_book_id; END IF;
  IF v_old_status = 'completed' THEN UPDATE "bookStats" SET completed = GREATEST(0, completed - 1) WHERE "bookId" = v_book_id; END IF;

  IF v_new_status = 'wishlist'  THEN UPDATE "bookStats" SET wishlist  = wishlist  + 1 WHERE "bookId" = v_book_id; END IF;
  IF v_new_status = 'reading'   THEN UPDATE "bookStats" SET reading   = reading   + 1 WHERE "bookId" = v_book_id; END IF;
  IF v_new_status = 'completed' THEN UPDATE "bookStats" SET completed = completed + 1 WHERE "bookId" = v_book_id; END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── fn_sync_book_popularity ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_sync_book_popularity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE books SET "popularityCount" = (
    COALESCE(NEW.views,     0)     +
    COALESCE(NEW.wishlist,  0) * 2 +
    COALESCE(NEW.reading,   0) * 3 +
    COALESCE(NEW.completed, 0) * 5
  )
  WHERE id = NEW."bookId";
  RETURN NEW;
END;
$$;
