#!/usr/bin/env python3
"""
여름 세트(상품 248) 목걸이 끼워팔기 옵션 → 원석 목걸이 재고 자동 보정.

배경: [여름세트] 상품 248의 "여름 원석 목걸이 추가" 옵션은 카페24 독립형 옵션이라
       팔려도 실제 목걸이 상품(213/209/211)의 재고를 자동 차감하지 않는다.
       이 스크립트가 248 주문의 목걸이 옵션을 읽어 해당 목걸이 상품 재고를 차감한다.

실행: iMac에서 주기적으로(launchd) 또는 수동.  python3 necklaceReconcile.py
인증: 배포 앱의 share-token 엔드포인트로 카페24 access token 획득(다른 로컬 스크립트와 동일).
상태: 처리한 주문아이템(order_item_code)을 state 파일에 기록 → 중복 차감 방지.
주의: 옵션 라벨이 바뀌면 NECKLACE_MAP 갱신 필요.
"""
import json, os, re, urllib.request, datetime

APP = "https://paulvice-dashboard.vercel.app"
SHARE_SECRET = "paulvice2026"
SET_PRODUCT_NO = 248
NECKLACE_OPTION_NAME_HINT = "원석 목걸이"      # 옵션명에 이 문자열 포함 시 목걸이 옵션으로 인식
NECKLACE_MAP = {                                # 옵션값(부분일치) → 목걸이 상품 product_no
    "화이트 오팔": 213,
    "오팔":        213,
    "로즈쿼츠":    209,
    "터키석":      211,
}
STATE_FILE = os.path.join(os.path.dirname(__file__), "necklaceReconcile.state.json")
BASE = "https://icaruse2000.cafe24api.com"
APIV = "2026-03-01"

def get_token():
    with urllib.request.urlopen(f"{APP}/api/auth/share-token?secret={SHARE_SECRET}", timeout=30) as r:
        return json.load(r)["access_token"]

def api(tok, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"Authorization": f"Bearer {tok}", "X-Cafe24-Api-Version": APIV, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def load_state():
    if os.path.exists(STATE_FILE):
        return set(json.load(open(STATE_FILE)))
    return set()

def save_state(s):
    json.dump(sorted(s), open(STATE_FILE, "w"))

def necklace_from_options(opts):
    """주문아이템 options 배열에서 목걸이 옵션값 → product_no."""
    for o in opts or []:
        name = str(o.get("name") or o.get("option_name") or "")
        val  = str(o.get("value") or o.get("option_value") or "")
        if NECKLACE_OPTION_NAME_HINT in name or "목걸이" in val:
            for key, pno in NECKLACE_MAP.items():
                if key in val:
                    return pno
    return None

def decrement(tok, product_no, qty):
    vs = api(tok, "GET", f"/api/v2/admin/products/{product_no}/variants").get("variants", [])
    if not vs:
        return False, "variant 없음"
    v = vs[0]; vc = v.get("variant_code")
    cur = int(float(v.get("quantity") or 0))
    new = max(0, cur - qty)
    api(tok, "PUT", f"/api/v2/admin/products/{product_no}/variants/{vc}",
        {"shop_no": 1, "request": {"quantity": new}})
    return True, f"{cur}→{new}"

def main():
    tok = get_token()
    done = load_state()
    # 최근 14일 주문
    end = datetime.date.today()
    start = end - datetime.timedelta(days=14)
    orders, off = [], 0
    while True:
        d = api(tok, "GET", f"/api/v2/admin/orders?start_date={start}&end_date={end}&limit=100&offset={off}&embed=items")
        b = d.get("orders", []); orders += b
        if len(b) < 100: break
        off += 100
    changes = 0
    for o in orders:
        if o.get("canceled") == "T":
            continue
        for it in o.get("items") or []:
            if int(it.get("product_no") or 0) != SET_PRODUCT_NO:
                continue
            code = it.get("order_item_code") or f"{o.get('order_id')}:{it.get('item_no')}"
            if code in done:
                continue
            pno = necklace_from_options(it.get("options"))
            if not pno:
                done.add(code)  # 목걸이 안 고른 세트 → 기록만(재처리 방지)
                continue
            qty = int(float(it.get("actual_quantity") or it.get("quantity") or 1)) or 1
            ok, msg = decrement(tok, pno, qty)
            print(f"[{o.get('order_id')}] 목걸이 {pno} -{qty} → {msg}")
            if ok:
                done.add(code); changes += 1
    save_state(done)
    print(f"완료. 보정 {changes}건, 누적 처리 {len(done)}건.")

if __name__ == "__main__":
    main()
