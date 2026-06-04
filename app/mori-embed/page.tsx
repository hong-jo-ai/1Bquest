import { currentMode } from "@/lib/mori/systemPrompt";
import { loadConversation } from "@/lib/mori/memory";
import MoriClient from "@/components/mori/MoriClient";

export const dynamic = "force-dynamic";

export default async function MoriEmbedPage() {
  const m = currentMode();
  const history = await loadConversation();
  const initialHistory = history.map((h) => ({ role: h.role, content: h.content }));

  return <MoriClient mode={m.mode} nowKst={m.nowKst} initialHistory={initialHistory} />;
}
