import { HOME_APP_ICON_CONTENT_TYPE, HOME_APP_ICON_SIZE, renderHomeAppIcon } from "@/lib/homeAppIcons";

export const size = HOME_APP_ICON_SIZE;
export const contentType = HOME_APP_ICON_CONTENT_TYPE;

export default function Icon() {
  return renderHomeAppIcon("inbox");
}
