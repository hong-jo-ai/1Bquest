/**
 * 입금 SMS 의 계좌 → 용도(role) 판별.
 *
 * 2026-08-25 개인 계좌(849-172944-02-001)에도 입출금 알림을 켜면서 필요해졌다.
 * 그전엔 알림 오는 계좌가 주 사업계좌(1002) 하나뿐이라 "입금 SMS = 고객 결제"
 * 가정이 성립했지만, 이제 개인 입금이 같은 파이프라인으로 들어온다. 계좌를 안
 * 가리면 개인 입금이 미결제 주문과 금액이 맞아떨어져 자동 입금확인되거나, AS
 * 수리비로 오인돼 **우체국 송장이 실제로 발급**된다. 둘 다 되돌리기 어렵다.
 *
 * 설정(.env) — 계좌번호는 형식 무관(하이픈·공백 아무렇게나), 여러 개면 콤마:
 *   BANK_ACCOUNT_ORDERS=1002-166-097664   ← 카페24 무통장 자동 입금확인 허용
 *   BANK_ACCOUNT_AS=1002-166-097664       ← AS 수리비 자동 송장발급 허용
 *   BANK_ACCOUNT_PERSONAL=849-172944-02-001  ← 개인 계좌. 알림만, P&L 대상 아님
 *
 * 어디에도 없는 계좌는 "미등록"으로 알림만 간다 — 모르는 계좌를 자동처리하는
 * 것보다 사장님이 한 번 보고 분류하는 편이 안전하다.
 *
 * 미설정이면 예전처럼 전 계좌 허용(후방호환). 배포 시점과 env 주입 시점이
 * 어긋나도 기존 동작이 죽지 않게 한 것이고, 호출부가 경고를 남긴다.
 */

/** 계좌번호 비교용 정규화 — 하이픈·공백·마스킹(*) 제거하고 숫자만. */
export function accountDigits(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** 콤마 구분 env → 정규화된 계좌 목록. */
function parseAccountList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => accountDigits(s))
    .filter((s) => s.length >= SUFFIX_MIN);
}

/**
 * SMS 는 계좌를 마스킹해서 보낸다(`*097664`). 뒷자리만 오므로 suffix 비교.
 * 4자리 미만은 우연 일치가 너무 쉬워 매칭하지 않는다.
 */
const SUFFIX_MIN = 4;

export function accountMatches(smsAccount: string | null, configured: string): boolean {
  const a = accountDigits(smsAccount);
  const b = accountDigits(configured);
  if (a.length < SUFFIX_MIN || b.length < SUFFIX_MIN) return false;
  return a.length <= b.length ? b.endsWith(a) : a.endsWith(b);
}

export interface AccountRoles {
  /** 카페24 무통장 주문 자동 입금확인 대상 계좌인가. */
  orders: boolean;
  /** AS 수리비 자동 송장발급 대상 계좌인가. */
  as: boolean;
  /** 개인 계좌인가. 자동처리 안 하고 P&L 에도 넣지 않는다. */
  personal: boolean;
  /** env 에 계좌 설정이 하나라도 있는가(false 면 후방호환 모드로 전부 허용됨). */
  configured: boolean;
  /** 설정된 계좌 중 하나와 일치했는가. false = 미등록 계좌. */
  known: boolean;
  /** 텔레그램 알림에 쓸 사람이 읽는 이름. */
  label: string;
}

/**
 * 계좌 → 허용 role. `account` 가 null(구형 SMS·파싱 실패)이면 계좌를 특정할 수
 * 없으므로 **자동 처리 금지**(설정이 있는 경우). 모르면 안 하는 쪽이 안전하다.
 */
export function resolveAccountRoles(account: string | null): AccountRoles {
  const orders = parseAccountList(process.env.BANK_ACCOUNT_ORDERS);
  const as = parseAccountList(process.env.BANK_ACCOUNT_AS);
  const personal = parseAccountList(process.env.BANK_ACCOUNT_PERSONAL);
  const configured = orders.length > 0 || as.length > 0 || personal.length > 0;

  if (!configured) {
    // 후방호환 — 계좌 설정 전 배포된 상태. 기존처럼 전부 허용.
    return { orders: true, as: true, personal: false, configured: false, known: false, label: "계좌 미설정" };
  }

  const isOrders = orders.some((c) => accountMatches(account, c));
  const isAs = as.some((c) => accountMatches(account, c));
  const isPersonal = personal.some((c) => accountMatches(account, c));

  // 개인 계좌가 주문·AS 계좌로도 등록돼 있으면 설정 실수다. 자동처리를 막는 쪽으로 판정.
  const safeOrders = isOrders && !isPersonal;
  const safeAs = isAs && !isPersonal;

  const label = isPersonal
    ? "개인 계좌"
    : safeOrders || safeAs
      ? "사업 계좌"
      : account
        ? "미등록 계좌"
        : "계좌 못 읽음";

  return {
    orders: safeOrders,
    as: safeAs,
    personal: isPersonal,
    configured: true,
    known: isOrders || isAs || isPersonal,
    label,
  };
}
