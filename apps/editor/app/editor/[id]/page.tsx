import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import EditorClient from "./EditorClient";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const userId = (session?.user as any)?.id || 'anonymous';
  const resolvedParams = await params;

  return <EditorClient projectId={resolvedParams.id} userId={userId} />;
}
