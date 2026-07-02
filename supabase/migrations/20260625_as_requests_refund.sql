-- AS 환불 처리 필드 추가 (처리유형 + 환불 추적)
-- 2026-06-25
-- 실행: Supabase Dashboard → SQL Editor 에서 전체 실행
--
-- 배경: AS는 수리/교환(재발송) 전용이라 환불 케이스를 담을 자리가 없었음.
--   CS인박스에서 들어오면 누를 수 있는 게 AS접수뿐이라, 환불도 AS에서 추적한다.
--   처리유형(수리/교환/환불)을 추가하고, 환불 건은 환불액·배송비공제·환불계좌·환불상태를 기록한다.
--   실제 송금은 수동(은행 API 없음) — 시스템은 기록/상태/안내까지.

alter table as_requests
  add column if not exists request_type text not null default 'repair'
    check (request_type in ('repair','exchange','refund'));

alter table as_requests add column if not exists refund_amount integer;              -- 실환불액(원)
alter table as_requests add column if not exists refund_shipping_deduction integer;  -- 배송비 공제(원, 단순변심 등)
alter table as_requests add column if not exists refund_account text;                -- 환불 계좌 (무통장 환불용)
alter table as_requests
  add column if not exists refund_status text
    check (refund_status in ('pending','done'));                                     -- 환불대기/환불완료
alter table as_requests add column if not exists refunded_at timestamptz;            -- 환불완료 시각

create index if not exists as_requests_request_type_idx
  on as_requests (request_type, created_at desc);
