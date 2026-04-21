-- 공동구매 상태에 'archived'(보관) 추가
-- 제안은 했지만 무응답으로 활성 파이프라인에서 빼되, 나중에 재제안 가능하도록 남겨둠
-- 2026-04-21

alter table gb_campaigns
  drop constraint if exists gb_campaigns_status_check;

alter table gb_campaigns
  add constraint gb_campaigns_status_check
  check (status in (
    'scouted','proposal','negotiating','confirmed','active',
    'shipped','pending_settle','settled','analyzed','archived'
  ));
