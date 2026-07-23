# 해리엇 글로벌 컷오버 체크리스트 (2026-07-23 확정)

식스샵 harriotwatches.com → cafe24 영문몰(harriotkorea shop2). 순서대로.

## A. 컷오버 前 준비 (라이브 무영향 — 미리 다 해둘 것)

### ✅ 완료 (실측 확인 2026-07-23)
- 영문몰 shop2 생성·roma B&W 스킨·영문 체크아웃(skin6)
- 홈 SEO: title "HARRIOT WATCHES - KOREAN MADE WATCHES"·meta desc·canonical=harriotwatches.com·**JSON-LD 2블록**·og:image(실URL)
- 홈 SEO 본문(장문, "korean" 다수)·OUR STORY(/roma/sub/sub-01.html)
- 블로그 **18편** board5(journal) 영문 등재
- 상품 43종·USD가격·영문명 (진열 41)
- 301 매핑 73개 확정 + 등록 스크립트 `local-agent/harriotGlobalRedirects.js`
- 결제 승인(Paymentwall)·도메인 DNS 우리 관리(Route53)

### ⏳ 남은 준비 (컷오버 前)
1. **shop2 미완 2종**: #135 광안블랙로즈골드(한글·미진열), #131 Ilgu Lady Strap(미진열) → 진열 여부 결정
2. **영문 자동알림메일 5종** cafe24 관리자 붙여넣기 (owner, [[cafe24-automail-templates]])
3. **결제 PG 실연동 확인 + 테스트 결제 1건** (Paymentwall 승인 → shop2 연결 상태 검증)
4. **홈 H1** 태그 반영 확인(02_home_seo_content 기준, 경미)
5. **404 스킨 JS 폴백** 삽입 — cafe24 `exception/404.html`에 6월 스크립트(11_301_redirect_map.md). 하이픈 9건+누락 캐치용. (owner/스마트디자인)
6. (옵션) cafe24 하이픈 path API 답변 오면 그 9건도 API 301로

## B. 컷오버 당일 (순서 엄수)
1. **회원 CSV 최종 재생성** (현재 249명, 컷오버 시점까지 신규 포함) → cafe24 관리자 "회원 엑셀 일괄등록". ⚠️생성스크립트 재구성 필요(미저장). 수신동의 F·임시비번([[harriot-global-member-migration]])
2. **DNS 백업** (현 Route53 레코드 저장) → harriotwatches.com **NS를 cafe24로 변경**(영문몰 연결)
3. 도메인이 cafe24 가리키기 시작하면 → **301 등록** `node harriotGlobalRedirects.js --apply` (64건, ≤2/초) + **404 JS 폴백 활성**
4. **구글 서치콘솔**: google-site-verification 유지 확인 → **새 sitemap 제출**(harriotwatches.com/sitemap.xml) → 홈 색인 요청
5. **E2E 테스트**: 실결제·FedEx 송장·배송추적 주문 1건

## C. 컷오버 後
- **"korean watch / korea watch" 순위 매일 모니터링** — 이상 시 **DNS 롤백**(백업으로 식스샵 복귀)
- 404 리포트 확인(놓친 리다이렉트 잡기)
- 안정 확인 후 **식스샵 글로벌 폐점**

## 롤백 기준
DNS만 되돌리면 즉시 식스샵 복귀(리다이렉트는 cafe24쪽이라 자동 무력화). 컷오버 前 NS 레코드 백업 필수.
