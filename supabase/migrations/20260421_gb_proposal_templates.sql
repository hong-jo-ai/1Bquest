-- 공동구매 제안 템플릿 + 캠페인별 보낸 제안메시지
-- 2026-04-21

-- 제안 템플릿 라이브러리
create table if not exists gb_proposal_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text check (platform in ('instagram','youtube','tiktok','all')),
  body text not null,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gb_proposal_templates_platform_idx
  on gb_proposal_templates (platform);

drop trigger if exists gb_proposal_templates_updated_at on gb_proposal_templates;
create trigger gb_proposal_templates_updated_at
  before update on gb_proposal_templates
  for each row execute function gb_set_updated_at();

alter table gb_proposal_templates enable row level security;

-- 캠페인에 실제 보낸 제안메시지 기록
alter table gb_campaigns
  add column if not exists proposal_message text;
