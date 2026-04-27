-- MADS (Meta Ads Decision System) — 의사결정 강제 시스템
--
-- 설계 원칙:
--   1. 추천만 생성 + 사용자 원클릭 승인. 자동 적용 X.
--   2. ROAS 숫자보다 신뢰등급(untrusted/learning/trusted/decaying) 우선.
--   3. 큰 주문 보정 ROAS, 72시간 변경 락, 흔들림 감지.
--
-- 폐기: meta_auto_budget_log (구 자동 예산 로그) → drop

drop table if exists meta_auto_budget_log;

-- ── 광고세트 (Meta sync 캐시) ──────────────────────────────────────────
create table if not exists mads_ad_sets (
  meta_adset_id         text primary key,
  meta_account_id       text not null,
  account_name          text,
  campaign_id           text,
  campaign_name         text,
  campaign_objective    text,
  name                  text,
  status                text not null,
  daily_budget          bigint,                       -- KRW (zero-decimal). null = CBO
  funnel_stage          text not null default 'unknown'
                        check (funnel_stage in ('prospecting','retargeting','unknown')),
  last_budget_change_at timestamptz,
  last_synced_at        timestamptz not null default now()
);
create index if not exists mads_ad_sets_account_idx on mads_ad_sets(meta_account_id);

-- ── 일별 메트릭 ────────────────────────────────────────────────────────
create table if not exists mads_daily_metrics (
  meta_adset_id       text not null references mads_ad_sets(meta_adset_id) on delete cascade,
  date                date not null,
  spend               numeric not null default 0,
  revenue             numeric not null default 0,
  conversions         int     not null default 0,
  impressions         bigint  not null default 0,
  clicks              bigint  not null default 0,
  ctr                 numeric,
  largest_order_value numeric not null default 0,    -- 큰 주문 보정용
  is_provisional      boolean not null default false, -- 24h 미경과
  fetched_at          timestamptz not null default now(),
  primary key (meta_adset_id, date)
);
create index if not exists mads_daily_metrics_date_idx on mads_daily_metrics(date desc);

-- ── 신뢰 등급 평가 ─────────────────────────────────────────────────────
create table if not exists mads_trust_evaluations (
  id                  uuid primary key default gen_random_uuid(),
  meta_adset_id       text not null references mads_ad_sets(meta_adset_id) on delete cascade,
  evaluated_at        timestamptz not null default now(),
  trust_level         text not null
                      check (trust_level in ('untrusted','learning','trusted','decaying')),
  conversions_7d      int     not null,
  spend_7d            numeric not null,
  revenue_7d          numeric not null,
  roas_7d             numeric not null,
  roas_3d             numeric not null,
  adjusted_roas_7d    numeric not null,           -- 큰 주문 1건 제외 ROAS
  largest_order_share numeric not null default 0,  -- largest / revenue_7d (왜곡 비율)
  prev_roas_7d        numeric,                     -- 직전 7일 ROAS (decaying 판정)
  reason              text
);
create index if not exists mads_trust_eval_adset_idx
  on mads_trust_evaluations(meta_adset_id, evaluated_at desc);

-- ── 추천 액션 ──────────────────────────────────────────────────────────
create table if not exists mads_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  meta_adset_id       text not null references mads_ad_sets(meta_adset_id) on delete cascade,
  trust_evaluation_id uuid references mads_trust_evaluations(id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz,                -- 통상 24~48h
  action_type         text not null
                      check (action_type in ('increase','decrease','pause','duplicate','creative_refresh','hold')),
  current_budget      bigint,
  recommended_budget  bigint,
  delta_pct           numeric,
  reason              text not null,
  warnings            jsonb not null default '[]'::jsonb,
  status              text not null default 'pending'
                      check (status in ('pending','accepted','rejected','ignored','expired','superseded')),
  acted_at            timestamptz,
  acted_result        jsonb
);
create index if not exists mads_rec_pending_idx
  on mads_recommendations(created_at desc) where status = 'pending';
create index if not exists mads_rec_adset_idx
  on mads_recommendations(meta_adset_id, created_at desc);

-- ── 의사결정 로그 (사후 분석용) ─────────────────────────────────────────
create table if not exists mads_decision_logs (
  id                      uuid primary key default gen_random_uuid(),
  recommendation_id       uuid references mads_recommendations(id) on delete cascade,
  decided_at              timestamptz not null default now(),
  decision                text not null,
  manual_action_count_24h int  not null default 0,
  note                    text
);
create index if not exists mads_decision_log_rec_idx on mads_decision_logs(recommendation_id);

-- ── 수동 액션 로그 (흔들림 감지) ────────────────────────────────────────
create table if not exists mads_manual_action_logs (
  id            uuid primary key default gen_random_uuid(),
  meta_adset_id text not null,
  action        text not null,        -- 'budget_change' | 'pause' | 'resume' | 'creative_change'
  source        text not null,        -- 'mads' | 'manual' | 'meta_ui'
  detail        jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists mads_manual_adset_idx
  on mads_manual_action_logs(meta_adset_id, created_at desc);

-- ── 시즌 가중치 ────────────────────────────────────────────────────────
create table if not exists mads_season_modifiers (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  start_date               date not null,
  end_date                 date not null,
  roas_threshold_modifier  numeric not null default 0,   -- ex: +0.2 → 임계값 BASE 2.5 → 2.7
  is_active                boolean not null default true,
  notes                    text,
  created_at               timestamptz not null default now()
);
create index if not exists mads_season_active_idx
  on mads_season_modifiers(start_date, end_date) where is_active = true;
