-- AlterTable
ALTER TABLE "Commit" ADD COLUMN     "filesSnapshot" JSONB;

-- AlterTable
ALTER TABLE "Room" ALTER COLUMN "code" SET DEFAULT '// Welcome to CodeCollab!
';

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'cpp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "File_roomId_idx" ON "File"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "File_roomId_path_key" ON "File"("roomId", "path");

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
