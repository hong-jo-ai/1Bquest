/**
 * 텔레그램 단건 택배/반품 예약 명령 파싱 + Claude 브리지 지시문 생성.
 *
 * 사장님이 "홍길동 택배예약" / "홍길동 반품예약" 이라고 보내면,
 * 기존 Claude 브리지(헤드리스 claude + 가드 확인게이트)로 라우팅해
 * 채널 출고대기 주문에서 고객을 찾아 우체국 단건 송장을 예약한다.
 * (= 클로드 코드에서 하던 "고객명으로 찾아서 단건예약"을 텔레그램으로 재현)
 */

export type ParcelBookingType = "outbound" | "return";
export interface ParcelBookingCommand {
  name: string;
  type: ParcelBookingType;
}

/**
 * "<고객명> 택배예약" / "<고객명> 반품예약" 파싱. (택배 예약 / 반품 예약 띄어쓰기·"해줘" 허용)
 * 매칭 안 되면 null.
 */
export function parseParcelBookingCommand(text: string): ParcelBookingCommand | null {
  const t = String(text || "").trim();
  // 끝이 "택배예약" 또는 "반품예약"(앞에 고객명). "예약해줘"/"예약 해줘"도 허용.
  const m = t.match(/^(.+?)\s*(택배|반품)\s*예약\s*(?:해\s*줘|해\s*주세요|부탁)?[.!]?$/);
  if (!m) return null;
  const name = m[1].trim().replace(/(님|씨)$/, "").trim();
  if (name.length < 2 || name.length > 20) return null; // 이름 길이 가드(오탐 방지)
  // 명백히 명령어/문장인 경우 제외(이름 자리에 다른 키워드면 패스)
  if (/동기화|발주|급여|주차|출근|클로드|코드|^cc\b/i.test(name)) return null;
  return { name, type: m[2] === "반품" ? "return" : "outbound" };
}

/** Claude 브리지에 넘길 단건예약 지시문. 헤드리스 claude가 검색→예약(가드게이트)까지 수행. */
export function buildBookingInstruction(cmd: ParcelBookingCommand): string {
  const isReturn = cmd.type === "return";
  const kind = isReturn ? "반품" : "출고(택배)";
  const reqType = isReturn ? "2" : "1";
  return [
    `[우체국 단건 ${kind} 송장 예약] 고객 "${cmd.name}"`,
    "",
    "다음 순서로 진행해:",
    "1) local-agent 디렉터리에서 buildPostOffice 의 collectOutboundRows() 로 채널 출고대기 주문을 모은 뒤, 수취인 이름이 \"" + cmd.name + "\"와 일치(부분일치 포함)하는 주문을 찾아.",
    "2) 찾은 주문의 수취인·주소·상품·주문번호·채널을 먼저 텔레그램으로 보여줘.",
    `3) 그 주문을 local-agent/postParcel/register.js 의 ${isReturn ? "registerReturn(row)" : "registerSingle(row, { reqType: \"1\", source: \"텔레그램단건\" })"} 로 ${kind} 단건 예약해.`,
    "4) 예약은 실제 우체국 송장 발급이라, 시스템 가드가 사장님께 \"예/아니오\" 확인을 받을 거야 — 승인되면 진행, 거부면 중단.",
    "5) 성공하면 송장번호(regiNo)를 회신해.",
    "",
    "주의: 이름이 여러 건 매칭되면 후보 목록을 보여주고 어느 건인지 물어봐. 한 건도 못 찾으면 그대로 알려줘. 1인=1박스=송장 1개. (reqType: 출고=1, 반품=2)",
  ].join("\n");
}
