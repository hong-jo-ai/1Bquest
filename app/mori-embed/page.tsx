import { currentMode } from "@/lib/mori/systemPrompt";
import { loadConversation } from "@/lib/mori/memory";
import MoriClient from "@/components/mori/MoriClient";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string }>;
}

export default async function MoriEmbedPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const m = currentMode();
  const history = await loadConversation();
  const initialHistory = history.map((h) => ({ role: h.role, content: h.content }));

  return <MoriClient mode={m.mode} nowKst={m.nowKst} initialHistory={initialHistory} currentPath={params.from} />;
}
