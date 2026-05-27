import { currentMode } from "@/lib/mori/systemPrompt";
import MoriClient from "@/components/mori/MoriClient";

export const dynamic = "force-dynamic";

export default function MoriPage() {
  // 모드/시각만 서버에서 산출해 전달. 대시보드 컨텍스트는 채팅 요청마다 API에서 live 조립.
  const m = currentMode();
  return <MoriClient mode={m.mode} nowKst={m.nowKst} />;
}
