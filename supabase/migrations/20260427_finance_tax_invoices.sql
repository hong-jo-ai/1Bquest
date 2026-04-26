-- 홈택스 전자세금계산서 (매입/매출)
-- 부가세 신고용 + 비용 검증용 (P&L 비용 집계는 통장+카드 기준이라 중복 방지)

create table if not exists finance_tax_invoices (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references finance_businesses(id) on delete cascade,
  invoice_type    text not null check (invoice_type in ('purchase', 'sales')),
  approval_no     text not null,                  -- 승인번호 (홈택스 unique)
  write_date      date,                            -- 작성일자
  issue_date      date,                            -- 발급일자
  partner_reg_no  text,                            -- 거래처 사업자등록번호
  partner_name    text,                            -- 거래처 상호
  partner_rep     text,                            -- 거래처 대표자
  partner_address text,                            -- 거래처 주소
  supply_amount   numeric not null default 0,     -- 공급가액 (음수 가능)
  tax_amount      numeric not null default 0,     -- 세액
  total_amount    numeric not null default 0,     -- 합계금액
  category        text,                            -- 자동 분류 (매입/수수료/매출 등)
  category_source text,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  -- 중복 방지: 같은 사업자 + 승인번호 unique
  unique (business_id, approval_no)
);

create table if not exists finance_tax_invoice_items (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid references finance_tax_invoices(id) on delete cascade,
  item_seq        int,                             -- 품목순번
  item_date       date,                            -- 품목일자
  item_name       text,                            -- 품목명
  spec            text,                            -- 규격
  quantity        numeric,                         -- 수량
  unit_price      numeric,                         -- 단가
  supply_amount   numeric not null default 0,     -- 공급가액
  tax_amount      numeric not null default 0,     -- 세액
  remark          text,                            -- 비고
  created_at      timestamptz not null default now()
);

create index if not exists idx_finance_tax_invoices_business_date on finance_tax_invoices (business_id, write_date desc);
create index if not exists idx_finance_tax_invoices_partner on finance_tax_invoices (partner_reg_no);
create index if not exists idx_finance_tax_invoice_items_invoice on finance_tax_invoice_items (invoice_id);

-- 사업자 등록번호 컬럼 (없으면 추가)
alter table finance_businesses
  add column if not exists registration_number text;
