-- 우체국 계약소포 접수/배송 추적 스키마
-- 2026-06-08
-- 실행: Supabase Dashboard → SQL Editor 에서 전체 실행

create extension if not exists "pgcrypto";

create table if not exists pp_shipments (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,           -- 채널 주문번호
  channel text not null,                -- 판매처 (카페24/식스샵/29CM/W컨셉 ...)
  req_type text not null default '1'     -- 1=일반소포(출고) / 2=반품소포
    check (req_type in ('1','2')),

  -- 수취인(반품 시 회수 대상)
  recipient_name text,
  recipient_addr text,
  recipient_zip text,
  recipient_mobile text,
  recipient_tel text,
  product_name text,
  qty int,

  -- 우체국 접수 결과
  regi_no text,                          -- 운송장(등기)번호 13자리. 테스트 시 'TESTREGINOAPI'
  req_no text,                           -- 소포 주문번호(소포신청번호, 18)
  res_no text,                           -- 소포 예약번호(16)
  price text,                            -- (예상)접수요금
  regipo_nm text,                        -- 접수 우체국명
  is_test boolean not null default false,

  -- 상태
  status text not null default 'submitted'
    check (status in ('pending','submitted','printed','collected','cancelled','error')),
  treat_status text,                     -- 우체국 처리상태코드(00신청준비/01소포신청/02운송장출력/03집하완료/04미집하/05신청취소)

  -- 종추적조회
  tracking_state text,                   -- 최신 배송상태 텍스트
  tracking_detail jsonb,                 -- 스캔 이력
  tracking_checked_at timestamptz,

  error_code text,
  error_message text,
  raw jsonb,

  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (order_number, channel, req_type)
);

create index if not exists pp_shipments_status_idx on pp_shipments (status, registered_at desc);
create index if not exists pp_shipments_regino_idx on pp_shipments (regi_no);
create index if not exists pp_shipments_channel_idx on pp_shipments (channel, registered_at desc);
