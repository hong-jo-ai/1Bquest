-- 카드 사용내역 통합 테이블
-- 네이버페이 영수증, KB카드, 현대카드, 우리카드 등 모두 같은 형식으로 저장.
-- source 컬럼으로 구분 + 승인번호 unique로 중복 방지.

create table if not exists finance_card_usage (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references finance_businesses(id) on delete cascade,
  source          text not null,                  -- 'npay' | 'card_kb' | 'card_hyundai' 등
  card_company    text,                            -- '현대' | '하나(외환)' | 'KB국민' 등
  card_number     text,                            -- 마스킹된 번호
  approval_no     text,                            -- 승인번호
  use_date        timestamptz not null,            -- 결제일시
  cancel_date     timestamptz,                     -- 취소일시 (있으면)
  merchant        text,                            -- 가맹점명 또는 상품명
  amount          numeric not null default 0,     -- 승인금액
  cancel_amount   numeric not null default 0,     -- 취소금액
  supply_amount   numeric,                         -- 공급가액
  tax_amount      numeric,                         -- 부가세액
  installment     text,                            -- '체크/일시불' 등
  category        text,                            -- 분류 카테고리
  category_source text,                            -- 'rule' | 'manual' | 'ai'
  raw             jsonb,
  created_at      timestamptz not null default now(),
  -- 중복 방지: 사업자 + source + 승인번호 + 결제일시
  unique (business_id, source, approval_no, use_date)
);

create index if not exists idx_finance_card_usage_business_date on finance_card_usage (business_id, use_date desc);
create index if not exists idx_finance_card_usage_source on finance_card_usage (source);
create index if not exists idx_finance_card_usage_category on finance_card_usage (category);
create index if not exists idx_finance_card_usage_approval on finance_card_usage (approval_no);
