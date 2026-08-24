---
name: paulvice-website
description: 폴바이스 자사몰(paulvice.co.kr) 화면을 바꾸는 스킬. 메인 히어로 배너 교체, 신상 섹션 갱신, 시즌 전환, 문구 수정, 상품 상세페이지 조판 등 "폴바이스 메인 바꿔줘", "히어로 배너 교체", "가을 느낌으로", "신상 메인에 올려줘", "웹사이트 수정" 요청에 사용한다. 카페24 스킨(skin2)을 SFTP로 직접 배포하며 백업·검증·롤백이 자동으로 붙는다. ⚠️ 같은 경로 덮어쓰기는 캐시에 막히므로 반드시 파일명 버저닝을 쓸 것.
---

# 폴바이스 웹사이트 관리

자사몰 화면을 **에이전트가 끝까지 바꾼다**(사장님 방침 2026-08-24). 관리자 UI를 열게 만들지 말 것.

## 0. 먼저 알 것 — 무엇을 코드로 바꿀 수 있나

| 영역 | 관리 주체 | 에이전트 가능? |
|---|---|---|
| **메인 히어로**(이미지·문구) | 스킨 `pv_hero_*.html` | ✅ 이 스킬로 |
| **메인 섹션**(NEW IN·AS WORN·REVIEWS·두무드·각인·기프트) | 스킨 `pv_main_sections_*.html` | ✅ |
| BEST 진열 상품 | 카페24 관리자 › 상품진열 › 메인상품진열 | ❌ (진열은 관리자, CSS 손질만 가능) |
| 상단 띠배너 · 헤더/푸터 로고 · SNS | 배너매니저 앱 | ❌ 관리자 UI 전용 |
| 상품 상세페이지 | 카페24 API (`description`/`mobile_description`) | ✅ `local-agent/pvDetailBuilder.js` |
| 대표 썸네일 | — | ❌ API 불가, 관리자 수동 |

## 1. 배포 절차 — 반드시 `skinDeploy.js` 를 쓴다

```js
const D = require("./skinDeploy");          // local-agent/
await D.session(async () => {               // ← 연결 재사용 필수(개별 연결 시 ECONNRESET)
  const tag = D.stamp();                     // YYYYMMDDHHmm
  const bk = await D.backupFiles(["/skin2/index.html"], tag);
  await D.uploadFiles([[로컬, "/web/product/paulvice-main/..."]]);
  const f = await D.uploadVersioned(로컬, "/skin2/moa/import/main", "pv_hero", ".html", tag);
  // index.html 의 기존 import 를 f.name 으로 교체
  const v = await D.verifyLiveRetry({ retries: 6, retryDelayMs: 40000, checks: {...} });
  if (!v.ok) await D.restore(bk.saved);      // 검증 실패 = 자동 롤백
});
```

### ⚠️ 파일명 버저닝이 규칙인 이유
같은 경로에 덮어쓰면 **캐시 노드마다 옛 버전이 섞여 나온다**(실측: 같은 URL 연속 호출에 CSS 가 grid↔flex 로 진동).
재업로드·쿼리스트링 캐시버스터 전부 무효. **새 파일명 + index.html import 교체**만 즉시 반영된다.
index.html 자체는 회전이 빨라 보통 1분 내 반영되지만, **검증에 재시도를 반드시 넣을 것**(없으면 오탐으로 불필요한 롤백).

## 2. 검증 없이 배포하지 않는다
`verifyLiveRetry` 는 Playwright 로 **실제 렌더**를 본다 — 셀렉터 개수·깨진 이미지·콘솔 에러·4xx·좌표 검사.
파일이 올라간 것과 화면이 정상인 것은 다르다. 실제로 이 검증이 두 번 사고를 잡았다.

자주 쓰는 검사: `D.CHECKS.heroNotUnderHeader`
⚠️ `.header` 는 **높이 0짜리 래퍼**라 기준으로 쓰면 항상 통과하는 헛검사가 된다. 실제 보이는 건 `.header__wrap`.

## 3. 디자인 기준 (BI · [[paulvice-bi-guidelines]])
- 모노톤 **#111 · #fff · Paul Vice Gray #B1AAA2**. **골드 액센트 금지**(후기 별점도 검정).
- 서체 **Pretendard/Noto Sans KR**. 세리프는 워드마크만. 라벨은 **대문자 + 넓은 자간**(모노스페이스 쓰지 말 것 — 한글이 깨진다).
- 브레다(breda.com) 톤 채택: 작은 대문자 라벨 + **밑줄 링크**, 큰 헤드라인 없이 사진이 말하게, 풀블리드 그리드.
- **사진은 밝은 자연 컬러. 흑백 금지**(사장님 2026-07-09 — 시계가 안 보임). B&W 는 해리엇 전용.
- **시계는 AI 가 창작하지 않는다.** 실물 착용샷/제품컷에서 가져온다([[ai-content-tool-routing]]).
- 나란히 놓는 컷은 **배경 톤을 맞춘다**(밝은 컷 + 어두운 컷 조합은 좌우 균형이 깨짐).
- 이미지 위 흰 글씨는 밝은 사진에서 묻힌다 → **캡션은 이미지 아래 검정**이 안전.

## 4. 사진 소스
- 제품컷: `★ PAULVICE/📁 01_착용컷_웨어링/에끌라/` (누끼 정면·스튜디오컷·디테일 매크로)
- 실사 OOTD: `.../인스타 협찬/` (에끌라 실버 28장 — 필름톤 자연광, 브레다 결과 맞음)
- CDN 업로드 경로: `/web/product/paulvice-main/` · 히어로는 `/hero/`
- 규격: 히어로 **모바일 750×1220 · PC 1920×900**. 히어로 문구는 **top 96px 아래**(헤더 오버레이 회피).

## 5. 승인 흐름 (선택)
큰 변경은 텔레그램 승인 카드를 거친다 — `lib/skin/deployQueue.ts` 에 pending 저장 → 카드 발송 →
사장님 승인 → 아이맥 워커가 배포. 콜백 형식 `skin:accept|reject:<id>`.

## 6. 사고 이력 (반복 금지)
- 히어로 문구가 **헤더 로고와 겹침** — 헤더가 히어로 위 오버레이다. top 96px 아래로.
- `.pvm-worn` 3열 **CSS grid 자동배치가 어긋남**(2번째가 3열로). 원인 미특정 → **flex 로 우회**했다. 새 그리드도 배치 좌표를 검증할 것.
- 시즌 지난 배너가 **8개월 방치**된 적 있다(8월에 크리스마스 배너). 시즌 전환 시 전 슬라이드를 훑을 것.
- 정기 발행이 필요한 에디토리얼 섹션은 만들지 않는다 — 폴바이스는 콘텐츠 생산 여력이 없어 방치되면 역효과.
  대신 **자동으로 쌓이는 후기**를 브랜드 콘텐츠 자리에 둔다.

## 7. 단일 장애점 — SFTP
`local-agent/sftpHealth.js` 로 상태 확인. 카페24 FTP 는 사용기간이 주기적으로 만료되고,
연속 인증 실패 시 **IP 가 10~30분 차단**된다. 실패하면 ①몇 분 쉬었다 재시도 ②그래도 실패면 사장님께 재활성화 요청.
접속 정보는 [[cafe24-sftp-access]].

관련: [[skin-auto-deploy]] [[paulvice-main-redesign]] [[paulvice-detail-standard]] [[cafe24-representative-image-api-limit]]
