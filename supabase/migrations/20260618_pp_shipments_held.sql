-- 발송보류(held) 상태 추가 — 송장은 발급됐지만 실제 발송 안 한 건.
-- 모든 채널 송장입력(dispatch)이 status='submitted'만 처리하므로, held로 두면 자동 제외됨.
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'pp_shipments'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%submitted%';
  if cname is not null then execute format('alter table pp_shipments drop constraint %I', cname); end if;
end $$;
alter table pp_shipments add constraint pp_shipments_status_check
  check (status in ('pending','submitted','printed','collected','cancelled','error','held'));
