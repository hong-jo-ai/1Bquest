import { appIcon, ICON_CONTENT_TYPE, ICON_SIZE } from "@/lib/appIcon";

export const size = ICON_SIZE;
export const contentType = ICON_CONTENT_TYPE;

export default function Icon() {
  // 콜드 플래티넘 → 딥 네이비-인디고 (모리 구체 톤)
  return appIcon("🔮", ["#B8C4D0", "#1A2332"]);
}
