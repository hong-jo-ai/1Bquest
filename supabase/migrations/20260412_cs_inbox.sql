-- CS 통합 인박스 스키마
-- 2026-04-12
-- 실행: Supabase Dashboard → SQL Editor 에서 전체 실행

create extension if not exists "pgcrypto";

-- 1. 통합 대화 스레드
create table if not exists cs_threads (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('paulvice','harriot')),
  channel text not null check (channel in (
    'gmail',
    'threads',
    'ig_dm',
    'ig_comment',
    'channeltalk',
    'kakao_bizchat',
    'cafe24_board',
    'sixshop_board'
  )),
  external_thread_id text not null,
  customer_handle text,
  customer_name text,
  subject text,
  last_message_at timestamptz not null,
  last_message_preview text,
  status text not null default 'unanswered'
    check (status in ('unanswered','waiting','resolved','archived')),
  priority int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_thread_id)
);

create index if not exists cs_threads_status_time_idx
  on cs_threads (status, last_message_at desc);
create index if not exists cs_threads_brand_channel_idx
  on cs_threads (brand, channel);

-- 2. 개별 메시지
create table if not exists cs_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references cs_threads(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  external_message_id text,
  body_text text,
  body_html text,
  sent_at timestamptz not null,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cs_messages_thread_time_idx
  on cs_messages (thread_id, sent_at);
create index if not exists cs_messages_external_id_idx
  on cs_messages (external_message_id);

-- 3. 채널 계정 연결 (Gmail/Threads/IG/카페24 등 각 계정)
create table if not exists cs_accounts (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('paulvice','harriot')),
  channel text not null,
  display_name text,
  credentials jsonb,
  last_synced_at timestamptz,
  status text not null default 'active'
    check (status in ('active','paused','error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand, channel, display_name)
);

-- 4. updated_at 자동 갱신 트리거
create or replace function cs_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists cs_threads_updated_at on cs_threads;
create trigger cs_threads_updated_at
  before update on cs_threads
  for each row execute function cs_set_updated_at();

drop trigger if exists cs_accounts_updated_at on cs_accounts;
create trigger cs_accounts_updated_at
  before update on cs_accounts
  for each row execute function cs_set_updated_at();

-- 5. RLS: 이 앱은 service_role 키로만 접근 (단일 운영자 대시보드).
--    public 접근은 전면 차단.
alter table cs_threads  enable row level security;
alter table cs_messages enable row level security;
alter table cs_accounts enable row level security;

-- service_role은 RLS를 우회하므로 별도 policy 불필요.
-- anon/authenticated 역할에게는 어떤 policy도 부여하지 않음 → 전면 차단.
