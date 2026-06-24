-- 리뷰 보상(적립금) 자동지급 + 국내 SMS 회원매칭 지원
-- reviews 테이블에 전화번호/보상상태 컬럼 추가.

alter table if exists reviews add column if not exists customer_phone text;
alter table if exists reviews add column if not exists reward_status text not null default 'pending';
  -- pending: 미지급, paid: 적립완료, skipped: 비회원/매칭실패로 건너뜀, failed: 지급실패
alter table if exists reviews add column if not exists reward_member_id text;   -- 매칭된 카페24 회원 아이디
alter table if exists reviews add column if not exists reward_paid_points int;  -- 실제 적립된 금액
alter table if exists reviews add column if not exists reward_paid_at timestamptz;
alter table if exists reviews add column if not exists reward_note text;         -- 실패/스킵 사유

create index if not exists idx_reviews_reward_status on reviews (mall, reward_status);

-- 요청 발송 로그에 채널(email/sms) 구분 — 기존 행은 email 로 간주.
alter table if exists review_request_log add column if not exists channel text not null default 'email';

-- 발송 타깃에 전화번호(국내 SMS용)
alter table if exists review_request_targets add column if not exists phone text;
