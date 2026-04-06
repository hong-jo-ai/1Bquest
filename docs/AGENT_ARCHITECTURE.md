# PAULVICE 홈페이지 통합관리 에이전트 팀 아키텍처

> **버전:** v1.0
> **작성일:** 2026-04-02
> **목표:** 9개 AI 에이전트가 유기적으로 연동하여 매출 극대화
> **텍스트/분석:** Claude | **이미지 생성:** Gemini 3.1 Pro

---

## 1. 시스템 개요

### 1.1 비전

폴바이스 온라인 스토어의 모든 운영 업무를 AI 에이전트 팀이 유기적으로 수행한다.
저조 상품 감지 → 원인 분석 → 프로모션 기획 → 콘텐츠 생성 → 배포 → 성과 측정 → 재조정까지
**자동 피드백 루프**로 운영된다.

### 1.2 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **에이전트 = .md 스킬 파일** | 각 에이전트는 SKILL.md로 정의. 프롬프트 기반으로 동작하여 비개발자도 수정 가능 |
| **이벤트 기반 연동** | 에이전트 간 직접 호출 X. 이벤트를 발행하고 오케스트레이터가 조율 |
| **기존 코드 최대 재사용** | cafe24Client, ga4Client, metaClient, syncStorage 등 그대로 활용 |
| **Claude = 텍스트, Gemini = 이미지** | 명확한 역할 분리 |
| **측정 → 평가 → 조정** | 모든 액션은 성과 측정 후 자동 피드백 |

---

## 2. 에이전트 팀 구조도

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       ORCHESTRATOR (오케스트레이터)                       │
│             전체 에이전트 조율 / 워크플로우 트리거 / 우선순위 결정           │
│                      매출 목표 기반 자동 태스크 분배                       │
└──────────────┬───────────────────────────────────────┬──────────────────┘
               │                                       │
    ┌──────────▼──────────┐               ┌────────────▼────────────┐
    │  DATA COLLECTOR     │               │  RESEARCH ANALYST       │
    │  정보수집 에이전트    │◄─────────────►│  리서치 에이전트          │
    ├─────────────────────┤               ├─────────────────────────┤
    │ Cafe24 매출/주문     │               │ 저조 상품 원인 분석      │
    │ GA4 트래픽/전환      │               │ 경쟁사 가격/트렌드       │
    │ Meta 광고 성과       │               │ 시즌 키워드 분석         │
    │ 재고/입출고 동기화    │               │ 고객 리뷰 감성 분석      │
    │ 고객 행동 데이터      │               │ 시계 시장 트렌드         │
    └──────────┬──────────┘               └────────────┬────────────┘
               │                                       │
               └───────────────┬───────────────────────┘
                               │
                     ┌─────────▼──────────┐
                     │  STRATEGY PLANNER  │
                     │  전략기획 에이전트   │
                     ├────────────────────┤
                     │ 주간 매출 목표 수립  │
                     │ 프로모션 기획/일정   │
                     │ A/B 테스트 설계     │
                     │ ROI 예측 & 평가     │
                     └─────────┬──────────┘
                               │
         ┌─────────────────────┼──────────────────────┐
         │                     │                      │
┌────────▼────────┐  ┌────────▼─────────┐  ┌─────────▼─────────┐
│  COPYWRITER     │  │  DESIGNER        │  │  MERCHANDISER     │
│  카피라이팅      │  │  디자인 에이전트   │  │  머천다이징        │
├─────────────────┤  ├──────────────────┤  ├───────────────────┤
│ 상세페이지 카피   │  │ 상세페이지 이미지  │  │ 카테고리 진열순서  │
│ 배너 카피        │  │ (Gemini 3.1 Pro) │  │ 메인페이지 구성    │
│ 프로모션 문구    │  │ 배너 이미지       │  │ 추천상품 배치     │
│ SEO 메타 태그    │  │ SNS 콘텐츠       │  │ 가격 전략         │
│ 상품명 최적화    │  │ 썸네일 리디자인   │  │ 번들/세트 구성    │
└────────┬────────┘  └────────┬─────────┘  └─────────┬─────────┘
         │                    │                      │
         └────────────────────┼──────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  MARKETING         │
                    │  마케팅 에이전트     │
                    ├────────────────────┤
                    │ Meta 광고 소재 배포  │
                    │ 인스타 콘텐츠 발행   │
                    │ 프로모션 실행/모니터  │
                    │ 리타겟팅 세그먼트    │
                    │ 인플루언서 협업      │
                    └─────────┬──────────┘
                              │
               ┌──────────────┼──────────────┐
               │                             │
     ┌─────────▼──────────┐       ┌──────────▼──────────┐
     │  PRODUCT DEV       │       │  PROMPT ENGINEER    │
     │  상품개발 에이전트   │       │  프롬프팅 에이전트    │
     ├────────────────────┤       ├─────────────────────┤
     │ 신상품 아이디어      │       │ Gemini 이미지 프롬프트│
     │ 상품 조합 제안      │       │ Claude 텍스트 프롬프트│
     │ 경쟁 상품 갭 분석   │       │ 프롬프트 버전 관리    │
     │ 고객 니즈 기반 기획  │       │ 품질 평가 & 최적화   │
     │ 소싱 키워드 추천    │       │ A/B 테스트 관리      │
     └────────────────────┘       └─────────────────────┘
```

### 피드백 루프

```
┌──────────────────────────────────────────────────────────────┐
│                    FEEDBACK LOOP (자동 성과 루프)               │
│                                                              │
│  [실행 전 KPI 스냅샷]                                         │
│       │                                                      │
│       ▼                                                      │
│  [에이전트 액션 실행] ─── 카피 + 디자인 + 머천다이징 + 마케팅     │
│       │                                                      │
│       ▼                                                      │
│  [대기: 6h / 48h / 7d]                                       │
│       │                                                      │
│       ▼                                                      │
│  [KPI 재측정] ─── 매출, 주문수, ROAS, CTR, 전환율, 재고 소진   │
│       │                                                      │
│       ▼                                                      │
│  [Claude 델타 분석]                                           │
│       │                                                      │
│       ├── 효과적 → 기록 & 유지                                │
│       └── 비효과적 → 전략기획 재트리거 (최대 3회 → 사람 리뷰)    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 에이전트 .md 스킬 파일 구조

각 에이전트는 `.md` 파일로 정의된다. Claude Code의 `scheduled-tasks`처럼 프롬프트 기반으로 동작한다.

### 디렉토리 구조

```
paulwise-dashboard/
  agents/
    orchestrator/
      SKILL.md              ← 오케스트레이터 (전체 조율)
    data-collector/
      SKILL.md              ← 정보수집 에이전트
    research-analyst/
      SKILL.md              ← 리서치 에이전트
    strategy-planner/
      SKILL.md              ← 전략기획 에이전트
    copywriter/
      SKILL.md              ← 카피라이팅 에이전트
    designer/
      SKILL.md              ← 디자인 에이전트
    marketing/
      SKILL.md              ← 마케팅 에이전트
    merchandiser/
      SKILL.md              ← 머천다이징 에이전트
    product-dev/
      SKILL.md              ← 상품개발 에이전트
    prompt-engineer/
      SKILL.md              ← 프롬프팅 에이전트
    workflows/
      daily-optimization.md     ← 일일 최적화
      underperformer-rescue.md  ← 저조 상품 구출
      inventory-aging.md        ← 재고 에이징 긴급 조치
      weekly-product-dev.md     ← 주간 상품 개발
      content-pipeline.md       ← 콘텐츠 파이프라인
```

### SKILL.md 기본 포맷

```markdown
---
name: 에이전트명
description: 한 줄 설명
type: agent
llm: claude | gemini | none
triggers:
  - event: "이벤트명"
  - schedule: "cron 표현식"
  - manual: true
outputs:
  - event: "발행할 이벤트명"
depends_on:
  - data-collector
  - research-analyst
tools:
  - cafe24_api
  - ga4_api
  - meta_api
  - supabase_kv
  - gemini_image
---

# 에이전트 시스템 프롬프트

당신은 PAULVICE(폴바이스)의 [역할] 에이전트입니다.
[상세 지시사항...]

## 입력 데이터
[어떤 데이터를 받는지]

## 수행 작업
[구체적으로 무엇을 하는지]

## 출력 형식
[JSON 등 출력 포맷]

## 브랜드 가이드라인
[PAULVICE 브랜드 컨텍스트]
```

---

## 4. 에이전트별 상세 명세

### 4.1 정보수집 에이전트 (Data Collector)

| 항목 | 내용 |
|------|------|
| **ID** | `data-collector` |
| **LLM** | 없음 (데이터 수집/정규화만) |
| **트리거** | 스케줄 매일 09:00 KST, 수동 |
| **이벤트 발행** | `data.refreshed`, `data.anomaly.detected` |

**기존 코드 매핑:**

| 도구 | 재사용 파일 | 함수 |
|------|------------|------|
| Cafe24 매출 수집 | `lib/cafe24Data.ts` | `getDashboardData()`, `fetchAllOrders()`, `buildRanking()` |
| GA4 트래픽 수집 | `lib/ga4Client.ts` | `fetchGa4Data()` |
| Meta 광고 수집 | `lib/metaClient.ts` + `lib/metaData.ts` | `metaGet()`, 피로도 분석 |
| 재고 상태 수집 | `lib/inventoryStorage.ts` | `buildInventoryProducts()` |

**출력:** 통합 메트릭 스냅샷 → Supabase KV 저장

```json
{
  "snapshot_date": "2026-04-02",
  "cafe24": { "today_revenue": 0, "today_orders": 0, "top_products": [], "week_revenue": 0 },
  "ga4": { "sessions": 0, "new_users": 0, "bounce_rate": 0, "top_channels": [] },
  "meta": { "spend": 0, "roas": 0, "ctr": 0, "fatigue_alerts": [] },
  "inventory": { "total_skus": 0, "aging_urgent": [], "aging_critical": [], "low_stock": [] }
}
```

**이상 감지 조건:**
- 매출 전주 대비 30%+ 하락 → `data.anomaly.detected`
- 특정 상품 7일 매출 50%+ 하락 → `data.anomaly.detected`
- 재고 에이징 urgent/critical 신규 발생 → `data.anomaly.detected`

---

### 4.2 리서치 에이전트 (Research Analyst)

| 항목 | 내용 |
|------|------|
| **ID** | `research-analyst` |
| **LLM** | Claude |
| **트리거** | `data.refreshed` 이벤트, `data.anomaly.detected` 이벤트, 수동 |
| **이벤트 발행** | `research.complete`, `product.underperforming`, `trend.opportunity` |

**기존 코드 매핑:**

| 도구 | 재사용 파일 | 함수 |
|------|------------|------|
| 재고 에이징 분석 | `lib/inventoryStorage.ts` | `calcAgingStatus()`, `buildInventoryProducts()` |
| 콘텐츠 이력 분석 | `lib/contentStorage.ts` | `analyzeHistory()` |
| AI 분석 패턴 | `app/api/analytics/ai/route.ts` | Claude 호출 패턴 |

**분석 항목:**
1. 저조 상품 원인 분석 (매출 하락, 높은 이탈률, 낮은 전환율)
2. 경쟁사 가격/트렌드 조사
3. 시즌별 키워드/검색 트렌드
4. 고객 리뷰 감성 분석
5. 시계 시장 전반 트렌드

**출력 형식:**

```json
{
  "underperformers": [
    {
      "product_id": "P001",
      "product_name": "클래식 오토매틱",
      "revenue_change_7d": -45,
      "causes": ["경쟁사 20% 할인 중", "상세페이지 이탈률 78%", "검색 키워드 순위 하락"],
      "severity": "high",
      "recommended_actions": ["가격 조정", "상세페이지 리뉴얼", "키워드 광고 강화"]
    }
  ],
  "trends": [
    { "keyword": "미니멀 시계", "trend": "rising", "relevance": "high" }
  ],
  "competitive_insights": [...]
}
```

---

### 4.3 전략기획 에이전트 (Strategy Planner)

| 항목 | 내용 |
|------|------|
| **ID** | `strategy-planner` |
| **LLM** | Claude |
| **트리거** | `research.complete` 이벤트, 수동 |
| **이벤트 발행** | `plan.created`, `plan.adjusted`, `abtest.designed` |

**역할:** 리서치 결과를 받아 **구체적 실행 계획**을 수립하고 하위 에이전트에게 태스크를 배분

**출력 형식:**

```json
{
  "plan_id": "plan_20260402_001",
  "target": "클래식 오토매틱 매출 회복",
  "strategy": "20% 한정 할인 + 상세페이지 리뉴얼 + 메인 배치 변경",
  "duration": "7일",
  "tasks": [
    { "agent": "copywriter", "task": "한정특가 카피 작성 (배너 + 상세페이지 + SNS)", "priority": 1 },
    { "agent": "designer", "task": "할인 배너 3종 + 상세페이지 상단 이미지 생성", "priority": 1 },
    { "agent": "merchandiser", "task": "메인 2번째 배치 + 카테고리 상단 고정", "priority": 2 },
    { "agent": "marketing", "task": "Meta 리타겟팅 캠페인 + 인스타 포스트", "priority": 2 }
  ],
  "kpis": {
    "target_revenue_delta": "+30%",
    "measure_after_hours": 48,
    "success_criteria": "매출 20%+ 증가 or 전환율 1.5%+ 도달"
  },
  "ab_test": {
    "enabled": true,
    "variants": ["20% 할인 vs 15% 할인 + 무료배송"],
    "split": "50/50",
    "duration_hours": 72
  },
  "baseline_snapshot": { ... }
}
```

---

### 4.4 카피라이팅 에이전트 (Copywriter)

| 항목 | 내용 |
|------|------|
| **ID** | `copywriter` |
| **LLM** | Claude |
| **트리거** | `plan.created` 이벤트, 수동 |
| **이벤트 발행** | `content.text.generated` |

**기존 코드 매핑:**

| 도구 | 재사용 파일 |
|------|------------|
| 콘텐츠 브리프 생성 | `app/api/content/generate/route.ts` (PAULVICE 브랜드 시스템 프롬프트) |
| 콘텐츠 저장 | `lib/contentStorage.ts` (`ContentBrief` 구조) |
| 스레드 포스트 | `lib/threadsStorage.ts` |
| DM 템플릿 | `lib/dmTemplates.ts` |

**생성 유형:**

| 유형 | 설명 | 예시 |
|------|------|------|
| 상세페이지 카피 | 상품 설명, 특장점, 스펙 | "시간을 입다. 폴바이스 클래식 오토매틱" |
| 배너 카피 | 메인/카테고리/프로모션 배너 텍스트 | "지금만 20% 특별 할인" |
| 프로모션 문구 | 할인/이벤트 안내 | "48시간 한정, 봄맞이 특가" |
| SEO 메타 태그 | title, description, keywords | 검색 최적화된 메타 정보 |
| 상품명 최적화 | 검색 친화적 상품명 | "[폴바이스] 여성 오토매틱 시계 클래식" |
| SNS 카피 | 인스타/스레드 포스트 텍스트 | 해시태그 포함 캡션 |

**PAULVICE 브랜드 톤:**
- 20-30대 전문직 여성 타겟
- 미니멀 & 럭셔리 감성
- "시간을 디자인하다" 브랜드 메시지
- 한국어 자연스러운 문체, 과도한 수식어 지양

---

### 4.5 디자인 에이전트 (Designer)

| 항목 | 내용 |
|------|------|
| **ID** | `designer` |
| **LLM** | **Gemini 3.1 Pro** (이미지 생성) |
| **트리거** | `plan.created` 이벤트, `content.text.generated` 이벤트, 수동 |
| **이벤트 발행** | `content.image.generated` |

**필요 환경변수:** `GEMINI_API_KEY`

**이미지 생성 유형:**

| 유형 | 사이즈 | 용도 |
|------|--------|------|
| 메인 배너 | 1920x600 (16:9) | 홈페이지 메인 슬라이드 |
| 카테고리 배너 | 1200x400 (3:1) | 카테고리 페이지 상단 |
| 상세페이지 이미지 | 860x860 (1:1) | 상품 상세 설명 이미지 |
| 인스타 피드 | 1080x1080 (1:1) | 인스타그램 피드 |
| 인스타 스토리/릴스 | 1080x1920 (9:16) | 인스타 스토리 |
| 프로모션 배너 | 1200x628 (약 2:1) | Meta 광고 소재 |

**PAULVICE 비주얼 가이드라인 (Gemini 프롬프트에 포함):**
- 메인 컬러: 바이올렛/퍼플 그래디언트 (#7C3AED ~ #A78BFA)
- 배경: 미니멀 화이트 또는 소프트 그레이
- 시계 촬영: 럭셔리 클로즈업, 자연광 느낌
- 모델: 20-30대 전문직 여성 이미지
- 타이포: 산세리프, 깔끔한 한글 폰트
- 무드: 세련된, 자신감 있는, 모던한

**이미지 저장:** Supabase Storage → URL로 다른 에이전트에 전달

**프롬프트 구조 예시:**
```
Create a premium e-commerce banner for PAULVICE women's watch.
- Style: minimal luxury, violet/purple gradient accents
- Background: soft white with subtle shadows
- Product: [상품명] close-up, natural lighting
- Text overlay area: left 40% reserved for Korean text
- Mood: sophisticated, confident, modern
- Aspect ratio: [16:9 / 1:1 / 9:16]
- No text in the image (text will be added separately)
```

---

### 4.6 마케팅 에이전트 (Marketing)

| 항목 | 내용 |
|------|------|
| **ID** | `marketing` |
| **LLM** | Claude |
| **트리거** | `plan.created` 이벤트, `content.text.generated` + `content.image.generated` 모두 완료 시, 수동 |
| **이벤트 발행** | `campaign.created`, `campaign.adjusted` |

**기존 코드 매핑:**

| 도구 | 재사용 파일 |
|------|------------|
| Meta 광고 | `lib/metaClient.ts`, `lib/metaData.ts` |
| 광고 소재 생성 | `app/api/meta/ad-creator/route.ts` |
| 인플루언서 | `lib/influencerStorage.ts` |
| 로컬 에이전트 | `local-agent/agent.js` (인스타 자동화) |

**기능:**
1. Meta 리타겟팅 캠페인 설계 (세그먼트: 장바구니 이탈, 상세페이지 방문, 기존 구매자)
2. 광고 소재 배포 (디자인 에이전트 이미지 + 카피라이팅 에이전트 텍스트)
3. 인스타/스레드 콘텐츠 발행 스케줄
4. 프로모션 실행 모니터링 (피로도 체크)
5. 인플루언서 협업 조율 (발굴 → DM → 협상 → 발송)

---

### 4.7 머천다이징 에이전트 (Merchandiser)

| 항목 | 내용 |
|------|------|
| **ID** | `merchandiser` |
| **LLM** | Claude |
| **트리거** | `plan.created` 이벤트, `data.anomaly.detected` 이벤트, 수동 |
| **이벤트 발행** | `merch.updated`, `merch.bundle.created` |

**기존 코드 매핑:**

| 도구 | 재사용 파일 |
|------|------------|
| 재고/에이징 | `lib/inventoryStorage.ts` |
| Cafe24 API | `lib/cafe24Client.ts` (상품/카테고리 수정) |
| 멀티채널 데이터 | `lib/multiChannelData.ts` |

**기능:**

| 기능 | 설명 |
|------|------|
| 카테고리 진열 순서 | 매출/마진/시즌에 따라 상품 노출 순서 최적화 |
| 메인페이지 구성 | 어떤 상품/배너를 메인에 배치할지 결정 |
| 추천상품 배치 | "이 상품과 함께 보면 좋은" 추천 로직 |
| 가격 전략 | 할인율, 묶음 할인, 시즌 가격 조정 |
| 번들/세트 구성 | 시계+스트랩, 시계+파우치 등 세트 제안 |
| 재고 소진 전략 | urgent/critical 에이징 상품 클리어런스 기획 |

**Cafe24 API 연동 (자동화 가능 항목):**
- `PUT /api/v2/admin/products/{product_no}` — 상품 정보 수정
- `PUT /api/v2/admin/categories/{category_no}/products` — 카테고리 내 진열 순서
- `PUT /api/v2/admin/products/{product_no}/options` — 옵션/가격 수정

---

### 4.8 상품개발 에이전트 (Product Dev)

| 항목 | 내용 |
|------|------|
| **ID** | `product-dev` |
| **LLM** | Claude |
| **트리거** | 스케줄 매주 월요일 10:00 KST, 수동 |
| **이벤트 발행** | `productdev.report.ready` |

**기능:**
1. 기존 매출 데이터 기반 상품 갭 분석 (어떤 가격대/스타일이 비어있는지)
2. 시장 트렌드 기반 신상품 아이디어 제안
3. 경쟁사 라인업 대비 차별화 포인트
4. 소싱 키워드 추천 (알리바바, 1688 등)
5. 상품 조합/라인업 확장 제안

**출력:**
```json
{
  "gap_analysis": {
    "missing_price_ranges": ["5-8만원대 캐주얼"],
    "missing_styles": ["스포츠 캐주얼", "빈티지"],
    "high_demand_keywords": ["미니멀시계", "가벼운시계", "오피스룩시계"]
  },
  "new_product_ideas": [
    {
      "name": "폴바이스 라이트 캐주얼",
      "price_range": "59,000-79,000",
      "target": "20대 초반 대학생/사회초년생",
      "rationale": "5-8만원대 캐주얼 라인 부재, 검색량 상승 중"
    }
  ],
  "sourcing_keywords": ["minimal women watch", "lightweight quartz 32mm"]
}
```

---

### 4.9 프롬프팅 에이전트 (Prompt Engineer)

| 항목 | 내용 |
|------|------|
| **ID** | `prompt-engineer` |
| **LLM** | Claude |
| **트리거** | 수동, `prompt.evaluation.requested` 이벤트 |
| **이벤트 발행** | `prompt.updated`, `prompt.evaluation.complete` |

**기능:**
1. 모든 에이전트의 SKILL.md 시스템 프롬프트 품질 관리
2. Gemini 이미지 프롬프트 템플릿 라이브러리 관리
3. 프롬프트 버전 관리 (KV에 버전 히스토리)
4. 출력 품질 평가 (다른 에이전트 출력을 Claude가 채점)
5. A/B 테스트 (프롬프트 변형별 출력 품질 비교)
6. 비용 최적화 (토큰 사용량 모니터링)

**프롬프트 레지스트리 구조:**
```json
{
  "prompts": {
    "copywriter-product-desc-v3": {
      "agent": "copywriter",
      "type": "product-description",
      "version": 3,
      "content": "...",
      "created_at": "2026-04-02",
      "quality_score": 8.5,
      "ab_test_results": { "v2_score": 7.2, "v3_score": 8.5 }
    },
    "designer-banner-luxury-v2": {
      "agent": "designer",
      "type": "banner-luxury",
      "version": 2,
      "content": "...",
      "quality_score": 9.0
    }
  }
}
```

---

## 5. 워크플로우 상세 정의

### 5.1 일일 최적화 (daily-optimization)

```
트리거: 매일 09:00 KST
─────────────────────────────────────────────

[Step 1] data-collector
  └─ Cafe24 + GA4 + Meta 데이터 수집
  └─ 메트릭 스냅샷 저장
  └─ emit: "data.refreshed"

[Step 2] research-analyst  (depends: Step 1)
  └─ 스냅샷 분석
  └─ 저조 상품 식별
  └─ 트렌드 기회 발견
  └─ emit: "research.complete"

[Step 3] strategy-planner  (depends: Step 2)
  └─ 액션 플랜 수립
  └─ 태스크 배분
  └─ emit: "plan.created"

[Step 4a] copywriter  ┐
[Step 4b] designer    ├─ 병렬 실행 (depends: Step 3)
[Step 4c] merchandiser┘
  └─ 각각 카피/이미지/진열 작업

[Step 5] marketing  (depends: Step 4a + 4b)
  └─ 광고 소재 배포
  └─ 콘텐츠 발행

[Step 6] feedback 예약  (depends: Step 5)
  └─ 48시간 후 성과 측정 예약
```

### 5.2 저조 상품 구출 (underperformer-rescue)

```
트리거: "product.underperforming" 이벤트
─────────────────────────────────────────────

[Step 1] research-analyst
  └─ 해당 상품 심층 원인 분석
  └─ 경쟁사 비교, 이탈률 분석, 키워드 분석

[Step 2] strategy-planner  (depends: Step 1)
  └─ 구출 전략 수립 (할인? 리뉴얼? 광고 강화?)
  └─ A/B 테스트 설계

[Step 3a] copywriter    ┐
[Step 3b] designer      ├─ 병렬 실행
[Step 3c] merchandiser  ┘
  └─ 프로모션 카피 + 배너 이미지 + 진열 변경

[Step 4] marketing  (depends: Step 3a + 3b)
  └─ 리타겟팅 캠페인 집행
  └─ 인스타 포스트 발행

[Step 5] 48시간 후 피드백 측정
  └─ 효과 있으면 유지
  └─ 효과 없으면 Step 2로 (최대 3회)
```

### 5.3 재고 에이징 긴급 조치 (inventory-aging)

```
트리거: inventoryStorage.calcAgingStatus() === "urgent" | "critical"
─────────────────────────────────────────────

[Step 1] merchandiser
  └─ 클리어런스 전략 수립
  └─ 할인율 계산 (에이징 일수 기반)
  └─ 번들 구성 제안

[Step 2a] copywriter  ┐
[Step 2b] designer    ┘  병렬 실행
  └─ "긴급 특가" 카피 + 세일 배너

[Step 3] marketing
  └─ 리타겟팅 (이전 유사상품 구매자)
  └─ Meta 프로모션 캠페인
```

### 5.4 주간 상품 개발 (weekly-product-dev)

```
트리거: 매주 월요일 10:00 KST
─────────────────────────────────────────────

[Step 1] data-collector
  └─ 최근 4주 매출 + 카테고리 데이터 수집

[Step 2] product-dev  (depends: Step 1)
  └─ 갭 분석 + 신상품 아이디어 + 소싱 키워드

[Step 3] strategy-planner  (depends: Step 2)
  └─ ROI 예측 + 우선순위 평가

[결과] → 대시보드에 리포트 표시
```

### 5.5 콘텐츠 파이프라인 (content-pipeline)

```
트리거: 수동 또는 주 3회 (월/수/금 14:00)
─────────────────────────────────────────────

[Step 1] research-analyst
  └─ 트렌딩 토픽 + 시즌 키워드 조사

[Step 2] copywriter  (depends: Step 1)
  └─ 콘텐츠 브리프 생성 (기존 ContentBrief 구조 활용)
  └─ SNS 카피 작성

[Step 3] designer  (depends: Step 2)
  └─ 비주얼 에셋 생성 (Gemini)
  └─ 인스타 피드/스토리 이미지

[Step 4] marketing  (depends: Step 2 + 3)
  └─ 발행 스케줄링
  └─ 인스타/스레드 포스팅
```

---

## 6. 데이터 흐름 및 저장

### 6.1 KV 저장 키 (기존 패턴 확장)

기존 `syncStorage.ts`의 `saveWithSync()` / `loadFromServer()` 사용.
모든 데이터는 `/api/store` → Supabase `kv_store` 테이블.

| KV 키 | 용도 | 에이전트 |
|--------|------|---------|
| `paulvice_agent_state_v1` | 글로벌 공유 상태 (메트릭 스냅샷) | data-collector → 모든 에이전트 |
| `paulvice_agent_tasks_v1` | 태스크 큐 (pending/running/done/fail) | orchestrator |
| `paulvice_agent_results_v1` | 에이전트 출력 이력 (에이전트당 최근 50건) | 모든 에이전트 |
| `paulvice_agent_events_v1` | 이벤트 로그 (최근 500건) | eventBus |
| `paulvice_agent_prompts_v1` | 프롬프트 레지스트리 (버전 관리) | prompt-engineer |
| `paulvice_agent_workflows_v1` | 워크플로우 실행 이력 | orchestrator |
| `paulvice_agent_feedback_v1` | 피드백 루프 측정값 | feedback 모듈 |
| `paulvice_agent_images_v1` | 생성된 이미지 URL 목록 | designer |

### 6.2 이미지 저장

Gemini로 생성된 이미지 → Supabase Storage (버킷: `paulvice-agent-images`)
URL을 KV에 저장하여 다른 에이전트가 참조

---

## 7. 기술 스택 및 기존 코드 매핑

### 7.1 기존 재사용 코드

```
lib/cafe24Client.ts    ──→ data-collector, merchandiser
lib/cafe24Auth.ts      ──→ data-collector (토큰 관리)
lib/cafe24Data.ts      ──→ data-collector (대시보드 데이터)
lib/ga4Client.ts       ──→ data-collector
lib/metaClient.ts      ──→ data-collector, marketing
lib/metaData.ts        ──→ data-collector, marketing (피로도 분석)
lib/inventoryStorage.ts──→ data-collector, research-analyst, merchandiser
lib/contentStorage.ts  ──→ copywriter (ContentBrief 구조)
lib/threadsStorage.ts  ──→ copywriter, marketing
lib/influencerStorage.ts──→ marketing
lib/syncStorage.ts     ──→ 모든 에이전트 (KV 동기화)
lib/dmTemplates.ts     ──→ marketing
lib/dummyData.ts       ──→ data-collector (폴백)

app/api/content/generate/route.ts  ──→ copywriter (Claude 호출 패턴 + 브랜드 프롬프트)
app/api/meta/ai-analysis/route.ts  ──→ marketing (분석 패턴)
app/api/meta/ad-creator/route.ts   ──→ marketing (소재 생성)
app/api/analytics/ai/route.ts      ──→ research-analyst (GA4 분석 패턴)

local-agent/agent.js   ──→ marketing (인스타 자동화)
```

### 7.2 신규 필요 항목

| 항목 | 설명 |
|------|------|
| `GEMINI_API_KEY` 환경변수 | Gemini 3.1 Pro 이미지 생성용 |
| Gemini API 클라이언트 | `lib/agents/geminiClient.ts` (또는 에이전트 SKILL.md에 API 호출 지시) |
| Supabase Storage 버킷 | `paulvice-agent-images` (이미지 저장용) |

---

## 8. 구현 로드맵

### Phase 1: 기반 (Foundation)
- [ ] `agents/` 디렉토리 구조 생성
- [ ] 오케스트레이터 SKILL.md 작성
- [ ] 이벤트/상태 관리 방식 정의
- [ ] `/api/agents/` API 라우트 생성 (run, status, workflow)

### Phase 2: 핵심 에이전트
- [ ] data-collector SKILL.md
- [ ] research-analyst SKILL.md
- [ ] strategy-planner SKILL.md
- [ ] copywriter SKILL.md
- [ ] designer SKILL.md + Gemini 클라이언트

### Phase 3: 지원 에이전트
- [ ] marketing SKILL.md
- [ ] merchandiser SKILL.md
- [ ] product-dev SKILL.md
- [ ] prompt-engineer SKILL.md

### Phase 4: 워크플로우 + UI
- [ ] 5개 워크플로우 정의서 작성
- [ ] 피드백 루프 시스템
- [ ] 에이전트 대시보드 UI (`/app/agents/`)
- [ ] 기존 페이지에 에이전트 버튼 통합
- [ ] `AppHeader.tsx` 네비게이션 추가

### Phase 5: 자동화 + 최적화
- [ ] 스케줄링 (Vercel Cron 또는 scheduled-tasks)
- [ ] 에러 핸들링 / 재시도 로직
- [ ] 비용 모니터링 (API 호출 트래킹)
- [ ] 프롬프트 A/B 테스트 자동화

---

## 9. 리스크 및 대응

| 리스크 | 대응 |
|--------|------|
| Vercel 함수 타임아웃 (60s/300s) | 워크플로우를 체이닝된 API 호출로 분할 |
| Claude/Gemini API 속도 제한 | 지수 백오프 + 태스크 큐잉 |
| 공유 상태 경합 | 에이전트별 네임스페이스 + 낙관적 잠금 |
| 프롬프트 품질 저하 | prompt-engineer 에이전트가 정기 평가 |
| API 비용 폭증 | 일일 예산 한도 설정 + 비용 트래킹 |
| 이벤트 무한 루프 | 이벤트 타입별 쿨다운 + 최대 깊이 제한 |
| 데이터 지연 | data-collector에서 항상 최신 데이터 갱신 후 워크플로우 시작 |
