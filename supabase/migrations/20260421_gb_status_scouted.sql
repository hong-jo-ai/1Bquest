-- 공동구매 상태에 'scouted'(발굴) 추가
-- 기존 'proposal' 라벨이 "발굴/제안"으로 묶여 있어 파이프라인 앞단을 분리
-- 2026-04-21

alter table gb_campaigns
  drop constraint if exists gb_campaigns_status_check;

alter table gb_campaigns
  add constraint gb_campaigns_status_check
  check (status in (
    'scouted','proposal','negotiating','confirmed','active',
    'shipped','pending_settle','settled','analyzed'
  ));

alter table gb_campaigns
  alter column status set default 'scouted';
