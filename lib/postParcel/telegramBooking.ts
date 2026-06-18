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
  const N = cmd.name;
  return [
    `[우체국 단건 ${kind} 송장 예약] 고객 "${N}"`,
    "local-agent 디렉터리에서 작업. 작업 위치 자격증명은 .env.supabase/.env.local 로드.",
    "",
    "■ A) 먼저 '과거 발송기록'에서 빠르게 찾아(교환·재발송 대응 — 이게 빠름):",
    `  - Supabase finance/pp_shipments 테이블에서 recipient_name 이 "${N}" 부분일치인 행을 created_at 내림차순으로 조회.`,
    "    (컬럼: recipient_name, recipient_addr, recipient_zip, recipient_mobile, product_name, order_number, channel, regi_no, created_at)",
    "  - 있으면: 그 고객은 전에 보낸 적 있는 사람(교환/재발송 가능성 큼). 가장 최근 행의 주소/연락처/상품/채널을 쓴다.",
    "",
    "■ B) 과거기록에 없으면 '출고대기 신규주문'에서 찾기:",
    `  - buildPostOffice 의 collectOutboundRows() 로 채널 출고대기를 모아 수취인 이름이 "${N}" 부분일치인 주문을 찾아(이건 전 채널 라이브 수집이라 1~2분 걸릴 수 있음).`,
    "",
    "■ 찾은 정보(수취인·주소·우편번호·연락처·상품·채널·과거송장)를 먼저 텔레그램으로 보여줘.",
    "",
    "■ 예약(local-agent/postParcel/register.js):",
    isReturn
      ? `  - registerReturn({ name, addr, zip, mobile, prod, qty:"1", order, seller:채널 }) 로 반품 단건 예약.`
      : `  - registerSingle({ name, addr, zip, mobile, prod, qty:"1", order, seller:채널 }, { reqType:"1", source:"텔레그램단건" }) 로 출고 예약.`,
    "  - ⚠️ 과거기록(A)에서 찾은 '재발송/교환'이면, 원주문과 멱등 충돌(이미 발급으로 skip)을 피하려고 order 를 \"{원주문번호}-EX\" 로 줘서 새 송장이 나오게 해. msg(배송메모)는 \"교환/재발송\"으로.",
    "",
    "■ 예약은 실제 송장 발급이라 시스템 가드가 \"예/아니오\" 확인을 받아 — 승인되면 진행, 거부면 중단. 성공하면 송장번호(regiNo)를 회신해.",
    "■ 이름이 여러 건이면 후보를 보여주고 어느 건인지 물어봐. 아무데도 없으면 그대로 알려줘. 1인=1박스=송장1개.",
  ].join("\n");
}
