# 통합 고객 CS 인박스 기획서

작성일: 2026-04-12
대상 브랜드: 폴바이스(Paulwise), 해리엇(Harriot)
운영자: 1인 (홍성조)

---

## 1. 배경 & 문제

폴바이스/해리엇의 고객 문의는 현재 아래 채널에 분산되어 있다.

| # | 채널 | 폴바이스 | 해리엇 |
|---|---|---|---|
| 1 | 웹사이트 게시판 | 카페24 | 식스샵 |
| 2 | 카카오 플러스친구 상담톡 | ✅ | — |
| 3 | 채널톡 (Channel.io) | — | ✅ |
| 4 | Instagram DM | ✅ | ✅ |
| 5 | Instagram 게시물 댓글 | ✅ | ✅ |
| 6 | Threads 계정 (멘션/답글) | ✅ | ✅ |
| 7 | Gmail | plvekorea@gmail.com | harriotwatches@gmail.com |

합계 **12개 진입점**. 1인 운영 기준으로 모두 실시간 모니터링이 불가능하며, 문의 누락·답변 지연이 반복되고 있다.

### 목표
1. **한 화면에서** 모든 채널 문의를 확인할 수 있다.
2. **누락 방지**: 미응답 건이 자동으로 강조·알림된다.
3. **이 화면에서 바로 답장**할 수 있다 (가능한 채널부터 단계적).
4. **브랜드별 필터**: 폴바이스 / 해리엇 구분.

### 비목표 (초기 범위 밖)
- 다중 상담원 협업 (배정, 내부 메모)
- 고객 프로필/주문 이력 통합 (향후 확장)
- AI 자동 전송 (초안 제안은 1단계 포함, 자동 전송은 영구 비목표)

---

## 2. 제품 컨셉

기존 `paulwise-dashboard` 내에 **"인박스(Inbox)" 탭**을 추가한다. 별도 앱이 아니라 지금 쓰고 있는 Next.js 대시보드의 한 섹션으로 통합한다 — 배포/인증/운영 비용 최소화.

### 화면 구성 (3-pane 레이아웃)

```
┌─────────────┬──────────────────────┬──────────────────┐
│  좌측 필터   │   대화 목록 (가운데)   │   대화 상세(우측)  │
│             │                      │                  │
│ 상태        │ [🔴] 폴바이스 · IG DM │ 제목/발신자       │
│ □ 미답변    │   "배송 언제…"       │ 메시지 스레드     │
│ □ 답변완료  │   3분 전             │                  │
│ □ 보관      │                      │ [답장 입력창]     │
│             │ [🟡] 해리엇 · Gmail  │                  │
│ 브랜드      │   "환불 문의"        │                  │
│ □ 폴바이스  │   12분 전            │                  │
│ □ 해리엇    │                      │                  │
│             │ [✅] 폴바이스 · 카톡  │                  │
│ 채널        │   "사이즈…"          │                  │
│ □ Gmail     │   1시간 전           │                  │
│ □ IG DM     │                      │                  │
│ ...         │                      │                  │
└─────────────┴──────────────────────┴──────────────────┘
```

### 상태 라벨
- 🔴 **미답변** (received, 내가 아직 답 안 함)
- 🟡 **대기중** (내가 답했지만 고객이 재응답)
- ✅ **해결됨** (수동 close 또는 N일간 활동 없음)
- 📦 **보관**

### 우선순위 규칙
1. 미답변 중 오래된 순
2. 채널 가중치 (유료 고객 채널 = 카톡·채널톡·게시판이 SNS보다 우선)
3. 키워드 부스트 ("환불", "불량", "배송" 포함 시 상단 고정)

---

## 3. 아키텍처

### 3.1 전체 흐름

```
  [각 채널]           [Ingester Layer]        [Storage]         [UI]
  ─────────           ───────────────         ─────────         ────
  Gmail API    ──┐
  Threads API  ──┤
  IG Graph API ──┼─► Next.js API routes ──► Supabase (Postgres) ──► /inbox
  Channel.io   ──┤   (webhook + cron)         · messages
  카카오 상담톡 ──┤                            · threads
  웹 게시판 DB  ──┘                            · accounts
                                              · attachments
                       ▲
                       │
                    pg_cron / Vercel Cron
                    (polling 보완)
```

### 3.2 데이터 모델 (Supabase)

```sql
-- 통합 대화 스레드
create table cs_threads (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('paulwise','harriot')),
  channel text not null, -- gmail, ig_dm, ig_comment, threads, kakao, channeltalk, web_board
  external_thread_id text not null, -- 채널 고유 ID (gmail threadId, IG conversation id 등)
  customer_handle text,  -- 이메일/닉네임/IG username
  customer_name text,
  subject text,
  last_message_at timestamptz not null,
  last_message_preview text,
  status text not null default 'unanswered',
    -- unanswered | waiting | resolved | archived
  priority int not null default 0,
  unique (channel, external_thread_id)
);

-- 개별 메시지
create table cs_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references cs_threads(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  external_message_id text,
  body_text text,
  body_html text,
  sent_at timestamptz not null,
  raw jsonb, -- 원본 payload 보관
  created_at timestamptz default now()
);

-- 채널 계정 연결 정보 (토큰 등)
create table cs_accounts (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  channel text not null,
  display_name text,
  credentials jsonb, -- encrypted
  last_synced_at timestamptz,
  status text default 'active'
);

create index on cs_threads (status, last_message_at desc);
create index on cs_threads (brand, channel);
create index on cs_messages (thread_id, sent_at);
```

### 3.3 Ingester 패턴

채널별로 동일 인터페이스를 구현한다.

```ts
interface ChannelIngester {
  channel: string;
  brand: 'paulwise' | 'harriot';

  // 방식 1: webhook 엔드포인트
  handleWebhook?(req: Request): Promise<void>;

  // 방식 2: 주기 polling
  poll?(since: Date): Promise<void>;

  // 답장 전송
  sendReply(threadId: string, body: string): Promise<{ externalMessageId: string }>;
}
```

모든 ingester는 `upsertThread()` / `insertMessage()` 공통 헬퍼를 호출해 같은 테이블로 정규화한다.

---

## 4. 채널별 통합 방식

| 채널 | 수신 | 답장 | 난이도 | 비용 | 1단계 포함 |
|---|---|---|---|---|---|
| Gmail (2개) | Gmail API `history.list` + push webhook (Pub/Sub) | `messages.send` | 쉬움 | 무료 | ✅ |
| Threads (2개) | Threads API webhook (멘션·답글) + polling | Threads API publish | 쉬움 | 무료 | ✅ |
| Instagram DM | Meta Graph API webhook | Send API | 중간 | 무료 (앱 심사 필요) | 2단계 |
| Instagram 댓글 | Graph API webhook | Comment reply API | 중간 | 무료 (앱 심사 필요) | 2단계 |
| 채널톡 (해리엇) | Channel.io webhook | Channel.io API | 쉬움 | 기존 요금제 | 2단계 |
| 카페24 게시판 (폴바이스) | Cafe24 Admin API polling (`/api/v2/admin/boards/{id}/articles`) | 카페24 API로 댓글 POST (또는 어드민 딥링크) | 중간 | 무료 (Open API 승인) | 2단계 |
| 식스샵 게시판 (해리엇) | 식스샵은 공개 API 없음 → **관리자 알림 이메일을 Gmail로 포워딩** | 어드민 딥링크 | 쉬움 (우회) | 무료 | ✅ (Gmail 편승) |
| 카카오 상담톡 (폴바이스) | 카카오 비즈니스 상담톡 API | 상담톡 API | 어려움 | 유료 + 심사 | 3단계 |

### 4.1 Gmail

- **인증**: OAuth2, refresh token을 `cs_accounts.credentials`에 암호화 저장.
- **수신**: Gmail API의 `users.watch` → Google Pub/Sub → Next.js webhook. 실패 시 5분 주기 `history.list` polling fallback.
- **스레드 매핑**: Gmail `threadId` → `cs_threads.external_thread_id`.
- **답장**: `messages.send`에 `In-Reply-To` / `References` 헤더 세팅.
- **주의**: 스팸/광고 필터링 룰 필요 (뉴스레터·쇼핑몰 알림 제외).

### 4.2 Threads

- **수신**: Threads API의 replies·mentions webhook. 없는 이벤트는 5분 polling.
- **브랜드 구분**: 2개 계정이 각각 별도 `cs_accounts` row.
- **답장**: `/me/threads` POST.
- **참고**: 이 프로젝트에 이미 Threads 연동 코드가 있음 (`threads.env`, `config/threads-reply-guide.md`) → 재사용.

### 4.3 Instagram DM / 댓글

- **전제**: 두 브랜드 IG 계정이 **프로페셔널(비즈니스/크리에이터)** 계정 + **Facebook 페이지 연결** 완료되어 있어야 함.
- **수신**: Meta Graph API webhook (`messages`, `comments` 필드 구독).
- **앱 심사**: `instagram_manage_messages`, `pages_messaging` 등 권한은 앱 리뷰 필요 → 2단계로 미룬 이유.
- **답장 제약**: DM은 고객이 마지막 메시지 보낸 후 **24시간 내에만** 자유 답장 가능 (Meta 정책).

### 4.4 채널톡

- Channel.io에 **Webhook v2** 설정 → Next.js `/api/cs/ingest/channeltalk` 수신.
- 답장: Channel API `writeGroupMessage`.

### 4.5 카카오 상담톡

- **선결 조건**:
  1. 카카오 비즈니스 채널 개설 (이미 있음)
  2. **상담톡 파트너** 등록 (심사)
  3. 솔루션사 or 직접 연동 (API 스펙은 계약 후 공개)
- 가장 무거움 → MVP 이후 3단계.
- **1단계 우회책**: 카카오톡 채널 관리자 알림이 Gmail로 오도록 설정 → Gmail 인박스에 일단 쌓이게 함.

### 4.6 웹 게시판

#### 폴바이스 — 카페24
- **Cafe24 Open API** 사용 (OAuth 2.0).
- 필요 스코프: `mall.read_community` (게시판 읽기), `mall.write_community` (댓글 작성).
- 앱 등록: Cafe24 개발자센터에서 Private App 생성 → 관리자 계정으로 설치.
- 수신: `GET /api/v2/admin/boards/{board_no}/articles` 를 5분 polling, `created_date` 기준 증분 수집.
- 답장: 댓글 작성 API로 직접 POST 가능. 초기엔 안전하게 어드민 딥링크 + 초안 복사만 제공 후 안정화되면 자동 전송.

#### 해리엇 — 식스샵
- 식스샵은 일반 공개 API가 없음 (2026-04 기준). 확인된 우회책:
  1. **관리자 알림 메일 활용**: 식스샵 관리자 설정에서 신규 게시글/문의 알림을 `harriotwatches@gmail.com`으로 보내도록 설정 → Gmail ingester가 자동으로 인박스에 수집. **1단계부터 커버됨.**
  2. 알림 메일을 `From: 식스샵 알림`으로 식별해서 `channel='sixshop_board'`로 태깅, 본문에서 게시글 링크 추출.
  3. 답장은 어드민 페이지 딥링크 버튼으로 처리 (API 없음).
- 한계: 고객 원문을 메일 본문에서 파싱해야 함. 파싱 실패 시 "식스샵에서 확인 필요" 플래그.

---

## 5. CS Responder 스킬 통합

이미 작성된 `cs-responder` 스킬 (`~/Downloads/cs-responder/SKILL.md`)을 인박스의 **1차 시민**으로 통합한다. 이 스킬에는 이미 다음이 코드화돼 있어서 별도 프롬프트 엔지니어링 없이 재사용 가능하다:

- 브랜드별 톤앤매너 (폴바이스 이모지 존댓말 / 해리엇 격식체)
- 채널별 답변 길이 (이메일/게시판 = 풀, 채팅 = 간결)
- AS 정책 (무상 6개월, 수리 유형별 주소·연락처)
- 브랜드별 정책 (폴바이스 에끌라 재입고, 해리엇 각인/오프라인 매장/해외 고객)
- 언어 자동 판별 (한/영)
- 정책 외 내용 금지 (hallucination 방지 규칙 포함)

### 통합 방식

1. **스킬 파일 이전**: `~/Downloads/cs-responder/`를 이 repo 내부로 옮겨 버전 관리.
   - 제안 경로: `config/skills/cs-responder/SKILL.md`
   - 이유: 정책 변경 시 git diff로 추적, 배포와 동기화.

2. **Draft API 엔드포인트**: `POST /api/cs/draft`
   ```ts
   // request
   { threadId: string }
   // 서버가 thread + 최근 메시지들을 로드하고
   // cs-responder 스킬 프롬프트 + 정책 본문을 조립해서
   // Claude API(claude-opus-4-6)로 호출
   // response
   { draft: string, rationale: string, needsConfirmation?: string[] }
   ```

3. **입력 자동 채움**: 스킬이 요구하는 메타데이터(브랜드·채널)는 `cs_threads.brand` / `cs_threads.channel` 에서 자동 주입 → 사용자가 매번 "폴바이스 답변해줘" 타이핑할 필요 없음.

4. **UI 동작**:
   - 대화 상세 패널의 답장창 위에 `[AI 초안 ✨]` 버튼.
   - 클릭 → 로딩 → 입력창에 초안 프리필 + 하단에 `[참고]` 박스로 판단 근거·확인 필요 사항 표시.
   - 사용자가 그대로 보내거나 수정 후 전송. **자동 전송은 절대 하지 않음** (스킬의 "정책 외 내용 생성 금지" 규칙과 일치).

5. **안전장치**:
   - 스킬의 "확인 필요" 플래그가 나오면 답장 버튼을 노란색 경고 상태로 전환.
   - 초안에 매장 주소·연락처·금액 같은 구체 정보가 포함되면 UI에서 하이라이트해서 사람이 한 번 더 읽도록 유도.

6. **정책 데이터의 단일 출처**: 스킬 SKILL.md가 **유일한** 정책 원본. 인박스 코드에 AS 주소나 가격을 하드코딩하지 않는다. 정책이 바뀌면 SKILL.md만 수정.

---

## 6. 알림 & 누락 방지

1. **미답변 SLA 타이머**: 수신 후 2시간 지나면 대시보드 상단에 빨간 배너 + 카운트.
2. **모바일 푸시**: Telegram Bot 또는 Slack 개인 DM으로 "폴바이스 IG DM 새 문의" 전송 (가장 싸고 빠름).
3. **일 1회 다이제스트**: 매일 아침 09:00 "어제 미응답 N건, 오늘 처리 필요" 이메일.
4. **자리비움 모드**: 수동 토글 — 켜지면 자동응답 메시지 전송 (채널별 지원 범위 내).

---

## 7. 단계별 로드맵

### 1단계 — MVP (2–3주)
**목표**: "한 화면에서 Gmail 2개 + Threads 2개 + 식스샵(Gmail 편승) 통합 확인 + AI 초안으로 답장"

- [ ] Supabase 스키마 생성 (`cs_threads`, `cs_messages`, `cs_accounts`)
- [ ] `/app/inbox` 라우트 + 3-pane UI
- [ ] Gmail ingester (webhook + polling fallback)
  - [ ] 식스샵 관리자 알림 메일 자동 태깅 (`channel='sixshop_board'`)
- [ ] Threads ingester (기존 코드 재사용)
- [ ] 답장 전송 (Gmail, Threads)
- [ ] **CS Responder 스킬 통합**: "AI 초안 생성" 버튼 → 기존 스킬 호출 → 결과를 답장 입력창에 프리필 (§5 참고)
- [ ] 상태 전환 (미답변 → 해결됨)
- [ ] Telegram 알림 봇
- [ ] 브랜드 필터

**검증 질문**: 1주일 운영해서 실제로 "놓친 문의 수 < 기존"인가?

### 2단계 — SNS & 카페24 (3–4주)
- [ ] Meta 앱 생성 + 리뷰 신청 (IG DM/댓글)
- [ ] 채널톡 webhook 연동
- [ ] 카페24 Open API ingester (폴바이스 게시판)
- [ ] IG 24시간 창 경고 UI

### 3단계 — 카카오 상담톡 (4주+)
- [ ] 상담톡 파트너 등록 진행
- [ ] API 스펙 받고 ingester 구현
- [ ] 폴바이스 1단계 우회책 제거

### 4단계 — 지능화 (선택)
- [ ] 주문/고객 정보 사이드패널 (카페24/식스샵 주문 조회)
- [ ] FAQ 자동 분류 + 초안 정확도 피드백 루프
- [ ] 자리비움 자동응답 템플릿

---

## 8. 기술 스택 결정

| 항목 | 선택 | 이유 |
|---|---|---|
| 프레임워크 | 기존 Next.js (이 repo) | 재사용, 인증/배포 공유 |
| DB | Supabase Postgres (✅ 사용 중 확인됨) | 이 대시보드가 이미 사용. RLS로 브랜드 격리. |
| 배포 | Vercel | Cron + webhook 핸들러 |
| 백그라운드 | Vercel Cron (5분/15분/1시간) | 간단. 복잡해지면 Inngest 고려. |
| 알림 | Telegram Bot (✅ 확정) | 무료, 즉시 |
| AI 초안 | Claude API (claude-opus-4-6) + cs-responder 스킬 | 정책·톤이 이미 코드화됨 |
| 시크릿 | Vercel env + Supabase vault | 토큰 암호화 |

---

## 9. 리스크 & 미해결 질문

1. **카카오 상담톡 API 접근성** — 심사 기간/비용이 불확실. 1단계에서 Gmail 포워딩 우회책 필수.
2. **IG 앱 심사 기간** — Meta 리뷰가 2~6주 걸림. 2단계 일정 영향.
3. **식스샵 파싱 정확도** — 관리자 알림 메일 템플릿이 바뀌면 파싱 깨질 수 있음. 템플릿을 고정 상수로 저장하고, 파싱 실패 시 원문 그대로 보여주고 경고.
4. **스팸 필터** — Gmail에 마케팅/주문알림 메일이 많을 것. 초기엔 송신자 블랙리스트 + 식스샵 알림 화이트리스트로 시작.
5. **오프라인 복구** — webhook 유실 시 어디까지 거슬러 올라가 polling할지 (기본 7일 제안).
6. **AI 초안 레이턴시** — Opus는 10–20초 걸릴 수 있음. 버튼 클릭 시 즉시 스트리밍 표시, 백그라운드 선제 생성은 하지 않음 (비용/정책 이슈).

---

## 10. 확정된 전제 & 다음 액션

### 확정됨 (2026-04-12)
- ✅ 웹 게시판: 폴바이스 = **카페24**, 해리엇 = **식스샵**
- ✅ DB: 기존 **Supabase** 재사용
- ✅ 알림: **Telegram 봇**
- ✅ 1단계 범위: Gmail 2 + Threads 2 + (편승) 식스샵 알림 메일
- ✅ AI 초안: 기존 `cs-responder` 스킬 재사용 (1단계 포함)

### 착수 전 한 가지 선택
**cs-responder 스킬을 이 repo로 이전할까요?** (`config/skills/cs-responder/SKILL.md`)
- 이전 O → 배포와 정책이 동기화됨. 권장.
- 이전 X → `~/Downloads` 원본을 계속 참조. Vercel 배포에서는 접근 불가 → 결국 이전 필요.

확인 주시면 1단계 스키마 마이그레이션부터 바로 착수할게요.
