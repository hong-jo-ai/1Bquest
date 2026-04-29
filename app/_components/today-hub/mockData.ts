import type {
  Task, RevenueAction, RevenueGoal, BigEvent,
} from "./types";
import { kstDateStr, kstWeekStartStr } from "./dateUtils";

// ── 외부 약속(구글 캘린더), 답장 필요(Gmail) 모두 v3 실연동 — mock 없음 ──

// ── seed: 서버에 데이터 없을 때 첫 진입에 보여줄 초기값 ──

export const SEED_TASKS: Task[] = (() => {
  const today = kstDateStr(0);
  return [
    { id: "t1", title: "KARI 다음 시즌 다이얼 컬러 컨펌 (인투와치 OEM 발주 전)", category: "design",  done: false, date: today },
    { id: "t2", title: "Meta 어제 광고 CPC 체크 + 수동 입찰가 조정",            category: "ads",     done: false, date: today },
    { id: "t3", title: "신규 광고 소재 1건 업로드 (가정의달 가격 강조)",          category: "ads",     done: false, date: today },
    { id: "t4", title: "채널톡 미답장 5건 처리",                                  category: "cs",      done: false, date: today },
    { id: "t5", title: "AS 접수건 1건 발송 처리",                                 category: "cs",      done: false, date: today },
    { id: "t6", title: "인스타 릴스 'I DO' 시리즈 다음 편 후크 작성",             category: "content", done: false, date: today },
    { id: "t7", title: "카카오선물하기 상세페이지 5월 시즌 카피 교체",            category: "content", done: false, date: today },
    { id: "t8", title: "무신사 베스트 상품 노출 순위 점검",                       category: "ops",     done: false, date: today },
    { id: "t9", title: "토스쇼핑 가정의달 캠페인 이미지 최종 검수",               category: "ops",     done: false, date: today },
  ];
})();

/** paulvice 브랜드 초기 시드. harriot 은 빈 배열에서 시작. */
export const SEED_ROUTINES_PAULVICE: RevenueAction[] = (() => {
  const week  = kstWeekStartStr();
  const month = kstDateStr(0).slice(0, 7);
  return [
    { id: "r1", title: "Meta 신규 크리에이티브 1개 업로드", cadence: "주 3회", scope: "이번주", cadenceType: "weekly",  target: 3, done: 0, periodKey: week  },
    { id: "r2", title: "인스타 릴스 1개 게시",              cadence: "주 2회", scope: "이번주", cadenceType: "weekly",  target: 2, done: 0, periodKey: week  },
    { id: "r3", title: "카카오선물하기 신상품 1개 등록",      cadence: "주 1회", scope: "이번주", cadenceType: "weekly",  target: 1, done: 0, periodKey: week  },
    { id: "r4", title: "W컨셉 메인배너 노출 신청",            cadence: "월 2회", scope: "이번달", cadenceType: "monthly", target: 2, done: 0, periodKey: month },
  ];
})();

export const SEED_GOAL_PAULVICE: RevenueGoal = { target: 50_000_000 };
export const SEED_GOAL_HARRIOT:  RevenueGoal = { target:  5_000_000 };

/** paulvice 브랜드 초기 시드. harriot 은 빈 배열에서 시작. */
export const SEED_EVENTS_PAULVICE: BigEvent[] = (() => {
  // 가정의달 공구: D-18 항목이 오늘 마감되도록 targetDate = today + 18d
  const targetGB      = kstDateStr(18);
  const targetCapsule = kstDateStr(45);
  return [
    {
      id: "e1",
      title: "5월 가정의달 공동구매",
      targetDate: targetGB,
      checklist: [
        { id: "e1-1",  dDay: 30, title: "공구 상품 셀렉",                 done: true  },
        { id: "e1-2",  dDay: 25, title: "가격 정책 확정",                 done: true  },
        { id: "e1-3",  dDay: 21, title: "상세페이지 시안 1차",            done: true  },
        { id: "e1-4",  dDay: 18, title: "인플루언서 시딩 리스트업",        done: false },
        { id: "e1-5",  dDay: 14, title: "메타 광고 소재 4종 제작",         done: false },
        { id: "e1-6",  dDay: 10, title: "채널톡 자동응답 세팅",            done: false },
        { id: "e1-7",  dDay: 7,  title: "사전 알림 푸시/이메일 발송",       done: false },
        { id: "e1-8",  dDay: 3,  title: "재고 최종 점검",                   done: false },
        { id: "e1-9",  dDay: 1,  title: "랜딩페이지 최종 점검",             done: false },
        { id: "e1-10", dDay: 0,  title: "오픈",                              done: false },
      ],
    },
    {
      id: "e2",
      title: "PAULVICE x [협업 브랜드] 캡슐 컬렉션",
      targetDate: targetCapsule,
      checklist: [
        { id: "e2-1", dDay: 45, title: "협업 브랜드 컨셉 정렬 미팅",        done: true  },
        { id: "e2-2", dDay: 40, title: "디자인 컨셉 시안 1차",              done: false },
        { id: "e2-3", dDay: 30, title: "샘플 발주",                          done: false },
        { id: "e2-4", dDay: 21, title: "상세페이지 카피 + 사진 촬영",        done: false },
        { id: "e2-5", dDay: 14, title: "사전 마케팅 콘텐츠 제작",            done: false },
        { id: "e2-6", dDay: 7,  title: "프리오더 페이지 오픈",                done: false },
        { id: "e2-7", dDay: 3,  title: "오픈 D-3 리마인드 발송",              done: false },
        { id: "e2-8", dDay: 0,  title: "정식 오픈",                          done: false },
      ],
    },
  ];
})();
