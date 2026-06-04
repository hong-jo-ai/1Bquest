-- AS(수리) 추적 스키마
-- 2026-06-04
-- 실행: Supabase Dashboard → SQL Editor 에서 전체 실행
--
-- 설계 메모:
--   수리 건수가 많지 않아 물리 라벨/QR 없이도, "기록에 라벨을 붙이는" 방식으로
--   완료품을 다시 고객에 연결한다. 핵심 매칭 키 = brand + model + symptom.
--   (예: 해리엇 / 가양 실버 / 바늘 수리 → 검색하면 그 접수 건이 바로 뜬다)

create extension if not exists "pgcrypto";

create table if not exists as_requests (
  id uuid primary key default gen_random_uuid(),

  -- 접수번호: AS-YYMMDD-NNN (KST 일자 + 당일 순번). 화면/구두 식별용.
  as_number text not null unique,

  -- 원래 CS 대화와 연결 (있으면 1클릭으로 원문/연락처 복귀)
  cs_thread_id uuid references cs_threads(id) on delete set null,

  brand text not null check (brand in ('paulvice','harriot')),

  -- 고객 정보 (누락돼도 model+symptom 으로 보완 가능)
  customer_name  text,
  customer_phone text,
  channel        text,   -- 어디로 들어온 접수인지 (카카오/메일/게시판 등, 자유 입력)

  -- ★ 매칭 키 ─────────────────────────────
  model   text,          -- 모델명 (예: 가양 실버)
  symptom text,          -- 증상, 고객 표현 (예: 초침이 안 움직임)
  -- ───────────────────────────────────────

  destination text check (destination in ('office','center')), -- 사무실(간단)/수리센터

  status text not null default 'intake'
    check (status in ('intake','repairing','repaired','notified','shipped')),

  -- 수리 후 채우는 칸
  repair_detail      text,   -- 수리내역 (예: 바늘 수리)
  repair_cost        integer,-- 비용 (원)
  return_tracking_no text,   -- 반송 송장번호
  note               text,   -- 비고

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipped_at timestamptz     -- 발송완료 시각
);

create index if not exists as_requests_status_idx
  on as_requests (status, created_at desc);
create index if not exists as_requests_brand_idx
  on as_requests (brand, created_at desc);

-- updated_at 자동 갱신 (cs 스키마의 함수 재사용; 없을 경우 대비해 재정의)
create or replace function cs_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists as_requests_updated_at on as_requests;
create trigger as_requests_updated_at
  before update on as_requests
  for each row execute function cs_set_updated_at();

-- RLS: service_role 키로만 접근 (단일 운영자 대시보드). public 전면 차단.
alter table as_requests enable row level security;
