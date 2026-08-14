export const SYNODIC_MONTH = 29.530588853;
export const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);
export const CANONICAL_PAGE = "https://harriotwatches.co.kr/seolwol/index.html";

export type PhaseKey = "new" | "crescent" | "half" | "waxing" | "full" | "waning" | "lastHalf" | "balsamic";
export type Occasion = "birth" | "love" | "promise" | "departure" | "travel" | "longing" | "flutter" | "waiting" | "alone" | "restart" | "farewell" | "unsaid";

export type MoonData = {
  age: number;
  phase: number;
  illumination: number;
  label: string;
  fact: string;
  phaseKey: PhaseKey;
};

export const OCCASIONS: Array<{ value: Occasion; label: string }> = [
  { value: "birth", label: "누군가 태어난 밤" },
  { value: "love", label: "사랑을 시작한 밤" },
  { value: "promise", label: "약속을 나눈 밤" },
  { value: "departure", label: "새로운 길을 떠난 밤" },
  { value: "travel", label: "여행의 마지막 밤" },
  { value: "longing", label: "누군가 보고 싶은 밤" },
  { value: "flutter", label: "설레던 밤" },
  { value: "waiting", label: "오래 기다리던 밤" },
  { value: "alone", label: "혼자였던 밤" },
  { value: "restart", label: "다시 시작하기로 한 밤" },
  { value: "farewell", label: "누군가와 헤어진 밤" },
  { value: "unsaid", label: "말로 정하기 어려운 밤" },
];

export function isOccasion(value: string | null): value is Occasion {
  return OCCASIONS.some((o) => o.value === value);
}

export function occasionLabelOf(value: Occasion): string {
  return OCCASIONS.find((o) => o.value === value)?.label ?? "";
}

export function getMoonData(dateString: string): MoonData {
  const [year, month, day] = dateString.split("-").map(Number);
  const nightInKorea = Date.UTC(year, month - 1, day, 12);
  const days = (nightInKorea - NEW_MOON_EPOCH) / 86_400_000;
  const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const phase = age / SYNODIC_MONTH;
  const illumination = (1 - Math.cos(phase * Math.PI * 2)) / 2;

  let label = "차오르는 달";
  let phaseKey: PhaseKey = "waxing";
  if (age < 1.3 || age > 28.3) { label = "새달"; phaseKey = "new"; }
  else if (age < 6.4) { label = "가느다란 초승달"; phaseKey = "crescent"; }
  else if (age < 8.8) { label = "반달"; phaseKey = "half"; }
  else if (age < 13.5) { label = "보름을 향하는 달"; phaseKey = "waxing"; }
  else if (age < 16.1) { label = "보름달"; phaseKey = "full"; }
  else if (age < 21.0) { label = "천천히 기우는 달"; phaseKey = "waning"; }
  else if (age < 23.4) { label = "기우는 반달"; phaseKey = "lastHalf"; }
  else { label = "새달을 향하는 달"; phaseKey = "balsamic"; }

  const toFull = Math.max(0, Math.round(SYNODIC_MONTH / 2 - age));
  const sinceFull = Math.max(0, Math.round(age - SYNODIC_MONTH / 2));
  const toNew = Math.max(1, Math.round(SYNODIC_MONTH - age));
  let fact = `달빛은 약 ${Math.round(illumination * 100)}% 차 있었습니다.`;
  if (age < 13.5) fact = `${toFull || 1}일 뒤면 보름이 되는, 아직 차오르는 중인 달이었습니다.`;
  else if (age <= 16.1) fact = "달이 가장 둥근 때에 아주 가까운 밤이었습니다.";
  else if (age < 23.4) fact = `보름을 지난 지 ${sinceFull || 1}일, 달빛이 천천히 작아지던 밤이었습니다.`;
  else fact = `${toNew}일 뒤면 다시 보이지 않게 되는, 가만히 기우는 달이었습니다.`;

  return { age, phase, illumination, label, fact, phaseKey };
}

export function formatKoreanDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일 밤`;
}
