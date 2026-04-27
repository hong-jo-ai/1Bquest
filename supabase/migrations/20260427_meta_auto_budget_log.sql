-- 광고세트 자동 예산 조정 — 추천/적용 로그
-- Phase 1: 추천만 기록 (applied=false)
-- Phase 2: 실제 적용 시 applied=true, applied_at 채움
--
-- budget 컬럼은 Meta minor unit (KRW × 100). 표시 시 /100.

create table if not exists meta_auto_budget_log (
  id                 uuid primary key default gen_random_uuid(),
  run_date           date not null,
  account_id         text not null,
  account_name       text,
  adset_id           text not null,
  adset_name         text,
  campaign_name      text,
  spend_7d           numeric not null default 0,        -- 표시 단위 (원)
  roas_7d            numeric not null default 0,
  current_budget     bigint  not null default 0,        -- minor unit
  recommended_budget bigint  not null default 0,        -- minor unit
  delta_pct          numeric not null default 0,        -- e.g. 15, -15, 0
  action             text    not null,                  -- 'increase' | 'decrease' | 'maintain' | 'skipped'
  reason             text,                              -- 'roas_high' | 'roas_low' | 'roas_neutral' | 'low_spend' | 'min_floor'
  applied            boolean not null default false,
  applied_at         timestamptz,
  created_at         timestamptz not null default now(),
  unique (run_date, adset_id)
);

create index if not exists idx_mabl_run_date on meta_auto_budget_log (run_date desc);
create index if not exists idx_mabl_adset    on meta_auto_budget_log (adset_id, run_date desc);
