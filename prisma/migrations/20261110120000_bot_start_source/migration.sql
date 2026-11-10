-- AlterTable
ALTER TABLE "BotChat" ADD COLUMN "firstSource" TEXT,
ADD COLUMN "lastSource" TEXT;

-- CreateTable
CREATE TABLE "BotStart" (
    "id" SERIAL NOT NULL,
    "chatId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isNew" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotStart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotStart_source_createdAt_idx" ON "BotStart"("source", "createdAt");
