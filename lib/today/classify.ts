/**
 * 클로드 코드 세션 한 건을 4개 영역 중 하나로 분류한다.
 *
 * 판단 재료가 두 개인데, 어느 쪽을 먼저 믿을지는 제목의 출처에 따라 다르다.
 *   - ai-title 이 있는 세션: 제목이 그 세션의 요약이라 키워드가 신뢰할 만하다 → 키워드 우선.
 *     paulwise-dashboard 안에서 해리엇 일을 하는 경우가 많아(실측: "해리엇 설월 상세페이지 작업")
 *     디렉토리만으로는 못 가르기 때문에 이쪽이 중요하다.
 *   - ai-title 이 없어 첫 발화를 그대로 쓴 세션: 원문에는 온갖 단어가 섞여 있어 키워드가
 *     엉뚱하게 걸린다(실측: "…아르스오케스트라, 개인 이렇게…" 한 줄 때문에 아르스로 분류됨)
 *     → 키워드를 아예 안 쓰고 디렉토리만 본다. 못 가르면 기본값으로 두는 편이,
 *       스쳐 지나간 단어 하나로 엉뚱한 컬럼에 꽂히는 것보다 낫다.
 *
 * 분류가 틀리면 화면에서 도메인 칩을 눌러 고칠 수 있고, 그 결과는
 * kv_store 의 today:domain_overrides 에 쌓여 다음 스캔부터 우선 적용된다.
 */
import type { Domain, RawSession } from "./types";

/** 제목에서 찾는 키워드. 위에 있는 규칙이 먼저 이긴다. */
const TITLE_RULES: Array<{ domain: Domain; side?: boolean; words: string[] }> = [
  // 개인 — 모임·생활. 업무 키워드보다 먼저 걸러야 "독서모임 발제" 같은 게 안 샌다.
  { domain: "personal", words: ["독서모임", "북클럽", "bookclub", "중진공", "글로벌퓨쳐스", "유치원", "결혼식", "가족"] },
  // 아르스 — 오케스트라 운영
  { domain: "ars", words: ["단원", "회비", "출석", "연습", "합주", "지휘", "연주회", "악보", "오케스트라", "필하모닉", "토요음악단"] },
  // 해리엇
  { domain: "harriot", words: ["해리엇", "harriot", "조선몰", "성산", "서해랑", "설월", "기원", "ki:won"] },
  // 폴바이스
  { domain: "paulvice", words: ["폴바이스", "paulvice", "plve", "에끌라", "미니엘쁘띠", "켈리"] },
];

/** 프로젝트 디렉토리 기본값. 접미사 매칭이라 worktree 사본도 같이 잡힌다. */
const DIR_RULES: Array<{ match: string; domain: Domain; side?: boolean }> = [
  { match: "arsphil",                  domain: "personal", side: true },
  { match: "1-bookclub",               domain: "personal" },
  { match: "harriotwatches-website",   domain: "harriot" },
  { match: "paulvice-creative-engine", domain: "paulvice" },
  { match: "paulwise-dashboard",       domain: "paulvice" },
];

/** arsphil 안에서 개발 작업과 오케스트라 운영 작업을 가른다. */
const ARS_OPS_WORDS = ["단원", "회비", "출석", "연습", "합주", "공지", "명단", "좌석", "악보"];

export interface Classification {
  domain: Domain;
  /** 개인 영역의 사이드 프로젝트(개발) 트랙인지 */
  side: boolean;
}

export function classifySession(
  s: Pick<RawSession, "projectDir" | "title" | "titled">,
  overrides: Record<string, Domain> = {},
): Classification {
  const dir   = s.projectDir.toLowerCase();
  const title = (s.title || "").toLowerCase();

  const byTitle = (): Classification | null => {
    for (const rule of TITLE_RULES) {
      if (rule.words.some((w) => title.includes(w))) {
        return { domain: rule.domain, side: rule.side ?? false };
      }
    }
    return null;
  };
  const byDir = (): Classification | null => {
    for (const rule of DIR_RULES) {
      if (dir.endsWith(rule.match) || dir.includes(rule.match + "-")) {
        return { domain: rule.domain, side: rule.side ?? false };
      }
    }
    return null;
  };

  // arsphil 은 한 코드베이스에 개발과 운영이 같이 산다. 운영 신호가 있으면 아르스로.
  if (dir.includes("arsphil")) {
    const isOps = ARS_OPS_WORDS.some((w) => title.includes(w));
    return isOps ? { domain: "ars", side: false } : { domain: "personal", side: true };
  }

  const override = overrides[s.projectDir];
  if (override) return { domain: override, side: override === "personal" };

  // 루트(-Users-mac-sungjo-ai)처럼 어디에도 안 걸리는 세션은 매출 쪽 기본값으로 둔다.
  const guess = s.titled ? byTitle() ?? byDir() : byDir();
  return guess ?? { domain: "paulvice", side: false };
}
