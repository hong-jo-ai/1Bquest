# HARRIOT JOURNAL

해리엇 자사 사이트의 SEO 콘텐츠. **글은 데이터로 쓰고 HTML 은 생성한다.**

```
harriot-journal/
  build.js              렌더러 + 빌드
  deploy.js             카페24 SFTP 업로드 + sitemap 갱신
  articles/ko/*.js      국문 원고 (harriotwatches.co.kr)
  articles/en/*.js      영문 원고 (harriotwatches.com)
  dist/                 생성물 — 손대지 말 것
```

| | 국문 | 영문 |
|---|---|---|
| 도메인 | harriotwatches.co.kr | harriotwatches.com |
| 스킨 폴더 | `/skin4` | `/skin5` |
| 목록 | `/journal/` | `/journal/` |
| 글 | `/journal/<slug>.html` | `/journal/<slug>.html` |

## 새 글 쓰는 법 (3단계)

**1. 원고 파일 하나 만든다** — `articles/ko/<slug>.js`

```js
const IMG = "https://harriotwatches.co.kr/roma/img/211830/";
module.exports = {
  slug: "seolwol-moonphase",     // = URL. 영문 소문자·하이픈
  category: "Heritage",           // Heritage · Craft · Guide · Story
  title: "제목 — 검색어를 앞쪽에",
  titleSuffix: "부제",            // 선택. <title>·JSON-LD 에만 붙는다
  dek: "히어로 아래 한두 문장.",
  description: "검색결과에 그대로 노출. 155자 안쪽.",
  keywords: "쉼표, 구분, 검색어",
  date: "2026-09-10",
  hero: IMG + "xxx.jpg",
  heroAlt: "사진 설명 — 무엇이 찍혀 있는지 구체적으로",
  heroLight: false,               // true = 사진 아래 흰 지면에 제목(글자 안 읽힐 때)
  image: IMG + "xxx.jpg",         // 목록·og 썸네일
  alt: "목록용 사진 설명",
  lead: true,                     // 목록 맨 위 큰 기사로. 하나만 지정
  order: 1,                       // 같은 날짜끼리의 순서
  blocks: [ ... ],
  cta: { href, img, alt, label, name, desc, go },
};
```

**2. 빌드 → 확인**
```bash
node harriot-journal/build.js
open harriot-journal/dist/ko/journal/<slug>.html
```

**3. 배포**
```bash
node harriot-journal/deploy.js --dry    # 계획만
node harriot-journal/deploy.js          # 업로드 + sitemap 갱신
```
배포하면 sitemap 의 `/journal/` URL 이 자동으로 새로 쓰인다(기존 상품 URL 은 보존).
마지막으로 **서치콘솔·네이버 서치어드바이저에서 수집 요청**만 사람이 눌러준다.

## blocks 종류

| `t` | 쓰임 |
|---|---|
| `lede` | 첫 문단. 드롭캡이 걸린다. 두세 줄 이상으로 |
| `p` | 본문. `html:` 로 주면 `<strong>` 등 태그 사용 가능 |
| `h2` `h3` | 소제목. 검색엔진이 목차로 읽는다 |
| `quote` | 풀쿼트 `{text, cite}` |
| `img` | 사진 `{src, alt, cap, w}` · `w`: 생략=1040px / `"bleed"`=풀블리드 / `"body"`=본문폭 |
| `duo` | 사진 2장 나란히 `{items:[{src,alt,cap},…]}` |
| `spec` | 사양표 `{rows:[["항목","값"],…]}` |
| `note` | 회색 박스. 출처·재발행 안내 |
| `end` | 끝 표시 ■ |

## 레이아웃

폭 3단(680 / 1040 / 풀블리드). `100vw` 트릭을 안 써서 카페24 래퍼가
`overflow:hidden` 이어도 안 깨진다. 제목·소제목은 **Pretendard 볼드**, 본문만 세리프.

## ⚠️ 카페24 제약 (2026-09-02 실측)

- **2단계 하위폴더의 index.html 은 매핑되지 않는다.** `/journal/kari-757/` → 404,
  `/journal/kari-757.html` → 200. 그래서 글은 반드시 flat `.html`. 목록만 폴더 index.
- **`<title>` 을 카페24가 상점 공통값으로 덮어쓴다.** 스킨으로 못 막는다
  (`layout.html` 의 `<title>` 은 빈 값, 엔진이 서버에서 주입).
  → 각 페이지가 JS 로 `document.title` 을 되돌린다. **구글은 렌더 후 인식, 네이버 Yeti 는 불확실.**
  그래서 `h1` 과 JSON-LD `headline` 이 실질 제목 신호다.
  ☑️ 관리자 SEO 에 개별 페이지 title 설정이 있으면 JS 없이 해결된다 — 확인 필요.
- **canonical 은 카페24가 경로 기준으로 자동 생성한다.** 여기서 또 넣으면 신호가 충돌하므로 넣지 않는다.
- **게시판(board)에는 올리지 말 것** — canonical 이 전 글 동일이라 개별 색인이 안 된다.
  매거진 게시판(`board_no=5`)은 사이트 안에서 사람이 읽는 용도로만 유지.

## 기대치 — 네이버가 아니라 구글

자사 사이트 글은 **네이버 블로그를 대체하지 못한다.** 네이버 통합검색에서 자사 도메인은
"웹사이트" 탭에만 뜨고 블로그 탭엔 안 뜬다(해리엇은 "해리엇 시계" 웹문서 1위인데도 묻힘).
반면 **구글에선 효과가 크다.** 해리엇은 "korean watch" 구글 1위이고 영문권이 주 타겟이라,
영문 저널(harriotwatches.com)이 사실상 본판이다.

## 현황 (2026-09-02)

국문 7편 + 영문 7편 배포 완료. 매거진 게시판 글을 전부 옮겼다.

| slug | 국문 제목 |
|---|---|
| `kari-757` | 누리호를 기다린 757개의 시계 |
| `dobo-2018` | 2018년 4월 27일을 손목에 새기다 |
| `sungwoo-dial` | 시계의 얼굴을 빚는 사람 |
| `amitech-hands` | 바늘 하나에도 장인이 있습니다 |
| `ilgu-collection` | 공장이 없다면, 직접 짓기로 했습니다 |
| `why-made-in-korea` | 우리가 MADE IN KOREA를 고집하는 이유 |
| `econo-interview` | 내가 국산 시계를 만드는 이유 |

⚠️ 이관 글의 **사진은 원문에 쓰인 컷에서 골랐고, 일부는 눈으로 확인하지 않고 파일명 순서로 골랐다.**
어색한 컷이 보이면 해당 원고의 `src` 만 바꿔 다시 빌드·배포하면 된다.
