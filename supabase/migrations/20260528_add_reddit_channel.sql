-- CS 인박스에 'reddit' 채널 추가
-- 실행: Supabase SQL Editor
-- cs_threads.channel CHECK 제약에 reddit 포함 (cs_accounts.channel 은 CHECK 없음)

alter table cs_threads drop constraint if exists cs_threads_channel_check;
alter table cs_threads add constraint cs_threads_channel_check
  check (channel in (
    'gmail',
    'threads',
    'ig_dm',
    'ig_comment',
    'channeltalk',
    'crisp',
    'kakao_bizchat',
    'cafe24_board',
    'sixshop_board',
    'reddit'
  ));

-- 멱등: 다시 실행해도 안전
