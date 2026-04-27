import { appIcon, ICON_CONTENT_TYPE, ICON_SIZE } from "@/lib/appIcon";

export const size = ICON_SIZE;
export const contentType = ICON_CONTENT_TYPE;

export default function Icon() {
  return appIcon("📊", ["#38bdf8", "#0284c7"]);
}
