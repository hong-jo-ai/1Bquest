# 미니엘 쁘띠 9/1 클리어런스 런북

2026-08-25 준비. **9/1 아침에 아래 순서대로 실행하면 끝난다.**

## 실행 (local-agent/)

```bash
node _miniel901.js                     # dry-run — 13종 가격 확인
node _miniel901.js --apply             # ① 99,000 균일 인하

node _miniel901Deploy.js               # dry-run
node _miniel901Deploy.js --apply       # ② 메인 FINAL PRODUCTION 블록 배포 (SFTP 비번 필요)

node baseline.js --tag after-miniel-99k --grep 미니엘   # ③ 사후 스냅샷
```
SFTP 비번은 `local-agent/.env` 의 `CAFE24_SFTP_PW`.

⚠️ `_miniel901*.js` 는 `_` 접두사라 **gitignore 대상(아이맥 로컬에만 존재)**. 이 런북이 사양서다 — 파일이 없으면 아래 내용으로 재작성한다.
- `_miniel901.js`: 아래 13종에 `PUT /products/{no} {price:"99000"}`. retail_price 는 건드리지 않는다.
  149·68·260·71·69·72·168·75·73·151·191·76·74
- `_miniel901Deploy.js`: `pv_miniel_block.html`+`.css` 를 `pv_main_sections.html` 에 삽입(CSS 는 `</style>` 앞,
  블록은 `<!-- ── AS WORN` 주석 앞) → `skinDeploy` 로 버저닝 배포 → 검증. 이미지 4장은 `/web/product/paulvice-main/`.

## 전제 (9/1 전에 확인)
- 밴드 스왑 100개 **실물 교체 완료** — 장부는 8/25 반영됨(화이트 블랙 118개)
- **#188 사각 재고 실사** — 장부 -6, 판매는 이미 OFF

## 결정 근거 (요약)
- **주력 1종만**: 화이트 블랙 #68. 자사몰·공구 양쪽 1위이고 리뷰 220건. 색을 여럿 열면 귀인이 안 된다.
- **99,000 균일**: 미니엘 쁘띠 90일 **구매 0**(조회 1,500+·장바구니 40+). 159~189k 가 벽이라는 근거.
- **핑크는 보류가 아니라 미테스트**: 90일 조회 23회로 노출 자체가 없었다. 화이트 기준선 확보 후 같은 조건으로 비교.
- **기간할인 금지**: 판매가 직접 변경(기간할인 만료 시 할인 소멸 사고 이력).

## 사후 2주 체크
```bash
node ga4.js items --days 14 --grep 미니엘      # 조회·장바구니·구매
node ga4.js pages --days 14 --grep 미니엘      # 체류·이탈
```
- 장바구니율이 2% → 4%대로 올라왔는지 (기준선: `downloads/baseline/2026-08-25_before-miniel-99k.json`)
- 스크롤 뎁스(8/25 삽입)로 상세 어디서 이탈하는지
- 위가 확인되면 그때 **광고**. 전환 안 되는 페이지에 예산 붓지 않는다.

관련 메모리: `miniel-petite-clearance`, `decide-by-data`, `paulvice-ga4-setup`
