-- AS 회송지에 '주얼리(나비스트)' 추가
-- 2026-07-28
--
-- 배경: destination 이 office/center 2개뿐이라 주얼리 AS 를 담을 값이 없었다.
--   성북구 수리센터(김종근)는 시계 전용 — 주얼리는 공급처 (주)나비스트로 보내야 하는데
--   AS-260709-001(팔찌/버클 파손)은 어쩔 수 없이 center 로 기록하고 실제 회송지는 note 에
--   손으로 적어둔 상태였다. 같은 실수(주얼리를 시계 수리센터로 안내)를 막기 위해 값을 분리한다.
--
-- 실행: Supabase Dashboard → SQL Editor 에서 실행

alter table as_requests drop constraint if exists as_requests_destination_check;

alter table as_requests
  add constraint as_requests_destination_check
  check (destination in ('office', 'center', 'jewelry'));
