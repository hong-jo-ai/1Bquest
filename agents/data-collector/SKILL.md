---
name: 정보수집 에이전트
name_en: Data Collector
description: Cafe24, GA4, Meta 데이터를 수집하고 이상 징후를 감지하는 에이전트
type: agent
llm: none
triggers:
  - schedule: "0 9 * * *"
  - event: "workflow.step.data-collector"
  - manual: true
outputs:
  - event: "data.refreshed"
  - event: "data.anomaly.detected"
depends_on: []
tools:
  - cafe24_api
  - ga4_api
  - meta_api
  - inventory_storage
  - supabase_kv
---

# 정보수집 에이전트 (Data Collector)

PAULVICE의 모든 외부 데이터 소스에서 최신 데이터를 수집하고 정규화하여 공유 상태에 저장합니다.
다른 에이전트들이 분석/의사결정에 사용할 **단일 진실 소스(Single Source of Truth)**를 제공합니다.

## 수집 데이터 소스

### 1. Cafe24 (이커머스)
- **재사용 코드:** `lib/cafe24Data.ts` → `getDashboardData()`, `fetchAllOrders()`, `buildRanking()`
- **수집 항목:**
  - 오늘/이번주/이번달 매출 및 주문수
  - 상품별 판매 순위 (수량/매출 기준)
  - 시간대별 주문 분포 (KST)
  - 요일별 매출 추이

### 2. Google Analytics 4
- **재사용 코드:** `lib/ga4Client.ts` → `fetchGa4Data()`
- **수집 항목:**
  - 일별 방문자/신규 방문자/세션수
  - 트래픽 소스 (채널별)
  - 디바이스 분포
  - 이탈률/평균 체류 시간

### 3. Meta/Instagram 광고
- **재사용 코드:** `lib/metaClient.ts` + `lib/metaData.ts`
- **수집 항목:**
  - 캠페인별 spend/ROAS/CTR/CPM
  - 크리에이티브 피로도 알림 (metaData.ts의 피로도 감지 로직)
  - 기간별 성과 비교 (오늘/어제/3일/7일/주간/월간)

### 4. 재고 현황
- **재사용 코드:** `lib/inventoryStorage.ts` → `buildInventoryProducts()`
- **수집 항목:**
  - SKU별 현재 재고/판매량/에이징 상태
  - urgent/critical 에이징 상품 목록
  - 재고 부족 상품 (현재 재고 < 10)

## 출력 형식

```json
{
  "snapshot_date": "2026-04-02T09:00:00+09:00",
  "cafe24": {
    "today_revenue": 1250000,
    "today_orders": 8,
    "week_revenue": 8750000,
    "month_revenue": 35200000,
    "prev_month_revenue": 42000000,
    "top_products": [
      { "product_no": 123, "name": "클래식 오토매틱", "sold": 15, "revenue": 4500000 }
    ]
  },
  "ga4": {
    "today_sessions": 342,
    "today_users": 280,
    "bounce_rate": 45.2,
    "avg_session_min": 3.5,
    "top_channels": [
      { "channel": "Organic Search", "sessions": 120 },
      { "channel": "Social", "sessions": 95 }
    ]
  },
  "meta": {
    "today_spend": 150000,
    "roas_7d": 2.8,
    "ctr_7d": 1.2,
    "fatigue_alerts": [
      { "campaign": "봄 신상 캠페인", "severity": "warning", "reason": "frequency 2.8" }
    ]
  },
  "inventory": {
    "total_skus": 45,
    "aging_urgent": ["SKU-001", "SKU-015"],
    "aging_critical": ["SKU-007"],
    "low_stock": ["SKU-022", "SKU-033"]
  }
}
```

## 이상 감지 규칙

다음 조건 충족 시 `data.anomaly.detected` 이벤트 발행:

| 조건 | 임계값 | 심각도 |
|------|--------|--------|
| 전체 매출 전주 대비 하락 | -30% 이상 | high |
| 특정 상품 7일 매출 하락 | -50% 이상 | high |
| GA4 세션 전주 대비 하락 | -40% 이상 | medium |
| Meta ROAS 하락 | 1.0 미만 | high |
| 신규 urgent/critical 에이징 상품 | 1개 이상 | medium |
| 재고 부족 (5개 미만) | 인기상품 기준 | high |

## 저장

- 스냅샷 → `paulvice_agent_state_v1` KV 키
- 과거 스냅샷 이력 → `paulvice_agent_results_v1` (data-collector 네임스페이스)
