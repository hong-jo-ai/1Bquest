# 해리엇 글로벌몰 이전 — 식스샵 → 카페24 영문몰

시작 2026-07-22. 국내몰은 이미 카페24(harriotkorea)로 이전 완료. 이번은 **글로벌**.

## 구성
- **출발지**: 식스샵 `harriot_global` = **harriotwatches.com** (현재 라이브, 영문/USD)
- **목적지**: 카페24 `harriotkorea` **shop_no 2**(영문/USD, skin5 roma B&W, skin6 체크아웃)
- **자산**: harriotwatches.com "korean watch" 구글 1위 — **SEO 보존이 최대 리스크**

## 하드 게이트 (2026-07-22 확인 — 둘 다 해소)
- ✅ **결제**: 승인 완료 (Paymentwall 또는 승인된 게이트웨이) → cafe24 shop2 연동·테스트만 남음
- ✅ **도메인**: harriotwatches.com DNS 우리가 직접 관리 → 동일 도메인 재연결 + 301 가능

## 로드맵
- **Phase 0 — 현황 스냅샷** ✅ 진행중: SEO/URL 베이스라인 캡처 (이 문서)
- **Phase 1 — 결제 라이브**: cafe24 shop2에 게이트웨이 연동 + 테스트 결제 1건
- **Phase 2 — 콘텐츠 마감**: 상품 패리티(식스샵 25종 ↔ cafe24 shop2), 영문 자동메일 5종 붙여넣기, 배송/정책/스토리 페이지
- **Phase 3 — SEO 보존**: 식스샵 타이틀·메타·홈/스토리 카피 → cafe24 매칭 + **301 리다이렉트 맵**(아래 73 URL 전부)
- **Phase 4 — 회원 이전**: 식스샵 글로벌 247명 CSV import (컷오버 직전, GDPR·비번리셋 안내)
- **Phase 5 — 도메인 컷오버**: harriotwatches.com DNS → cafe24 shop2 (네임서버/A레코드), 301 활성
- **Phase 6 — E2E 테스트**: 실결제·FedEx 송장·추적 주문 1건
- **Phase 7 — 고라이브 + 식스샵 폐점**

## Phase 0 — SEO/URL 베이스라인 (2026-07-22 캡처)
- 플랫폼: 현재 harriotwatches.com(+www) = **식스샵** (HTTP 200)
- 홈 `<title>`: **HARRIOT WATCHES - KOREAN MADE WATCHES**
- 홈 meta desc: *"Meaningful Korean watches made in Korea. Harriot offers engraved timepieces that turn memories into timeless gifts."*
- canonical: https://harriotwatches.com
- 상품 URL = **슬러그 기반** `/product/{slug}` (숫자ID 아님, 예: `/product/20metalstrap`, `/product/black`). 상품 title=상품명, meta desc 비어있음.
- **sitemap 73 URL** (`sixshop-urls.txt`): 상품 25 · 블로그 18 · 리뷰 13 · 모델/컬렉션 페이지(`/kiwon`,`/kari`,`/ilgu`,`/dobo`,`/seongsan`,`/seohae`,`/straps`,`/story`) · `/about`,`/contact`,`/blog`,`/termsandconditions`
- ⚠️ 상품뿐 아니라 **블로그·스토리·모델 페이지가 SEO 기여** → 301 맵에 전부 포함. cafe24는 URL 구조가 달라(`/product/{name}/{no}/`) **73개 전부 새 URL로 매핑 필요**.

## 🟢 301 구현 방식 확정 (2026-07-22, 실물 검증)
cafe24 헬프데스크 심사 승인 → `redirects` API 사용 가능(harriot 앱). 재인증 불필요(기존 store 스코프 토큰이 바로 동작).
- **List**: `GET /api/v2/admin/redirects?shop_no=2` → `{redirects:[{shop_no,id,path,target}]}`
- **Create**: `POST /api/v2/admin/redirects` body `{shop_no:2, request:{path, target, redirect_type:"301"}}` → 201 `{redirects:{id,...}}`
- **Delete**: `DELETE /api/v2/admin/redirects/{id}?shop_no=2`
- **path**(옛경로): 맨 앞 `/` + **영문·숫자·`_`·`/` 만 허용**. ⚠️**하이픈(`-`)·점(`.`) 거부**(`%2D` 인코딩도 불가).
- **target**(새주소): **전체 URL 필수**(예: `https://harriotkorea.cafe24.com/shop2/product/detail.html?product_no=121`). 상대경로·쿼리단독 불가.
- 동작 시점: **도메인이 cafe24를 가리킬 때만**(=컷오버 후 활성). 등록은 미리 가능.
- 레이트리밋: **≤2 req/초**(429 방지).

**⚠️ 하이픈 제약 영향(약 9개 URL):** UUID상품 1(f9af07c0…), 블로그 6(Introducing-…-Diver-Watch, harriot-kiwon-korean-watch-review, korean-american-kiwon-watch-story, watch-for-husbands-with-korean-wife, untitled-15, untitled-16), untitled-2/3. 나머지 ~64개는 API로 즉시 등록.

## 🔗 6월 작업물 대조·통합 (2026-07-23)
`downloads/harriot-global-migration/`에 6월 이전 작업(런북·홈/스토리/블로그 영문카피·**11_301_redirect_map.md**·회원CSV223·QA)이 있음. 내 신규 매핑과 **상품·블로그 번호 완전 일치**(교차검증). 6월 맵에서 더 정확한 타겟 채용:
- **블로그 target = `/article/journal/5/{no}/`** (게시판 journal board5 확정 URL)
- **리뷰 128776 = KI:WON(#121)** 리뷰보드 → `/product/detail.html?product_no=121`
- **정적: /about·/story → `/roma/sub/sub-01.html`(OUR STORY), /contact → `/roma/sub/sub-04.html`(Meet Harriot)**
→ `harriotGlobalRedirects.js`에 반영 완료.

**🟢 하이픈 문제 해법 = 6월의 404 스킨 JS 폴백:** cafe24 404 스킨(`exception/404.html`)에 JS 리디렉션 삽입(11_301_redirect_map.md에 스크립트 존재). JS는 cafe24 path 검증을 안 거쳐 **하이픈 경로도 처리**. → **API 301(클린 64건) + 404스킨 JS 폴백(하이픈 9건 + 누락 캐치)** 조합이 완결 해법. cafe24 하이픈 재문의는 선택사항(진짜 301 원하면).

## 301 매핑 워크시트 (Phase 3에서 채움)
| 식스샵 URL | cafe24 대응 URL | 상태 |
|---|---|---|
| (sixshop-urls.txt 73개) | (product_no/카테고리/게시판 매칭) | TODO |

## 목적지(shop2) 준비도 실측 (2026-07-22)
- 상품 **43종 / 진열 41 / 판매 43**, 가격 **USD**(예 $25·$30), 영문명 적용. 식스샵 25 product URL의 상위집합 → 누락아님, **매핑** 이슈.
- **미완 2종:** `#135 광안 블랙 로즈골드`(한글명·미진열 F/T → 영문화+진열 결정), `#131 Ilgu Lady Strap 16mm`(미진열 F/T → 진열 결정).

## 접근/설정 메모
- harriot cafe24: `HARRIOT_CAFE24_MALL_ID=harriotkorea`, 토큰=kv `cafe24_refresh_token:harriot`(자동갱신). API **정상 개방**(products·categories·orders 200 확인 2026-07-22). ⚠️ `/api/v2/admin/shops`(스토어 메타)만 403(insufficient_scope) — **이전 작업엔 무관, 재인증 불필요**. (customers count는 404=경로문제, 회원 API 경로 별도 확인.)
- 식스샵: `SIXSHOP_LOGIN_ID=info@harriotwatches.com`, `SIXSHOP_GLOBAL_STORE=harriot_global`.
- 관련 준비물(완료): 영문화(harriot-english-mall), 영문스킨 skin5, 체크아웃 skin6 7종, 회원 247 CSV, FedEx 글로벌 자동예약, 영문 자동메일 5종(붙여넣기 남음).
