-- 재무 관리 — 사업자별 은행 거래내역 + 세금계산서
-- 우선 은행 거래내역만 (Phase 1). 세금계산서는 추후 phase에서 추가.

create table if not exists finance_businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  registration_number text,        -- 사업자등록번호 (선택)
  representative      text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 시드: 기본 사업자 (해리엇와치스)
insert into finance_businesses (name, is_default)
select '해리엇와치스', true
where not exists (select 1 from finance_businesses where is_default = true);

create table if not exists finance_bank_tx (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references finance_businesses(id) on delete cascade,
  bank          text not null,                  -- 'KB' | 'Woori' 등
  account_number text,
  tx_date       timestamptz not null,           -- 거래일시
  description   text,                            -- 적요 (체크카드, 전자금융 등)
  counterparty  text,                            -- 보낸분/받는분
  memo          text,                            -- 송금메모
  withdrawal    numeric not null default 0,     -- 출금액
  deposit       numeric not null default 0,     -- 입금액
  balance       numeric,                         -- 잔액
  branch        text,                            -- 거래점
  category      text,                            -- 자동/수동 분류 카테고리
  category_source text,                          -- 'rule' | 'manual' | 'ai'
  raw           jsonb,                           -- 원본 행
  -- 중복 방지: 같은 사업자 + 시점 + 잔액 + 출금/입금 조합으로 unique
  dedupe_key    text generated always as (
    coalesce(business_id::text, '') || '|' ||
    extract(epoch from tx_date)::text || '|' ||
    coalesce(balance::text, '') || '|' ||
    withdrawal::text || '|' ||
    deposit::text
  ) stored,
  created_at    timestamptz not null default now(),
  unique (dedupe_key)
);

create index if not exists idx_finance_bank_tx_business_date on finance_bank_tx (business_id, tx_date desc);
create index if not exists idx_finance_bank_tx_category on finance_bank_tx (category);
