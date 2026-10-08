-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "branch" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "repoName" TEXT,
ALTER COLUMN "title" SET DEFAULT 'Untitled Workspace';

-- CreateIndex
CREATE INDEX "Room_creatorId_idx" ON "Room"("creatorId");
