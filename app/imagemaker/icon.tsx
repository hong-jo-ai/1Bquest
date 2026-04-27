import { appIcon, ICON_CONTENT_TYPE, ICON_SIZE } from "@/lib/appIcon";

export const size = ICON_SIZE;
export const contentType = ICON_CONTENT_TYPE;

export default function Icon() {
  return appIcon("🖼️", ["#2dd4bf", "#0d9488"]);
}
