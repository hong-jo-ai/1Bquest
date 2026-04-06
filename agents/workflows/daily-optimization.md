---
name: 일일 최적화
name_en: Daily Optimization
description: 매일 오전 Cafe24+GA4+Meta 데이터를 수집하고 분석하여 최적화 액션을 실행
trigger:
  type: schedule
  value: "0 9 * * *"  # 매일 09:00 KST
timeout_minutes: 30
max_parallel: 3
---

# 일일 최적화 워크플로우 (Daily Optimization)

매일 오전 9시에 자동 실행되어 전일 성과를 분석하고 당일 최적화 액션을 수행합니다.

## 실행 흐름

```
[09:00] Step 1: data-collector ── 전체 데이터 수집
           │
           ▼
[09:05] Step 2: research-analyst ── 데이터 분석 + 이슈 식별
           │
           ▼
[09:10] Step 3: strategy-planner ── 당일 액션 플랜 수립
           │
           ├───────────────────────────────┐
           ▼                               ▼
[09:15] Step 4a: copywriter          Step 4b: merchandiser
        필요한 카피 작성               진열/가격 조정
           │
           ▼
[09:20] Step 4c: designer ── 필요한 이미지 생성
           │
           ▼
[09:30] Step 5: marketing ── 광고/콘텐츠 배포
           │
           ▼
[09:35] Step 6: 피드백 측정 예약 (48h 후)
```

## 스텝 상세

### Step 1: data-collector
```yaml
agent: data-collector
task: "전일 매출, GA4 트래픽, Meta 광고 성과, 재고 현황 수집"
timeout: 120s
on_success: emit "data.refreshed"
on_fail: 워크플로우 중단 + 알림
```

### Step 2: research-analyst
```yaml
agent: research-analyst
depends_on: [step1]
task: "수집된 데이터 분석. 저조 상품 식별, 트렌드 기회 발견"
timeout: 180s
on_success: emit "research.complete"
condition: step1.status === "success"
```

### Step 3: strategy-planner
```yaml
agent: strategy-planner
depends_on: [step2]
task: "분석 결과 기반 당일 액션 플랜 수립. 태스크 분배."
timeout: 180s
on_success: emit "plan.created"
condition: step2.output.underperformers.length > 0 OR step2.output.trends.length > 0
skip_if: "분석 결과 특이사항 없음 → 기존 전략 유지"
```

### Step 4a: copywriter (병렬)
```yaml
agent: copywriter
depends_on: [step3]
task: "플랜에 따른 카피 작성 (배너, 프로모션, SNS)"
timeout: 120s
parallel_with: [step4b]
condition: step3.output.tasks에 copywriter 태스크 있을 때
```

### Step 4b: merchandiser (병렬)
```yaml
agent: merchandiser
depends_on: [step3]
task: "진열 순서 조정, 가격 변경, 메인페이지 업데이트"
timeout: 120s
parallel_with: [step4a]
condition: step3.output.tasks에 merchandiser 태스크 있을 때
```

### Step 4c: designer
```yaml
agent: designer
depends_on: [step4a]  # 카피 완성 후 이미지에 반영
task: "배너/상세페이지/SNS 이미지 생성 (Gemini 3.1 Pro)"
timeout: 300s
condition: step3.output.tasks에 designer 태스크 있을 때
```

### Step 5: marketing
```yaml
agent: marketing
depends_on: [step4a, step4c]  # 카피 + 이미지 모두 완료 후
task: "Meta 광고 소재 교체/생성, SNS 발행 스케줄"
timeout: 180s
condition: step3.output.tasks에 marketing 태스크 있을 때
```

### Step 6: 피드백 예약
```yaml
action: schedule_feedback
depends_on: [step5]
task: "48시간 후 KPI 측정 예약"
feedback_delay_hours: 48
kpis: step3.output.kpis
baseline: step3.output.baseline_snapshot
```

## 스킵 조건

- Step 3에서 "특이사항 없음" 판정 → Step 4~6 전체 스킵
- data-collector 실패 → 전체 워크플로우 중단
- 개별 실행 에이전트 실패 → 해당 태스크만 실패 처리, 나머지 계속

## 성공 기준

- 전체 워크플로우 30분 이내 완료
- 모든 스텝 성공 또는 조건부 스킵
- 피드백 측정 예약 완료
