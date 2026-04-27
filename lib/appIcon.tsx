import { ImageResponse } from "next/og";

export const ICON_SIZE = { width: 32, height: 32 } as const;
export const ICON_CONTENT_TYPE = "image/png" as const;

export function appIcon(
  emoji: string,
  gradient: [string, string],
): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
          borderRadius: 6,
          fontSize: 22,
        }}
      >
        {emoji}
      </div>
    ),
    { ...ICON_SIZE },
  );
}
