-- Место, ряд и сектор продавец теперь пишет в описании. Переносим их туда у старых
-- объявлений (кроме импортированных с OLX: там сектор и так взят из текста описания).
UPDATE "Listing"
SET "description" = concat_ws(
    E'\n\n',
    concat_ws(', ', NULLIF("sector", ''), 'ряд ' || NULLIF("row", ''), 'места ' || NULLIF("seats", '')),
    NULLIF("description", '')
)
WHERE "sourceUrl" IS NULL
  AND (NULLIF("sector", '') IS NOT NULL OR NULLIF("row", '') IS NOT NULL OR NULLIF("seats", '') IS NOT NULL);

-- AlterTable
ALTER TABLE "Listing" DROP COLUMN "row",
DROP COLUMN "seats",
DROP COLUMN "sector";
