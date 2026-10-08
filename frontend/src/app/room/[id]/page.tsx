import Workspace from "@/components/workspace/Workspace";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/login?callbackUrl=/room/${encodeURIComponent(id)}`);
  }

  return <Workspace roomId={id} initialSession={session} />;
}
