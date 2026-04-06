---
name: 저조 상품 구출
name_en: Underperformer Rescue
description: 매출이 급감한 상품을 집중 분석하고 프로모션+콘텐츠+광고로 구출하는 워크플로우
trigger:
  type: event
  value: "product.underperforming"
timeout_minutes: 45
max_retries: 3
feedback_interval_hours: 48
---

# 저조 상품 구출 워크플로우 (Underperformer Rescue)

특정 상품의 매출이 급감했을 때 자동 트리거되어 원인 분석 → 전략 수립 → 콘텐츠 제작 → 마케팅 집행까지 일관되게 처리합니다.

## 트리거 조건

`product.underperforming` 이벤트 발생 시:
- 7일 매출 전주 대비 50%+ 하락
- 또는 리서치 에이전트가 severity "high"로 판정

## 실행 흐름

```
[이벤트 수신] "product.underperforming" + { product_id, product_name, severity }
       │
       ▼
Step 1: research-analyst ── 해당 상품 심층 원인 분석
       │
       ▼
Step 2: strategy-planner ── 구출 전략 + A/B 테스트 설계
       │
       ├─────────────┬──────────────┐
       ▼             ▼              ▼
Step 3a: copywriter  3b: designer   3c: merchandiser  ←── 병렬 실행
 프로모션 카피        할인 배너       진열/가격 변경
       │             │
       ▼             ▼
Step 4: marketing ── 리타겟팅 캠페인 + 콘텐츠 발행
       │
       ▼
Step 5: 피드백 측정 (48h 후)
       │
       ├── 성공 → 완료 + 패턴 기록
       └── 실패 → Step 2로 (최대 3회)
```

## 스텝 상세

### Step 1: 심층 원인 분석
```yaml
agent: research-analyst
task: |
  상품 '{product_name}'의 매출 하락 심층 분석:
  - 최근 30일 매출/주문 추이
  - 상세페이지 이탈률 변화
  - 장바구니 이탈률
  - 경쟁사 동일 카테고리 가격 동향
  - 검색 키워드 순위 변화
  - 재고 에이징 상태
  - 최근 리뷰/평점 변화
timeout: 180s
```

### Step 2: 구출 전략 수립
```yaml
agent: strategy-planner
depends_on: [step1]
task: |
  리서치 결과를 기반으로 구출 액션 플랜 수립:
  - 할인율 결정 (원인에 따라 10-25%)
  - 상세페이지 리뉴얼 필요 여부
  - 메인 배치 변경 범위
  - 광고 캠페인 설계 (세그먼트, 예산)
  - A/B 테스트 설계 (변수 1개만)
  - KPI 목표 설정 + 측정 일정
timeout: 180s
```

### Step 3a-c: 콘텐츠 제작 + 머천다이징 (병렬)
```yaml
# 3a
agent: copywriter
depends_on: [step2]
task: "프로모션 카피 (배너 3종 + 상세페이지 + SNS)"
parallel: true

# 3b
agent: designer
depends_on: [step2]
task: "할인 배너 이미지 + 상세페이지 상단 리뉴얼 (Gemini)"
parallel: true

# 3c
agent: merchandiser
depends_on: [step2]
task: "가격 변경 + 메인 노출 강화 + 카테고리 상단 고정"
parallel: true
```

### Step 4: 마케팅 집행
```yaml
agent: marketing
depends_on: [step3a, step3b]
task: |
  - Meta 리타겟팅 캠페인 생성 (상세페이지 방문자 30일)
  - 광고 소재: step3a 카피 + step3b 이미지
  - 인스타 피드+스토리 발행
  - 일 예산: 전략기획 플랜에 따라
timeout: 300s
```

### Step 5: 피드백 루프
```yaml
action: feedback_loop
delay_hours: 48
measure:
  - product_revenue_7d (대상 상품)
  - page_conversion_rate
  - detail_page_bounce_rate
  - meta_campaign_roas
compare_to: step2.output.baseline_snapshot
on_success:
  - 현 전략 유지
  - 성공 패턴 기록 (향후 유사 상품에 적용)
on_failure:
  - strategy-planner 재실행 (adjusted plan)
  - 최대 3회 반복
  - 3회 실패 후 → 사람 리뷰 요청
```

## 에스컬레이션 규칙

| 조건 | 액션 |
|------|------|
| 1차 피드백: 매출 +20% 미달 | 할인율 5% 추가 + 광고 예산 20% 증액 |
| 2차 피드백: 여전히 미달 | 전면 전략 변경 (번들 구성 or 세트 할인) |
| 3차 피드백: 여전히 미달 | 자동 조정 중단 + 대시보드 알림 + 사람 개입 요청 |

## 쿨다운

- 같은 상품에 대해 underperformer-rescue는 7일 내 1회만 실행
- 동시 실행 가능한 rescue 워크플로우: 최대 2개 (리소스 분산 방지)
