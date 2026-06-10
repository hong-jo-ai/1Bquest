-- 식스샵 CS: 마켓 채널 'sixshop' 추가 + 반품/교환 라이프사이클(item_type + cs_returns)
-- 실행: Supabase SQL Editor 또는 직접 적용. 멱등(재실행 안전).

-- 1) cs_threads.channel 에 'sixshop'(마켓; 기존 'sixshop_board' 게시판과 구분) 추가
alter table cs_threads drop constraint if exists cs_threads_channel_check;
alter table cs_threads add constraint cs_threads_channel_check
  check (channel in (
    'gmail','threads','ig_dm','ig_comment','channeltalk','crisp',
    'kakao_bizchat','cafe24_board','sixshop_board','reddit','sixshop'
  ));

-- 2) cs_threads.item_type: 'inquiry'(기본, 대화형) | 'return'(반품/교환 라이프사이클 카드)
alter table cs_threads add column if not exists item_type text not null default 'inquiry';
alter table cs_threads drop constraint if exists cs_threads_item_type_check;
alter table cs_threads add constraint cs_threads_item_type_check
  check (item_type in ('inquiry','return'));

-- 3) cs_returns: 반품/교환/취소 클레임 라이프사이클 (cs_threads 와 1:1)
create table if not exists cs_returns (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references cs_threads(id) on delete cascade,
  channel text not null,                          -- 'sixshop' 등 마켓
  order_number text not null,
  claim_type text not null default 'return',      -- return | exchange | cancel
  product text,
  reason text,
  customer_name text,
  recovery_tracking_no text,                       -- 회수 송장(있으면)
  status text not null default 'requested'
    check (status in ('requested','confirmed','in_transit','received','done','rejected')),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, order_number, claim_type)
);
alter table cs_returns enable row level security;
create index if not exists cs_returns_thread_idx on cs_returns(thread_id);
