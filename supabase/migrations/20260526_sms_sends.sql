-- 아웃바운드 고객 안내 SMS 발송 이력.
-- 배송지연·AS안내 등 공지성 메시지를 대시보드 /sms 에서 일괄 발송한 기록.
create table if not exists sms_sends (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  -- 발송 메시지 원문 (#{이름} 치환 전 템플릿)
  message_text    text not null,
  message_type    text not null default 'SMS',     -- SMS | LMS
  -- 대상 출처 설명 (예: "주문필터: 226 / 실버 / 배송보류" 또는 "수동입력")
  source_desc     text,
  recipient_count int  not null default 0,
  success_count   int  not null default 0,
  fail_count      int  not null default 0,
  est_cost        int,                              -- 예상 비용(원)
  group_id        text,                             -- Solapi groupId
  -- 수신자별 결과 [{ name, phone, status, messageId, error }]
  results         jsonb,
  is_test         boolean not null default false    -- 본인 테스트 발송 여부
);

create index if not exists sms_sends_created_at_idx on sms_sends (created_at desc);
