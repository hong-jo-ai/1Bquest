import type { Influencer } from "./influencerStorage";

// ── 우체국 택배 CSV 양식 ──────────────────────────────────────────────────
// 우체국 소포 온라인 접수 표준 포맷 (엑셀 업로드용)

const CSV_HEADERS = [
  "순번",
  "받는분성명",
  "받는분전화번호1",
  "받는분전화번호2",
  "받는분우편번호",
  "받는분주소",
  "받는분상세주소",
  "내용물",
  "수량",
  "무게(kg)",
  "배달메시지",
  "보내는분성명",
  "보내는분전화번호",
  "보내는분주소",
];

const SENDER = {
  name: "PAULVICE",
  phone: "02-0000-0000",  // 실제 번호로 변경 필요
  address: "서울특별시",   // 실제 주소로 변경 필요
};

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function generateShippingCSV(influencers: Influencer[]): string {
  const shippable = influencers.filter((inf) => inf.shippingInfo && inf.status === "confirmed");

  const rows = [CSV_HEADERS.join(",")];

  shippable.forEach((inf, idx) => {
    const s = inf.shippingInfo!;
    const row = [
      String(idx + 1),
      escapeCSV(s.recipientName),
      escapeCSV(s.phone.replace(/-/g, "")),
      "",
      escapeCSV(s.postalCode),
      escapeCSV(s.address),
      escapeCSV(s.addressDetail),
      escapeCSV(s.productName),
      String(s.quantity),
      "0.5",
      escapeCSV(s.memo || ""),
      escapeCSV(SENDER.name),
      escapeCSV(SENDER.phone),
      escapeCSV(SENDER.address),
    ];
    rows.push(row.join(","));
  });

  return rows.join("\n");
}

export function generateSingleShippingCSV(inf: Influencer): string {
  if (!inf.shippingInfo) throw new Error("배송 정보가 없습니다.");
  const s = inf.shippingInfo;

  const rows = [CSV_HEADERS.join(",")];
  const row = [
    "1",
    escapeCSV(s.recipientName),
    escapeCSV(s.phone.replace(/-/g, "")),
    "",
    escapeCSV(s.postalCode),
    escapeCSV(s.address),
    escapeCSV(s.addressDetail),
    escapeCSV(s.productName),
    String(s.quantity),
    "0.5",
    escapeCSV(s.memo || ""),
    escapeCSV(SENDER.name),
    escapeCSV(SENDER.phone),
    escapeCSV(SENDER.address),
  ];
  rows.push(row.join(","));
  return rows.join("\n");
}

export function downloadCSV(csv: string, filename: string): void {
  // BOM 추가 (엑셀 한글 깨짐 방지)
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
