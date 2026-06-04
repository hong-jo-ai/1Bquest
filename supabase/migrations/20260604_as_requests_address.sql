-- AS 접수에 고객 반송 주소 추가
-- 2026-06-04
-- 택배 송장이 블라인드(개인정보 보호) 처리라 주소 확인이 안 됨 →
-- 접수 시점에 반송 주소를 직접 받아 기록한다.
-- 실행: Supabase Dashboard → SQL Editor 에서 실행 (이미 as_requests 테이블이 있는 상태에서 ALTER)

alter table as_requests add column if not exists customer_address text;
