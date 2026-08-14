import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getMoonData, formatKoreanDate, isOccasion, occasionLabelOf, type Occasion } from "../moonShared";

export const runtime = "nodejs";

let fontCache: Buffer | null = null;
async function getFontData(): Promise<Buffer> {
  if (!fontCache) {
    fontCache = await readFile(path.join(process.cwd(), "app", "moon", "og", "NotoSerifKR-sub.otf"));
  }
  return fontCache;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const dRaw = sp.get("d") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dRaw) ? dRaw : "2026-01-01";
  const occasion: Occasion = isOccasion(sp.get("o")) ? (sp.get("o") as Occasion) : "unsaid";
  const memory = (sp.get("m") ?? "").slice(0, 44);

  const data = getMoonData(date);
  const origin = req.nextUrl.origin;
  const logo = `${origin}/harriot-logo-horizontal-white.png`;

  const R = 190;
  const p = data.phase;
  const waxing = p < 0.5;
  const a = Math.abs(Math.cos(2 * Math.PI * p)) * R;
  const gibbous = waxing ? p >= 0.25 : p <= 0.75;

  const moonLayers = (
    <div style={{ display: "flex", position: "relative", width: R * 2, height: R * 2 }}>
      <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: R * 2, height: R * 2, borderRadius: R, backgroundColor: "#EDE8DA" }} />
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: waxing ? 0 : R,
          width: R,
          height: R * 2,
          backgroundColor: "#141A28",
          borderTopLeftRadius: waxing ? R : 0,
          borderBottomLeftRadius: waxing ? R : 0,
          borderTopRightRadius: waxing ? 0 : R,
          borderBottomRightRadius: waxing ? 0 : R,
        }}
      />
      {a > 3 && (
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: R - a,
            width: a * 2,
            height: R * 2,
            borderRadius: "50%",
            backgroundColor: gibbous ? "#EDE8DA" : "#141A28",
          }}
        />
      )}
      <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: R * 2, height: R * 2, borderRadius: R, border: "1px solid rgba(237,232,218,0.16)" }} />
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", backgroundColor: "#0f1626", fontFamily: "NotoSerifKR" }}>
        <div style={{ display: "flex", position: "relative", width: 560, height: 630, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: "#121A2B" }}>
          <div style={{ display: "flex", position: "absolute", left: 40, top: 60 }}>{moonLayers}</div>
          <div style={{ display: "flex", position: "absolute", left: -120, bottom: -260, width: 800, height: 400, borderRadius: "50%", backgroundColor: "#0b0f18", transform: "rotate(-5deg)" }} />
          <div style={{ display: "flex", position: "absolute", left: 46, bottom: 34, color: "#5a6a8c", fontSize: 17, letterSpacing: 4 }}>THE MOON OF YOUR NIGHT</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "64px 60px 44px", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", color: "#93a6cc", fontSize: 24, letterSpacing: 2 }}>
              {formatKoreanDate(date)} · {occasionLabelOf(occasion)}
            </div>
            <div style={{ display: "flex", color: "#F1ECDF", fontSize: 66, marginTop: 24, letterSpacing: -1 }}>{data.label}</div>
            <div style={{ display: "flex", color: "#b9c0cd", fontSize: 26, marginTop: 26, lineHeight: 1.65, width: 520 }}>{data.fact}</div>
            {memory ? (
              <div style={{ display: "flex", color: "#F1ECDF", fontSize: 30, marginTop: 34, lineHeight: 1.6, width: 520 }}>“{memory}”</div>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.16)", paddingTop: 26 }}>
            <div style={{ display: "flex", color: "#5a6a8c", fontSize: 18, letterSpacing: 3 }}>그날의 달</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="harriot" height={30} style={{ opacity: 0.92 }} />
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "NotoSerifKR", data: await getFontData(), weight: 300, style: "normal" }],
      headers: { "cache-control": "public, max-age=86400, s-maxage=86400" },
    }
  );
}
