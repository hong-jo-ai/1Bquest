-- CRM 장바구니 이탈 넛지 — 자사몰 스크립트가 '담기' 이벤트를 적재, 크론이 미구매분에 단계별 넛지.
create table if not exists crm_cart_events (
  id            uuid primary key default gen_random_uuid(),
  mall          text not null,                       -- 'paulvice' | 'harriot' (위젯몰키=브랜드)
  shop_no       int  not null default 1,
  member_id     text not null,                       -- 카페24 로그인 회원 id
  product_no    int,
  product_name  text,
  quantity      int  not null default 1,
  cart_at       timestamptz not null default now(),  -- 담은 시각
  converted_at  timestamptz,                         -- 이후 해당상품 주문 확인 시 기록(넛지 중단)
  status        text not null default 'active',      -- active | converted | done | expired
  created_at    timestamptz not null default now()
);
create index if not exists crm_cart_events_member_idx on crm_cart_events(mall, member_id);
create index if not exists crm_cart_events_status_idx on crm_cart_events(status, cart_at);

-- CRM 발송 로그(패턴·단계별 중복방지) — 장바구니 외 다른 CRM 패턴도 공용.
create table if not exists crm_message_log (
  id          uuid primary key default gen_random_uuid(),
  pattern     text not null,                         -- 'cart_abandon' 등
  ref_id      text not null,                         -- crm_cart_events.id 등
  stage       text not null,                         -- '1h' | '24h' | '72h'
  mall        text not null,
  member_id   text,
  phone       text,
  channel     text,                                  -- 'alimtalk' | 'sms'
  status      text not null default 'sent',          -- sent | failed | skipped
  detail      text,
  sent_at     timestamptz not null default now(),
  unique (pattern, ref_id, stage)
);
