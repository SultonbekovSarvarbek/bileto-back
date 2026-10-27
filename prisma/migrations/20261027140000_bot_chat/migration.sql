-- CreateTable
CREATE TABLE "BotChat" (
    "id" TEXT NOT NULL,
    "lang" "Lang" NOT NULL DEFAULT 'ru',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotChat_pkey" PRIMARY KEY ("id")
);
