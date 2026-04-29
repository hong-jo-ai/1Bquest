import type {
  ScheduleItem, InboxItem, Task, RevenueAction, RevenueGoal, BigEvent,
} from "./types";

export const MOCK_SCHEDULE: ScheduleItem[] = [
  { id: "s1", time: "14:00", title: "W컨셉 MD 미팅",         location: "강남 W컨셉 본사" },
  { id: "s2", time: "16:30", title: "패키지 디자이너 통화",  location: "전화" },
];

export const MOCK_INBOX: InboxItem[] = [
  { id: "i1", sender: "W컨셉 MD",  subject: "5월 가정의달 기획전 입점 제안", receivedLabel: "2시간 전", overdue: false },
  { id: "i2", sender: "무신사 PD", subject: "신상 컬러 이미지 누락 안내",     receivedLabel: "어제",     overdue: false },
  { id: "i3", sender: "@example",  subject: "인플루언서 협업 문의",           receivedLabel: "어제",     overdue: false },
  { id: "i4", sender: "고객",       subject: "주문 변경 요청",                receivedLabel: "3일 전",   overdue: true  },
];

export const MOCK_TASKS: Task[] = [
  { id: "t1", title: "KARI 다음 시즌 다이얼 컬러 컨펌 (인투와치 OEM 발주 전)", category: "design",  done: false },
  { id: "t2", title: "Meta 어제 광고 CPC 체크 + 수동 입찰가 조정",            category: "ads",     done: false },
  { id: "t3", title: "신규 광고 소재 1건 업로드 (가정의달 가격 강조)",          category: "ads",     done: false },
  { id: "t4", title: "채널톡 미답장 5건 처리",                                  category: "cs",      done: false },
  { id: "t5", title: "AS 접수건 1건 발송 처리",                                 category: "cs",      done: false },
  { id: "t6", title: "인스타 릴스 'I DO' 시리즈 다음 편 후크 작성",             category: "content", done: false },
  { id: "t7", title: "카카오선물하기 상세페이지 5월 시즌 카피 교체",            category: "content", done: false },
  { id: "t8", title: "무신사 베스트 상품 노출 순위 점검",                       category: "ops",     done: false },
  { id: "t9", title: "토스쇼핑 가정의달 캠페인 이미지 최종 검수",               category: "ops",     done: false },
];

export const MOCK_REVENUE_GOAL: RevenueGoal = {
  target:  50_000_000,
  current: 28_000_000,
};

export const MOCK_REVENUE_ACTIONS: RevenueAction[] = [
  { id: "r1", title: "Meta 신규 크리에이티브 1개 업로드", cadence: "주 3회", scope: "이번주", target: 3, done: 1 },
  { id: "r2", title: "인스타 릴스 1개 게시",              cadence: "주 2회", scope: "이번주", target: 2, done: 1 },
  { id: "r3", title: "카카오선물하기 신상품 1개 등록",      cadence: "주 1회", scope: "이번주", target: 1, done: 0 },
  { id: "r4", title: "W컨셉 메인배너 노출 신청",            cadence: "월 2회", scope: "이번달", target: 2, done: 1 },
];

export const MOCK_EVENTS: BigEvent[] = [
  {
    id: "e1",
    title: "5월 가정의달 공동구매",
    daysLeft: 21,
    checklist: [
      { id: "e1-1",  dDay: 30, title: "공구 상품 셀렉",                    done: true  },
      { id: "e1-2",  dDay: 25, title: "가격 정책 확정",                    done: true  },
      { id: "e1-3",  dDay: 21, title: "상세페이지 시안 1차",               done: true  },
      { id: "e1-4",  dDay: 18, title: "인플루언서 시딩 리스트업",           done: false, isToday: true },
      { id: "e1-5",  dDay: 14, title: "메타 광고 소재 4종 제작",            done: false },
      { id: "e1-6",  dDay: 10, title: "채널톡 자동응답 세팅",                done: false },
      { id: "e1-7",  dDay: 7,  title: "사전 알림 푸시/이메일 발송",          done: false },
      { id: "e1-8",  dDay: 3,  title: "재고 최종 점검",                      done: false },
      { id: "e1-9",  dDay: 1,  title: "랜딩페이지 최종 점검",                done: false },
      { id: "e1-10", dDay: 0,  title: "오픈",                                done: false },
    ],
  },
  {
    id: "e2",
    title: "PAULVICE x [협업 브랜드] 캡슐 컬렉션",
    daysLeft: 45,
    checklist: [
      { id: "e2-1", dDay: 45, title: "협업 브랜드 컨셉 정렬 미팅",          done: true  },
      { id: "e2-2", dDay: 40, title: "디자인 컨셉 시안 1차",                done: false },
      { id: "e2-3", dDay: 30, title: "샘플 발주",                            done: false },
      { id: "e2-4", dDay: 21, title: "상세페이지 카피 + 사진 촬영",          done: false },
      { id: "e2-5", dDay: 14, title: "사전 마케팅 콘텐츠 제작",              done: false },
      { id: "e2-6", dDay: 7,  title: "프리오더 페이지 오픈",                  done: false },
      { id: "e2-7", dDay: 3,  title: "오픈 D-3 리마인드 발송",                done: false },
      { id: "e2-8", dDay: 0,  title: "정식 오픈",                            done: false },
    ],
  },
];
