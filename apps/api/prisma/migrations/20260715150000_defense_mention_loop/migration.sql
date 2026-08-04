-- @Expert mention + user defense/reattack loop
ALTER TABLE "reviews"
  ADD COLUMN "mention_expert_code" TEXT,
  ADD COLUMN "mention_direction" TEXT,
  ADD COLUMN "defense_count" INT NOT NULL DEFAULT 0,
  ADD COLUMN "last_defense" JSONB;
