import { currentMode } from "@/lib/mori/systemPrompt";
import { loadConversation } from "@/lib/mori/memory";
import MoriClient from "@/components/mori/MoriClient";

export const dynamic = "force-dynamic";

export default async function MoriPage() {
  // 모드/시각은 서버에서 산출, 대화 히스토리는 메모리에서 복원.
  // (대시보드 컨텍스트는 채팅 요청마다 API에서 live 조립)
  const m = currentMode();
  const history = await loadConversation();
  const initialHistory = history.map((h) => ({ role: h.role, content: h.content }));
  return <MoriClient mode={m.mode} nowKst={m.nowKst} initialHistory={initialHistory} currentPath="/mori" />;
}
