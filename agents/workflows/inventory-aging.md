---
name: 재고 에이징 긴급 조치
name_en: Inventory Aging Action
description: 재고 에이징이 urgent/critical에 도달한 상품을 긴급 소진하는 워크플로우
trigger:
  type: event
  value: "data.anomaly.detected"
  condition: "payload.type === 'inventory_aging' && payload.status in ['urgent', 'critical']"
timeout_minutes: 30
---

# 재고 에이징 긴급 조치 워크플로우 (Inventory Aging Action)

재고가 오래 쌓인 상품(90일+ urgent, 180일+ critical)을 빠르게 소진하기 위한 긴급 워크플로우입니다.

## 트리거 조건

`inventoryStorage.ts`의 `calcAgingStatus()` 결과가 다음일 때:
- **urgent (90-179일):** 소진 필요. 할인 + 노출 강화
- **critical (180일+):** 긴급 소진. 대폭 할인 + 클리어런스

## 실행 흐름

```
[이벤트] inventory_aging detected
    │
    ▼
Step 1: merchandiser ── 클리어런스 전략 수립
    │                    (할인율, 번들, 진열)
    │
    ├──────────────┐
    ▼              ▼
Step 2a: copywriter  Step 2b: designer  ←── 병렬
 긴급 특가 카피        세일 배너 이미지
    │              │
    └──────┬───────┘
           ▼
Step 3: marketing ── 리타겟팅 + 세일 알림
    │
    ▼
Step 4: 피드백 (72h 후)
```

## 에이징 상태별 자동 액션

### urgent (90-179일)
```yaml
merchandiser:
  discount: 25%
  placement: "메인페이지 '특가' 섹션"
  category: "카테고리 상단 3위 이내"
  bundle: "관련 상품과 세트 10% 추가 할인"

copywriter:
  banner_tone: "합리적 기회"
  examples:
    - "오늘이 가장 좋은 가격"
    - "한정 수량, 특별한 가격으로"
  avoid: "재고 떨이, 폭탄세일 뉘앙스"

designer:
  style: "elegant_sale"
  banner_sizes: ["1920x600", "1080x1080"]
  color: "바이올렛 배경 + 화이트 텍스트"

marketing:
  campaign: "리타겟팅 (유사 상품 방문자)"
  daily_budget: 30000
  duration: 14
```

### critical (180일+)
```yaml
merchandiser:
  discount: 35-40%
  placement: "메인페이지 최상단 클리어런스 배너"
  category: "카테고리 최상단"
  bundle: "1+1 또는 대폭 세트 할인"
  cross_sell: "인기 상품 구매 시 추가 50% 할인"

copywriter:
  banner_tone: "놓치기 아까운 기회"
  examples:
    - "시즌 마감 특별 혜택"
    - "이 가격은 마지막입니다"

designer:
  style: "clearance_luxury"
  emphasis: "원가 대비 할인율 시각적 강조"
  banner_sizes: ["1920x600", "1200x400", "1080x1080"]

marketing:
  campaign: "리타겟팅 + 유사타겟"
  daily_budget: 50000
  duration: 21
  channels: ["instagram_feed", "instagram_stories", "facebook_feed"]
```

## 할인 승인 규칙

| 할인율 | 승인 |
|--------|------|
| 25% 이하 | 자동 실행 |
| 26-35% | 대시보드 알림 후 자동 (12시간 대기) |
| 36% 이상 | 사람 승인 필수 (대시보드 + 알림) |

## 성과 측정

72시간 후 측정:
- 해당 상품 판매 수량 변화
- 재고 소진 속도 (일 평균 판매량)
- 예상 완전 소진 일수
- 해당 캠페인 ROAS

목표:
- urgent → 30일 내 50% 소진
- critical → 21일 내 70% 소진
