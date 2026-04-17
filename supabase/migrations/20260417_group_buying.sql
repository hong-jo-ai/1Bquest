-- 공동구매 관리 시스템 스키마
-- 2026-04-17
-- 실행: Supabase Dashboard → SQL Editor 에서 전체 실행

-- 1. 공동구매 캠페인
create table if not exists gb_campaigns (
  id uuid primary key default gen_random_uuid(),

  -- 인플루언서 정보 (비정규화)
  influencer_handle text not null,
  influencer_name text,
  influencer_platform text check (influencer_platform in ('instagram','youtube','tiktok')),
  influencer_followers int,

  -- 캠페인 기본
  title text not null,
  status text not null default 'proposal'
    check (status in (
      'proposal','negotiating','confirmed','active',
      'shipped','pending_settle','settled','analyzed'
    )),

  -- 일정
  start_date date,
  end_date date,

  -- 조건
  commission_rate numeric(5,2),
  commission_type text not null default 'rate'
    check (commission_type in ('rate','fixed_per_unit')),
  commission_fixed_amount int,
  discount_price int,
  original_price int,

  -- 상품
  product_sku text,
  product_name text,
  product_image text,

  -- 재고 배정
  allocated_stock int not null default 0,

  -- 주문 모드
  order_mode text not null default 'cafe24'
    check (order_mode in ('cafe24','purchase_order')),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gb_campaigns_status_idx
  on gb_campaigns (status);

-- 2. 공구 주문
create table if not exists gb_orders (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references gb_campaigns(id) on delete cascade,

  -- Cafe24 주문 연동
  cafe24_order_id text,

  -- 발주서 주문
  customer_name text,
  customer_phone text,
  customer_address text,

  -- 공통
  product_name text,
  variant_name text,
  quantity int not null default 1,
  unit_price int not null,
  total_amount int not null,

  -- 배송
  shipping_status text not null default 'pending'
    check (shipping_status in ('pending','preparing','shipped','delivered','returned')),
  tracking_number text,
  tracking_carrier text,
  shipped_at timestamptz,
  delivered_at timestamptz,

  -- 반품
  is_returned boolean not null default false,
  return_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gb_orders_campaign_idx
  on gb_orders (campaign_id);
create index if not exists gb_orders_cafe24_idx
  on gb_orders (cafe24_order_id);

-- 3. 정산
create table if not exists gb_settlements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references gb_campaigns(id) on delete cascade,

  total_revenue int not null,
  total_quantity int not null,
  return_amount int not null default 0,
  net_revenue int not null,
  commission_amount int not null,
  shipping_cost int not null default 0,
  product_cost int not null default 0,
  net_profit int not null,

  settled_at timestamptz,
  receipt_url text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gb_settlements_campaign_idx
  on gb_settlements (campaign_id);

-- 4. 최저가 비교
create table if not exists gb_price_checks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references gb_campaigns(id) on delete cascade,

  channel text not null,
  price int not null,
  checked_at timestamptz not null default now(),
  is_lowest boolean not null default false,
  notes text
);

create index if not exists gb_price_checks_campaign_idx
  on gb_price_checks (campaign_id);

-- updated_at 트리거
create or replace function gb_set_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists gb_campaigns_updated_at on gb_campaigns;
create trigger gb_campaigns_updated_at
  before update on gb_campaigns
  for each row execute function gb_set_updated_at();

drop trigger if exists gb_orders_updated_at on gb_orders;
create trigger gb_orders_updated_at
  before update on gb_orders
  for each row execute function gb_set_updated_at();

drop trigger if exists gb_settlements_updated_at on gb_settlements;
create trigger gb_settlements_updated_at
  before update on gb_settlements
  for each row execute function gb_set_updated_at();

-- RLS: service_role 전용 (단일 운영자 대시보드)
alter table gb_campaigns enable row level security;
alter table gb_orders enable row level security;
alter table gb_settlements enable row level security;
alter table gb_price_checks enable row level security;
