import { ImageResponse } from "next/og";

export type HomeAppIconKind = "dashboard" | "mori" | "inbox" | "threads";

export const HOME_APP_ICON_CONTENT_TYPE = "image/png" as const;
export const HOME_APP_ICON_SIZE = { width: 512, height: 512 } as const;
export const HOME_APPLE_ICON_SIZE = { width: 180, height: 180 } as const;

const iconConfig: Record<
  HomeAppIconKind,
  {
    label: string;
    bg: string;
    fg: string;
    accent: string;
    muted: string;
  }
> = {
  dashboard: {
    label: "DASH",
    bg: "#111827",
    fg: "#F8FAFC",
    accent: "#22C55E",
    muted: "#38BDF8",
  },
  mori: {
    label: "MORI",
    bg: "#182033",
    fg: "#F8FAFC",
    accent: "#B8C4D0",
    muted: "#7C9CEB",
  },
  inbox: {
    label: "CS",
    bg: "#881337",
    fg: "#FFF7ED",
    accent: "#FB7185",
    muted: "#FBBF24",
  },
  threads: {
    label: "TH",
    bg: "#18181B",
    fg: "#FAFAFA",
    accent: "#A1A1AA",
    muted: "#FFFFFF",
  },
};

export function isHomeAppIconKind(value: string): value is HomeAppIconKind {
  return value === "dashboard" || value === "mori" || value === "inbox" || value === "threads";
}

export function renderHomeAppIcon(kind: HomeAppIconKind, size: number = HOME_APP_ICON_SIZE.width) {
  const c = iconConfig[kind];
  const scale = size / HOME_APP_ICON_SIZE.width;
  const px = (value: number) => value * scale;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: c.bg,
          color: c.fg,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              kind === "mori"
                ? `radial-gradient(circle at 50% 42%, ${c.accent} 0, ${c.muted} 38%, ${c.bg} 72%)`
                : `linear-gradient(145deg, ${c.bg}, ${c.bg} 52%, ${c.accent})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: px(28),
            border: `${px(3)}px solid rgba(255,255,255,0.18)`,
            borderRadius: px(112),
          }}
        />

        {kind === "dashboard" && (
          <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: px(24), height: px(230) }}>
            {[104, 164, 222].map((height, i) => (
              <div
                key={height}
                style={{
                  width: px(62),
                  height: px(height),
                  borderRadius: px(28),
                  background: i === 2 ? c.accent : i === 1 ? c.muted : c.fg,
                }}
              />
            ))}
          </div>
        )}

        {kind === "mori" && (
          <div
            style={{
              position: "relative",
              width: px(238),
              height: px(238),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: px(119),
              background: "rgba(12,18,32,0.52)",
              border: `${px(8)}px solid rgba(255,255,255,0.36)`,
              fontSize: px(126),
              fontWeight: 800,
            }}
          >
            M
          </div>
        )}

        {kind === "inbox" && (
          <div style={{ position: "relative", display: "flex", width: px(286), height: px(224) }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: px(150),
                borderRadius: px(42),
                background: c.fg,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: px(34),
                right: px(34),
                top: 0,
                height: px(140),
                borderRadius: px(32),
                background: c.accent,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: px(68),
                right: px(68),
                bottom: px(54),
                height: px(42),
                borderRadius: px(21),
                background: c.bg,
              }}
            />
          </div>
        )}

        {kind === "threads" && (
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: px(256),
              height: px(256),
              border: `${px(24)}px solid ${c.fg}`,
              borderRadius: px(128),
              fontSize: px(176),
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            @
          </div>
        )}

        <div
          style={{
            position: "absolute",
            left: 0,
            width: px(512),
            bottom: px(62),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: px(44),
            fontWeight: 900,
            letterSpacing: 0,
          }}
        >
          {c.label}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
