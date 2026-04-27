import { appIcon, ICON_CONTENT_TYPE, ICON_SIZE } from "@/lib/appIcon";

export const size = ICON_SIZE;
export const contentType = ICON_CONTENT_TYPE;

export default function Icon() {
  return appIcon("📈", ["#71717a", "#3f3f46"]);
}
