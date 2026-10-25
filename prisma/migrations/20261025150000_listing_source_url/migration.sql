-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "sourceUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Listing_sourceUrl_key" ON "Listing"("sourceUrl");
