-- CS 메일 분류에서 떨어진 건 기록
-- 2026-09-03
--
-- 배경: gmail 수집이 한 사이클에 40건 가까이를 "CS 아님"으로 떨어뜨리는데, 카운트만 있고
--   무엇이 왜 떨어졌는지 남지 않았다. 2026-09-03 박민 고객이 shong@ 로 보낸 [HARRIOT 문의]
--   (광안 사이즈·가격 오표기 항의)가 인박스에 들어오지 않았고, 고객이 웹챗으로도 같은 문의를
--   해준 덕분에 우연히 발견됐다. 메일로만 왔으면 아무도 몰랐다.
--   분류 실패(429)도 '스킵' 정책이라 조용히 사라진다 — 실패와 진짜 비CS를 구분할 수단이 필요하다.
--
-- 실행: Supabase Dashboard → SQL Editor 에서 실행

create table if not exists cs_classified_out (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  account text,                       -- 어느 메일함에서 걸렀는지 (display_name)
  gmail_message_id text not null,
  gmail_thread_id text,
  from_email text,
  from_name text,
  subject text,
  snippet text,
  category text,                      -- customer_inquiry | order_notification | marketing | system | newsletter | other
  confidence real,
  reason text,                        -- 분류기 사유. '분류 실패 → 스킵' 이면 429 등 오류다
  failed boolean not null default false,  -- 분류 자체가 실패한 건(재시도 대상)
  notified_at timestamptz,            -- 일일 요약에 포함된 시각
  created_at timestamptz not null default now()
);

-- 같은 메일이 매 사이클 재분류되므로 메시지당 1행만 유지(최신 판정으로 갱신).
create unique index if not exists cs_classified_out_msg_uniq
  on cs_classified_out (gmail_message_id);

create index if not exists cs_classified_out_created_idx
  on cs_classified_out (created_at desc);

-- 아직 요약 알림에 안 들어간 건 조회용
create index if not exists cs_classified_out_pending_idx
  on cs_classified_out (notified_at) where notified_at is null;
