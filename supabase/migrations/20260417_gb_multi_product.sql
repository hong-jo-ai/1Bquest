-- 공동구매 다중 상품 지원 + 캠페인 간소화
-- 2026-04-17
-- 실행: Supabase Dashboard → SQL Editor 에서 전체 실행

-- 1. 캠페인에서 단일 상품 컬럼 제거
alter table gb_campaigns
  drop column if exists product_sku,
  drop column if exists product_name,
  drop column if exists product_image,
  drop column if exists original_price,
  drop column if exists discount_price,
  drop column if exists allocated_stock;

-- 2. 캠페인 상품 테이블 (다중 상품)
create table if not exists gb_products (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references gb_campaigns(id) on delete cascade,

  product_sku text,
  product_name text not null,
  product_image text,
  original_price int,
  discount_price int,
  allocated_stock int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gb_products_campaign_idx
  on gb_products (campaign_id);

-- 3. 주문에 product_id 추가 (어떤 상품 주문인지)
alter table gb_orders
  add column if not exists product_id uuid references gb_products(id) on delete set null;

-- 4. updated_at 트리거
drop trigger if exists gb_products_updated_at on gb_products;
create trigger gb_products_updated_at
  before update on gb_products
  for each row execute function gb_set_updated_at();

-- 5. RLS
alter table gb_products enable row level security;
