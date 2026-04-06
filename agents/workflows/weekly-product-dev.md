---
name: 주간 상품개발
name_en: Weekly Product Dev
description: 매주 월요일 시장 갭 분석과 신상품 아이디어를 생성하는 워크플로우
trigger:
  type: schedule
  value: "0 10 * * 1"  # 매주 월요일 10:00 KST
timeout_minutes: 20
---

# 주간 상품개발 워크플로우 (Weekly Product Dev)

매주 월요일 오전 10시에 실행되어 지난 주 매출 데이터를 기반으로 상품 라인업 갭을 분석하고 신상품 아이디어를 제안합니다.

## 실행 흐름

```
[월 10:00] Step 1: data-collector ── 최근 4주 매출 데이터 수집
              │
              ▼
[월 10:05] Step 2: product-dev ── 갭 분석 + 신상품 아이디어 + 소싱 키워드
              │
              ▼
[월 10:10] Step 3: strategy-planner ── ROI 예측 + 우선순위 평가
              │
              ▼
[월 10:15] 결과 → 대시보드 리포트 저장
```

## 스텝 상세

### Step 1: data-collector
```yaml
agent: data-collector
task: |
  주간 상품개발 분석용 데이터 수집:
  - 최근 4주 Cafe24 주문 데이터 (상품별 매출/수량)
  - 카테고리별 매출 분포
  - 가격대별 매출 분포
  - 재고 현황 전체
timeout: 120s
```

### Step 2: product-dev
```yaml
agent: product-dev
depends_on: [step1]
task: |
  주간 상품개발 리포트 작성:
  1. 가격대/스타일/소재별 갭 분석
  2. 수요가 있으나 미충족된 영역 식별
  3. 신상품 아이디어 3-5개 (구체적 스펙 포함)
  4. 소싱 키워드 (중문/영문)
  5. 경쟁사 신상품 동향
timeout: 300s
```

### Step 3: strategy-planner
```yaml
agent: strategy-planner
depends_on: [step2]
task: |
  상품개발 아이디어 평가:
  - 예상 매출/마진 계산
  - 개발 비용/리드타임 추정
  - 기존 라인업과의 카니발라이제이션 위험
  - 우선순위 랭킹 (1-5위)
  - 추천 일정 (샘플→생산→출시)
timeout: 180s
```

## 출력

리포트는 `paulvice_agent_results_v1` KV에 저장되고, `/agents` 대시보드에 표시됩니다.

```json
{
  "workflow": "weekly-product-dev",
  "date": "2026-04-06",
  "summary": "가격 갭 2건, 신상품 아이디어 4건, 최우선: '폴바이스 라이트' 6.9만원대 쿼츠",
  "top_idea": {
    "name": "폴바이스 라이트",
    "price": "69,000원",
    "priority": 1,
    "estimated_monthly_revenue": "4,830,000원"
  },
  "full_report": { ... }
}
```
