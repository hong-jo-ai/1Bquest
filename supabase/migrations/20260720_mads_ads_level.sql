-- MADS 광고(개별 소재) 레벨 수집 — /ads 현황판이 Ads Manager를 대체할 수 있게.
--
--   mads_ads              : 개별 광고 레지스트리 (소재 썸네일·포맷·상태)
--   mads_ad_daily_metrics : 개별 광고 일별 인사이트 (spend/ROAS/CTR/CPM/빈도)
--   mads_daily_metrics    : 광고세트 레벨에 cpm/frequency/reach 컬럼 추가

create table if not exists mads_ads (
  meta_ad_id       text primary key,
  meta_adset_id    text not null,
  meta_account_id  text not null,
  name             text,
  effective_status text,
  creative_format  text,          -- video | image | unknown
  thumbnail_url    text,
  last_synced_at   timestamptz not null default now()
);
create index if not exists mads_ads_adset_idx on mads_ads(meta_adset_id);
create index if not exists mads_ads_account_idx on mads_ads(meta_account_id);

create table if not exists mads_ad_daily_metrics (
  meta_ad_id  text not null,
  date        date not null,
  spend       numeric not null default 0,
  revenue     numeric not null default 0,
  conversions int     not null default 0,
  impressions bigint  not null default 0,
  clicks      bigint  not null default 0,
  ctr         numeric,
  cpm         numeric,
  frequency   numeric,
  reach       bigint,
  fetched_at  timestamptz not null default now(),
  primary key (meta_ad_id, date)
);
create index if not exists mads_ad_daily_metrics_date_idx on mads_ad_daily_metrics(date desc);

alter table mads_daily_metrics add column if not exists cpm numeric;
alter table mads_daily_metrics add column if not exists frequency numeric;
alter table mads_daily_metrics add column if not exists reach bigint;
