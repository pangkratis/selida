-- =============================================================================
-- Migration 03: Auto-maintain bookStats via triggers
-- =============================================================================
-- Run AFTER migration_02_normalize.sql.
--
-- What this does:
--   1. Trigger on userActivity INSERT → auto-increments bookStats.views
--      (replaces app-side incrementBookView RPC calls)
--   2. Trigger on readingList INSERT/UPDATE/DELETE → auto-maintains
--      bookStats.reading / wishlist / completed counts
--      (replaces app-side updateBookStatusStats RPC calls)
--   3. Trigger on bookStats UPDATE → syncs books.popularityCount
--      so book-list.tsx can still ORDER BY popularityCount without a join
--   4. Critical missing indexes for common query patterns
--
-- After this migration, increment_book_view and update_book_status_stats
-- RPC functions are dropped — the app no longer calls them.
-- =============================================================================

-- ── 1. Views: auto-increment when userActivity row is inserted ────────────────

CREATE OR REPLACE FUNCTION fn_activity_sync_views()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'view_details' AND NEW."bookId" IS NOT NULL THEN
    INSERT INTO "bookStats" ("bookId", views, "lastActivityAt")
    VALUES (NEW."bookId", 1, now())
    ON CONFLICT ("bookId") DO UPDATE SET
      views         = "bookStats".views + 1,
      "lastActivityAt" = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activity_sync_views ON "userActivity";
CREATE TRIGGER trg_activity_sync_views
AFTER INSERT ON "userActivity"
FOR EACH ROW EXECUTE FUNCTION fn_activity_sync_views();

-- ── 2. Reading/wishlist/completed: auto-maintain from readingList changes ─────

CREATE OR REPLACE FUNCTION fn_reading_list_sync_stats()
RETURNS trigger LANGUAGE plpgsql AS $$
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

  -- Nothing to do when status hasn't changed
  IF v_old_status IS NOT DISTINCT FROM v_new_status THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Ensure a bookStats row exists
  INSERT INTO "bookStats" ("bookId", "lastActivityAt")
  VALUES (v_book_id, now())
  ON CONFLICT ("bookId") DO UPDATE SET "lastActivityAt" = now();

  -- Decrement old status counter
  IF v_old_status = 'wishlist'  THEN UPDATE "bookStats" SET wishlist  = GREATEST(0, wishlist  - 1) WHERE "bookId" = v_book_id; END IF;
  IF v_old_status = 'reading'   THEN UPDATE "bookStats" SET reading   = GREATEST(0, reading   - 1) WHERE "bookId" = v_book_id; END IF;
  IF v_old_status = 'completed' THEN UPDATE "bookStats" SET completed = GREATEST(0, completed - 1) WHERE "bookId" = v_book_id; END IF;

  -- Increment new status counter
  IF v_new_status = 'wishlist'  THEN UPDATE "bookStats" SET wishlist  = wishlist  + 1 WHERE "bookId" = v_book_id; END IF;
  IF v_new_status = 'reading'   THEN UPDATE "bookStats" SET reading   = reading   + 1 WHERE "bookId" = v_book_id; END IF;
  IF v_new_status = 'completed' THEN UPDATE "bookStats" SET completed = completed + 1 WHERE "bookId" = v_book_id; END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_reading_list_sync_stats ON "readingList";
CREATE TRIGGER trg_reading_list_sync_stats
AFTER INSERT OR UPDATE OF status OR DELETE ON "readingList"
FOR EACH ROW EXECUTE FUNCTION fn_reading_list_sync_stats();

-- ── 3. Popularity: keep books.popularityCount synced from bookStats ───────────
-- Weighted composite: views×1 + wishlist×2 + reading×3 + completed×5
-- This lets book-list.tsx do .order('popularityCount') without a join.

CREATE OR REPLACE FUNCTION fn_sync_book_popularity()
RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_sync_book_popularity ON "bookStats";
CREATE TRIGGER trg_sync_book_popularity
AFTER INSERT OR UPDATE ON "bookStats"
FOR EACH ROW EXECUTE FUNCTION fn_sync_book_popularity();

-- ── 4. Drop the old manual RPC functions (triggers replace them) ──────────────

DROP FUNCTION IF EXISTS increment_book_view(text);
DROP FUNCTION IF EXISTS update_book_status_stats(text, text, text);

-- ── 5. Critical missing indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS rl_user_status
  ON "readingList" ("userId", status);

CREATE INDEX IF NOT EXISTS rl_user_added
  ON "readingList" ("userId", "addedAt" DESC);

CREATE INDEX IF NOT EXISTS ua_user_action_ctx
  ON "userActivity" ("userId", action, context, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS ua_book_action
  ON "userActivity" ("bookId", action, "createdAt" DESC);

-- GIN indexes for recommendation array-overlap queries
CREATE INDEX IF NOT EXISTS books_categories_gin
  ON books USING gin(categories);

CREATE INDEX IF NOT EXISTS books_subcategories_gin
  ON books USING gin(subcategories);

CREATE INDEX IF NOT EXISTS books_authors_gin
  ON books USING gin(authors);

CREATE INDEX IF NOT EXISTS books_source_idx
  ON books(source);