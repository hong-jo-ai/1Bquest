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

### ✅ 추가 완료 (2026-07-23)
- **#135 광안블랙로즈골드** shop2 영문명+진열 (상품 패리티 완성). #131은 국내몰도 숨김 = 의도적 비공개, 유지.
- **영문 자동알림메일 5종** cafe24 관리자에 브랜드 템플릿 적용 완료(브라우저 자동화). 신규가입(A)·주문내역(C)·무통장입금(D)·발송조치(F)·배송완료(G) ← 각 harriot-email-templates HTML. 편집기=SmartEditor iframe에 innerHTML 주입+저장, 로고·렌더 검증됨. 제목은 기존 영문 유지.
- **결제** Paymentwall 테스트 완료(사장님)
- **SFTP 복구**: HARRIOT_SFTP_PW=jacob1128!! (품절배지 자동화도 복구)

### ⏳ 남은 준비 (컷오버 前)
1. **홈 H1** (경미 — 콘텐츠 반영됨, skin5 layout 편집 필요)
2. **404 스킨 JS 폴백** — skin5에 표준 exception/404 없음 → 에러페이지 구조 조사 후. 하이픈 9건+누락용. (SFTP 복구됨 = skin5 편집 가능)
3. (옵션) cafe24 하이픈 path API 답변 오면 그 9건도 API 301로

## B. 컷오버 당일 (순서 엄수)
1. **회원 CSV 최종 재생성** (현재 249명, 컷오버 시점까지 신규 포함) → cafe24 관리자 "회원 엑셀 일괄등록". ⚠️생성스크립트 재구성 필요(미저장). 수신동의 F·임시비번([[harriot-global-member-migration]])
2. **DNS 백업** (현 Route53 레코드 저장) → harriotwatches.com **NS를 cafe24로 변경**(영문몰 연결)
3. 도메인이 cafe24 가리키기 시작하면 → **301 등록** `node harriotGlobalRedirects.js --apply` (64건, ≤2/초) + **404 JS 폴백 활성**
4. **구글 서치콘솔**: google-site-verification 유지 확인 → **새 sitemap 제출**(harriotwatches.com/sitemap.xml) → 홈 색인 요청
5. **E2E 테스트**: 실결제·FedEx 송장·배송추적 주문 1건

## 🟢 컷오버 실행 결과 (2026-07-23)
- ✅ NS→cafe24, apex+www 서빙, **HTTPS/SSL 정상**(www가 옛IP 23.227.38.32→cafe24로 교체하니 SSL 발급됨. www 미교체가 SSL 발급오류 원인이었음).
- ✅ **301 리다이렉트 63건 등록**, 라이브 검증: product·category·static·`/blog` = **301 정상 작동**.
- ⚠️ **`/blogPost/*`(12)·`/productReview/*`(13) = 404** — cafe24 인프라(nginx/openresty)가 이 두 접두어를 리다이렉트 엔진보다 먼저 자체 404(title "카페24")로 가로챔. API 등록돼도 안 뜸. 캐시 아님(캐시버스터 무효), 구조적. → **cafe24 문의 필요**(하이픈9건과 함께). 블로그=SEO중요(콘텐츠는 board5에 있음, 옛URL 리다이렉트만 불가), 리뷰=저가치.

## C. 컷오버 後
- **"korean watch / korea watch" 순위 매일 모니터링** — 이상 시 **DNS 롤백**(백업으로 식스샵 복귀)
- 404 리포트 확인(놓친 리다이렉트 잡기)
- 안정 확인 후 **식스샵 글로벌 폐점**

## 롤백 기준
DNS만 되돌리면 즉시 식스샵 복귀(리다이렉트는 cafe24쪽이라 자동 무력화). 컷오버 前 NS 레코드 백업 필수.
