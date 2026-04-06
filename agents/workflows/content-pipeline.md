---
name: 콘텐츠 파이프라인
name_en: Content Pipeline
description: 트렌딩 토픽 리서치 → 카피 작성 → 이미지 생성 → 발행까지의 콘텐츠 자동화 워크플로우
trigger:
  type: schedule
  value: "0 14 * * 1,3,5"  # 월/수/금 14:00 KST
  also: manual
timeout_minutes: 30
---

# 콘텐츠 파이프라인 워크플로우 (Content Pipeline)

주 3회(월/수/금) 또는 수동으로 실행되어 트렌드 기반 SNS 콘텐츠를 자동 생성합니다.

## 실행 흐름

```
[14:00] Step 1: research-analyst ── 트렌딩 토픽 + 시즌 키워드 조사
           │
           ▼
[14:05] Step 2: copywriter ── 콘텐츠 브리프 + SNS 카피 작성
           │
           ▼
[14:10] Step 3: designer ── 비주얼 에셋 생성 (Gemini 3.1 Pro)
           │
           ▼
[14:15] Step 4: prompt-engineer ── 품질 평가 (카피 + 이미지)
           │
           ├── 품질 OK (7.0+) ─────────────────┐
           └── 품질 미달 (<7.0) → Step 2 재실행  │
                                                 ▼
[14:20] Step 5: marketing ── 발행 스케줄링 + 광고 소재 등록
           │
           ▼
[14:25] 완료 → 다음 발행 시간에 자동 게시
```

## 스텝 상세

### Step 1: 트렌드 리서치
```yaml
agent: research-analyst
task: |
  SNS 콘텐츠용 트렌드 리서치:
  - 이번 주 시계/패션 트렌딩 키워드
  - 인스타그램 인기 해시태그 분석
  - 시즌 맞춤 토픽 (날씨, 이벤트, 공휴일)
  - 경쟁사 최근 SNS 콘텐츠 동향
  - 기존 콘텐츠 이력에서 높은 참여율 패턴
output:
  topics: 3-5개 토픽 제안
  keywords: 관련 해시태그 목록
  content_type: "제품소개 / 스타일링 / 스토리텔링 / 브랜드 / 시즌"
```

### Step 2: 카피 작성
```yaml
agent: copywriter
depends_on: [step1]
task: |
  리서치 결과 기반 콘텐츠 작성:
  - 인스타그램 피드 포스트 카피 1-2건
  - 스레드 포스트 1-2건
  - 콘텐츠 브리프 (기존 ContentBrief 구조 활용)
  - 각 콘텐츠에 적합한 해시태그
output:
  instagram_posts: [{caption, hashtags, hook}]
  threads_posts: [{text, style, topic}]
  content_brief: ContentBrief (lib/contentStorage.ts 구조)
```

### Step 3: 이미지 생성
```yaml
agent: designer
depends_on: [step2]
task: |
  카피에 맞는 이미지 생성:
  - 인스타 피드용 1080x1080 (포스트당 1-3장)
  - 인스타 스토리용 1080x1920 (선택)
  - 이미지에 텍스트 미포함 (텍스트는 별도 오버레이)
  - PAULVICE 비주얼 가이드라인 준수
```

### Step 4: 품질 평가
```yaml
agent: prompt-engineer
depends_on: [step2, step3]
task: |
  생성된 콘텐츠 품질 평가:
  - 카피: 브랜드 일관성, 타겟 적합성, 설득력
  - 이미지: 브랜드 비주얼, 상품 매력도, 구도
  - 종합 점수 7.0 이상이면 통과
threshold: 7.0
on_below_threshold: step2부터 재실행 (프롬프트 자동 조정)
max_retries: 2
```

### Step 5: 발행 스케줄링
```yaml
agent: marketing
depends_on: [step4]
condition: step4.quality_score >= 7.0
task: |
  콘텐츠 발행 준비:
  - 인스타그램: 다음 발행 슬롯에 예약 (19:00-21:00)
  - 스레드: 즉시 발행 또는 다음 날 오전
  - Meta 광고 소재로 등록 (선택)
```

## 콘텐츠 캘린더 가이드

| 요일 | 콘텐츠 테마 | 플랫폼 |
|------|------------|--------|
| 월 | 주간 트렌드 / 새로운 시작 무드 | 인스타 피드 + 스레드 |
| 수 | 제품 포커스 / 스타일링 팁 | 인스타 피드 + 스토리 |
| 금 | 주말 무드 / 라이프스타일 | 인스타 피드 + 릴스 커버 + 스레드 |

## 콘텐츠 재사용

- 생성된 이미지 → Meta 광고 소재로 활용 가능
- 인스타 카피 → 스레드 변형 자동 생성
- 높은 참여율 콘텐츠 → 유사 패턴으로 재생산
- 모든 콘텐츠는 `paulvice_agent_results_v1`에 저장하여 이력 관리
