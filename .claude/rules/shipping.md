# 배송·출고 규칙

범위: 우체국 접수·송장입력·라벨 인쇄·반품 회수·교환 재발송·해외(페덱스)·배송추적.
코드: `local-agent/{runPostOffice,buildPostOffice,dispatch17,registerQueueWorker,labelPrintQueue,enMallOutbound}.js`,
`local-agent/postParcel/**`, `lib/postParcel/**`, `app/api/postparcel/**`, `app/shipping`.

> 여기엔 **판단 규칙만** 둔다. 채널별 셀렉터·사고 경위 같은 세부는 메모리 파일(괄호 안 이름)에 있다.
> 이 파일과 메모리가 어긋나면 **실제 코드·launchd·DB 를 확인**하고 둘 다 고친다.

## 하루 흐름 (평일, launchd 실측 2026-09-18)
| 시각 | 잡 | 하는 일 |
|---|---|---|
| 10:30 | chosunmall-po-sync | 조선몰 발주서 → 접수 (**우체국 파이프라인 밖, 단독**) |
| 11 · 13 · 15 · 17시 | en-mall-outbound | 영문몰(shop2) 수집·검증·텔레그램. 11시=전체, 나머지=**새 주문만**. **라벨·픽업 안 함** |
| 12:30 · 14:30 · 15:10 | postoffice-outbound(-1430/-1510) | `runPostOffice.js` — 전 채널 라이브 수집 → 우체국 접수 |
| 14:05 | kakaogift-postoffice | 카카오선물 발주서 → 접수 |
| 15:00 | chosunmall-reply-send | 조선몰 송장 회신 |
| 17:10 | dispatch-17 | 카페24·29CM·무신사(국내/글로벌)·스마트스토어 **송장입력** + 카카오 회신메일 |
| 12:52 · 17:20 | wconcept-sync | W컨셉 송장입력(엑셀 다운로드보다 **먼저**) |
| 5분마다 | label-print-queue | 접수분 라벨 PDF → 윈도우 노트북 PS100 |
| 상시 | register-queue | 폰·대시보드 단건/반품/AS 접수 큐 워커 |

- 고객 약속 = **평일 15시 전 주문 당일 출고**(shipping-cutoff). 주말·공휴일 문구 분기 필수.
- 접수 dedup 키 = `pp_shipments (order_number, channel, req_type)` + `status='submitted'`. 12:30 접수분은 14:30 에 다시 안 나간다.

## 1. "잘 나갔어?" 점검은 세 숫자가 맞아야 정상
①채널 어드민 신규주문 수(수집 로그 "대상 N건") → ②`pp_shipments` 접수 → ③송장입력 로그.
- **"0건 처리" ≠ 정상.** 상류 수집 실패와 구분하려면 `postoffice-outbound*.out.log` 부터 본다.
- 사장님이 "주문 있었는데?" 하면 내 결론을 버리고 그 관찰을 기준으로 재조사.
- 브라우저 자동화의 ⚠️경고 로그는 무해하다고 가정하지 않는다(29CM·무신사 누락 사고 둘 다 경고로 먼저 왔다).
- "마켓 세션 만료" 로그를 최종 상태로 믿지 말 것 — 단독 재실행이 진단보다 싸다.
(outbound-verification-end-to-end · musinsa-outbound-excel-outage · wconcept-invoice-checkall-bug)

## 2. 보내면 안 되는 주문 막기 — 수단이 넷, 범위가 다르다
| 수단 | 범위 | 쓰는 법 |
|---|---|---|
| 상품명 `[…예약/재입고/입고예정/출고예정…]` | 상품 단위, 자동 | 예약상품은 카페24 상품명에 표시를 **유지**(가드 트리거) |
| kv `pp_hold_orders` | 주문 단위 | `holdOrders.js addHolds([{seller,order,reason,until}])`. until 지나면 자동 해제 |
| 텔레그램 "홍길동 발송보류" | 이미 접수된 건 | status held → 송장입력 제외 |
| `shippingHold.setHold()` | 날짜 단위 | **송장입력·카카오 회신만** 멈춤. 접수는 계속 |
- **송장 취소만으로는 안 막힌다** — 채널엔 출고대기로 남아 다음 날 새 송장이 나간다. 반드시 hold 도 건다.
- 사고로 채번된 **유령 송장은 즉시 취소하거나 hold 에 사유 등록**. 남겨두면 나중에 "이미 접수됨"으로 조용히 빠져 포장 누락.
- hold 조회 실패 시 fail-open(발송). **Supabase 장애 감지되면 12:30/14:30 접수 잡을 먼저 멈춘다.**
- 택배 휴무일 = `parcelHolidays.js NO_PICKUP`. 근거는 **택배기사 안내 문자**. 대체공휴일은 연휴가 **일요일**과 겹칠 때만.
(preorder-shipping-guard · postoffice-hold-orders · shipping-hold-switch · parcel-pickup-holidays)

## 3. 각인 — 새기면 되돌릴 수 없다
- 주문서 각인칸이 우선. 주문서 밖(웹챗·메일·배송메시지)으로 온 각인은 kv `manual_engravings`(스마트스토어는 `smartstore_engraving_overrides`).
  ⚠️ 키에 **몰 구분이 없다** — 등록 전 두 몰에서 그 주문번호가 유일한지 확인.
- **설월 = 기본 Times New Roman**(사장님 2026-09-18) — 고객이 따로 지정하지 않으면 묻지 않고 이 서체로 새긴다.
- 그 외 해리엇 서체 6종(한·영 × 고딕/명조/필기). **서체 미정이면 각인 전에 묻는다.** 기한까지 답이 없으면 고딕으로 안내한 뒤 진행한 선례 있음(김영주 2026-09-18).
- 수량 ≥ 2 + 각인 1칸이면 두 점 다인지 고객 확인. 문구 길이(20자 초과)는 반려 사유가 아니다.
- 각인 미리보기(시안 이미지) 약속 금지 — 확인은 "문구를 글로 재확인"까지.
(cafe24-engraving-option · cs-no-engraving-preview-promise · harriot-en-mall-outbound-gap)

## 4. 반품 회수
- **우리가 회수 접수하는 건 두 경우뿐**: 카페24 **비네이버페이** 결제 · 카카오선물. 나머지 채널은 채널이 자동 회수한다(중복 접수 금지).
- 회수 도착지 = **무조건 서초 기본 공급지 `260133857`**. 사장님이 "사무실로 받자"고 해도 접수는 서초(집배원이 사무실로 가져다준다).
  예외: AS 시계를 고객→수리센터로 바로 보낼 땐 `order.officeSer="260722206"`.
- 회수 `payType=2`(착불). 결과 **2,200원·7890 대역이면 정상, 1,700원·6890 대역이면 선불 사고**.
- 면세점 창고 회수는 발송인명 = **"폴바이스"**(창고명 아님), 품목명에 박스 수 정확히.
- 네이버페이 반품·환불은 **네이버페이센터**에서. 수거완료 → 반품완료 순. **환불보류를 먼저 풀면 반품배송비(6,000) 청구가 취소된다.**
- **도착 처리는 사장님이 "○○ 도착"이라고 말한 건만.** 종추적 "배달완료 서울서초우체국"은 수령이 아니다.
(return-pickup-channel-rules · return-pickup-destination-seocho · postparcel-return-paytype · dutyfree-postoffice-pickup · naverpay-return-refund-center · return-arrival-owner-confirmed-only)

## 5. 재발송·교환·AS 반송 — 접미사로 dedup 을 비켜간다
| 접미사 | 용도 |
|---|---|
| `-EX` | 교환 재발송 |
| `-AS` | AS 수리 완료 반송 (seller=`AS`) |
| `-RT` | 중복발송 회수 (reqType 2) |
- 접미사로 보내면 **채널 어드민의 교환 클레임은 열린 채로 남는다** → 물리 처리가 끝나면 채널에서 직접 닫는다.
- **무신사 교환은 반대 함정**: 무신사가 재출고를 새 주문번호로 내려보내면 자동 파이프라인이 한 번 더 보낸다. 수동 재발송 전 무신사 배송요청 큐부터 확인.
- 단건 접수 `registerSingle` 은 hold·예약 가드를 **일부러 안 탄다**(escape hatch) — 쓸 땐 내가 직접 확인한다.
- AS 회송처: **시계 = 김종근 수리센터(성북) / 주얼리 = 나비스트(중구)**. 바꿔 보내면 안 된다.
(exchange-same-ordernumber-reship · harriot-as-repair-center · jewelry-as-navist)

## 6. 채널별로 다른 것
- **스마트스토어**: 접수 직후 발송처리(취소 창 닫기). 취소건 재고는 `ssStockSync` 가 자동 +1 → **반송품 도착해도 또 +1 금지**.
- **카카오선물**: 우리 쪽 주문 테이블이 없다. 취소 = 송장 `cancelShipment` / 기록 자동 / **재고는 PO 에서 수동 제거** / 피오르드(song@fjord.kr)에 통보.
- **W컨셉**: 수집 0건이면 `runPostOffice.js` 또는 `wconceptOutbound.js`(주문확인 포함). `wconceptReadyExtract.js` 는 읽기전용이라 0건이 정상 → 오진 주의. 배달완료 가드 해제(`WC_ALLOW_DELIVERED=1`)는 사장님 승인 후 수동으로만.
- **무신사**: "신규 0건"을 믿지 말고 배송출고처리 그리드 행수를 본다. AG-Grid 우클릭 엑셀은 마스킹 → 접수에 사용 금지.
- **조선몰**: 우체국 파이프라인 밖(10:30 단독).
- **영문몰(shop2)**: 국제배송 = **페덱스뿐**. 라벨은 `enMallOutbound.js --label <주문번호>` 로 사람이 지시할 때만(호출 즉시 운임 발생).
  `--label` 한 번에 **발급 → 공유드라이브 사본 → Xprinter 인쇄 → 카페24 송장입력(페덱스 코드 `0027`)** 까지 간다(사장님 9/18: 인쇄하면 송장은 바로 입력). 이미 뽑은 라벨은 `--tracking <주문> <송장>`. 치수가 곧 운임(박스 3종, 밴드는 박스 계산 제외).
  🔴 **라벨 발급 ≠ 픽업 예약.** `pickupType=USE_SCHEDULED_PICKUP` 은 정기 픽업이 있다는 뜻일 뿐 기사를 부르지 않는다 — 픽업은 따로 잡는다(당일 마감 15:30·토 13:00).
  발급 전 **Rate API 로 무료 운임 조회** 가능. 통관 신고 원산지 = **무브먼트국**(설월·기원=CH, `fedexShip.cooFor`), HS 910211. 라벨 원본은 tmp 라 공유드라이브 `다운로드/페덱스라벨/` 에 복사.
  통관 정보요청 메일은 **harriotwatches@gmail.com** 으로 오고, 첨부 **watch worksheet** 양식을 채워야 한다.
- **카페24 배송완료 전환**은 크론이 한다. 네이버페이 주문은 API 불가 → 7일 넘게 정체되면 판매자센터 수동.
(smartstore-dispatch-cancel-window · kakao-gift-channel-economics · postoffice-outbound · harriot-en-mall-outbound-gap · boxspec-shipping-dimensions · fedex-customs-and-label-certification · cafe24-delivery-complete-auto)

## 7. 라벨 인쇄·운영 함정
- 큐는 5분 주기, 노트북은 20초 폴링이라 **나눠 나온다.** "N장밖에 안 나왔다"면 `print_job` 에 `queued` 가 남았는지부터.
- 라벨은 우체국 값이 아니라 **우리 DB 값을 찍는다** — DB 가 틀리면 라벨도 틀린다.
- **local-agent 코드를 고쳤으면 그 코드를 쓰는 상시 워커(register-queue 등)를 재시작**. 안 하면 옛 코드로 계속 돈다(8/4~8/28 선불 반품 사고).
- 우체국 API 파라미터를 바꿀 땐 TEST 접수로 먼저 — 단 `register.js` 가 `.env` 를 override 로 다시 읽으므로 **`.env` 값을 직접 바꿔야** TEST 가 걸린다.
- 발신자명 변경 요청 = 공급지를 새로 만들지 말고 배송메시지에 "발신: ○○○".
(postoffice-label-self-print · postparcel-return-paytype · epost-sender-office-mijin)

## 8. 물량 질문 ("내일 몇 개?")
추측하지 말고 센다: ①카페24 미출고(N00~N22, 폴바이스 shop1 + 해리엇 shop1·2) + ②채널별 요일 평균.
월요일은 화~금의 약 2.1배(무신사 4.7x·W컨셉 3.4x). 공구 같은 일회성은 평균에서 뺀다. (monday-dispatch-volume-pattern)
