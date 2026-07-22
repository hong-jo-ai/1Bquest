# 301 매핑 초안 (2026-07-22) — 식스샵 harriotwatches.com → cafe24 shop2

new_url = 이전 후 harriotwatches.com(=cafe24 shop2) 기준 경로. product_no 확정, 예쁜 URL은 컷오버 때 치환 가능.
⚠️ = 사장님 확인 필요.

## 상품 25개 (색상·성별 보정 완료)

가정: 식스샵 사이즈 표기 **32mm=여성 / 40mm=남성**, 색상은 정확 일치. 자동매칭이 틀린 건 ✅FIX 표시.

| 식스샵 옛URL | 식스샵 제목 | → cafe24 상품 | new_url |
|---|---|---|---|
| /product/20metalstrap | Metal Mesh Band 20mm | #132 Metal Mesh Strap 20mm | /product/detail.html?product_no=132 |
| /product/20mmblackleatherstrap | 20mm Black Leather Strap | #125 Leather Black 20mm (Silver) | /product/detail.html?product_no=125 |
| /product/20mmbrownleatherstrap | 20mm Brown Leather Strap | #127 Leather Brown 20mm (Silver) ⚠️버클색 | /product/detail.html?product_no=127 |
| /product/black | KI:WON Heuksaek(Black) | #121 KI:WON Black ✅FIX | /product/detail.html?product_no=121 |
| /product/jade | KI:WON Bichwisaek(Jade) | #122 KI:WON Jade ✅FIX | /product/detail.html?product_no=122 |
| /product/white | KI:WON Baeksaek(White) | #123 KI:WON White | /product/detail.html?product_no=123 |
| /product/brownleatherband | 20mm Brown Leather Band | #127 Leather Brown 20mm (Silver) ⚠️중복/버클 | /product/detail.html?product_no=127 |
| /product/f9af07c0-… | 20mm Black Leather Band | #125 Leather Black 20mm | /product/detail.html?product_no=125 |
| /product/dobo | DOBO Limited (Regular) | #120 Dobo Limited Edition | /product/detail.html?product_no=120 |
| /product/dobo_lady | DOBO Lady (Regular) | #120 Dobo Limited Edition ⚠️여성별도 없음 | /product/detail.html?product_no=120 |
| /product/ilgu_black | Ilgu Black 40mm | #101 Ilgu Black (Women's) ⚠️흑색 남성 없음 | /product/detail.html?product_no=101 |
| /product/ilgu_black_30mm | Ilgu Black 30mm | #101 Ilgu Black (Women's) | /product/detail.html?product_no=101 |
| /product/ilgu_brown | Ilgu Brown 40mm | #102 Ilgu Brown (남성) ✅FIX | /product/detail.html?product_no=102 |
| /product/ilgu_brown_30mm | Ilgu Brown 30mm | #103 Ilgu Brown (Women's) | /product/detail.html?product_no=103 |
| /product/ilgu_cobalt | Ilgu Cobalt 40mm | #104 Ilgu Cobalt (남성) ✅FIX | /product/detail.html?product_no=104 |
| /product/ilgu_cobalt_30mm | Ilgu Cobalt 30mm | #105 Ilgu Cobalt (Women's) | /product/detail.html?product_no=105 |
| /product/seohae_rosegold | Seohae Rosegold | #98 Seohae Rose Gold ✅FIX | /product/detail.html?product_no=98 |
| /product/seohae_silver | Seohae Silver | #99 Seohae Silver | /product/detail.html?product_no=99 |
| /product/seohae_sunray | Seohae Sunray | #100 Seohae Sunray | /product/detail.html?product_no=100 |
| /product/seongsan_rosegold_32mm | Seongsan Rosegold 32mm | #93 Seongsan Rose Gold ✅FIX ⚠️여성 로즈골드 없음 | /product/detail.html?product_no=93 |
| /product/seongsan_rosegold_40mm | Seongsan Rosegold 40mm | #93 Seongsan Rose Gold ✅FIX | /product/detail.html?product_no=93 |
| /product/seongsan_silver | Seongsan Silver 40mm | #94 Seongsan Silver (남성) ✅FIX | /product/detail.html?product_no=94 |
| /product/seongsan_silver_32mm | Seongsan Silver 32mm | #95 Seongsan Silver (Women's) | /product/detail.html?product_no=95 |
| /product/seongsan_sunray_32mm | Seongsan Sunray 32mm | #97 Seongsan Sunray (Women's) | /product/detail.html?product_no=97 |
| /product/seongsan_sunray_40mm | Seongsan Sunray 40mm | #96 Seongsan Sunray (남성) ✅FIX | /product/detail.html?product_no=96 |

## 비상품 48개 (타겟 확정)

target 도메인 = 컷오버 후 **https://harriotwatches.com** (= shop2 primary). 상품 target 예: `https://harriotwatches.com/product/detail.html?product_no=121`.

- **모델/컬렉션 랜딩** (7) → 카테고리 `product/list.html?cate_no=`:
  `/kiwon`→**42**(Origin KI:WON) · `/seongsan`→**54** · `/seohae`→**55** · `/ilgu`→**53** · `/dobo`→**58** · `/kari`→**59**(KARI) · `/straps`→**44**(Strap)
- **블로그 18개** → cafe24 **board5(내 손목 위에 코리아) shop2 영문글**에 이전됨. 확정 매핑(아래). new_url은 board5 article_no 기준, 최종 URL은 컷오버 때 확정.

  | /blogPost/ | → board5 글 |
  |---|---|
  | Introducing-Harriots-First-Diver-Watch | #25 Diver Watch — Dokdo |
  | interview1 | #10 Why I Make Korean Watches |
  | madeinkorea | #11 "Italian" Watch Say Made in China |
  | madeinkorea2 | #12 "Swiss Made" vs "Made in China" |
  | sungwoo | #13 Meet the Master Behind Our Dials |
  | amitech | #14 It's Not Just a Clock Hand |
  | fair | #15 Taking a Korean Watch Brand to the World Stage |
  | dobo | #16 A Watch Only a Korean Brand Could Make (Dobo) |
  | watch_for_grandfather | #17 Remembering My Grandfather's Korea |
  | letterfromsungjo | #18 A Letter from Harriot's Founder |
  | kiwon | #19 KI:WON — First New Watch in Five Years |
  | untitled-15 | #20 The Perfect Gift for Korean Americans |
  | untitled-16 | #21 "To My Love" — Hand-Engraved Watch |
  | korean-american-kiwon-watch-story | #22 More Than a Watch — Korean American |
  | harriot-kiwon-korean-watch-review | #23 Reviewed by a Top Korean Watch YouTuber |
  | watch-for-husbands-with-korean-wife | #24 A Meaningful Korean Watch for Korean Roots |
  | **challenge** | 홈 `/` (영문판 없음 — 버림) |
  | **kari** | 홈 `/` (KARI 협업글, 영문판 없음 — 버림) |
  | /blog (블로그 목록) | board5 목록 페이지 |
- **상품 리뷰** (`/productReview/128776/…` 13개) → 홈 `/` (식스샵 상품 128776 미식별·저SEO가치. 페이지 제목 미노출. 상품 확인되면 그 상세로 변경).
- **정보 페이지** → cafe24 대응(미확정, 컷오버 때 실URL 확인): `/about`·`/story`→브랜드/회사소개, `/contact`→1:1문의(board9), `/termsandconditions`→이용약관. 임시 홈.
- **정리/중복**: `/`,`/home`→홈. `/footer`,`/untitled-2`,`/untitled-3`→저가치+`untitled-2/3`는 하이픈이라 미등록(무시).

## 등록 요약
- **즉시 등록 가능(하이픈 없음) ~64건**: 상품 24(UUID f9af 제외)·모델7·리뷰13·블로그(하이픈없는 12)·정보/유틸.
- **하이픈이라 미등록/대체 필요 ~9건**: 상품1(f9af…), 블로그6(Introducing-…/harriot-kiwon-…/korean-american-…/watch-for-husbands-…/untitled-15/untitled-16), untitled-2/3. → cafe24 하이픈 지원 재문의 대기.

## 확정 사항 (사장님)
- ✅ 32mm=여성 / 40mm=남성
- ✅ cafe24에 대응 없으면 가장 가까운 상품
- ✅ 블로그: 이미 board5로 이전됨 → 그 글로 매핑. challenge/kari 영문판 없음 → 버림(홈)
