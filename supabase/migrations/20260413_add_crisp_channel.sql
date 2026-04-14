-- CS 인박스에 'crisp' 채널 추가
-- 실행: Supabase SQL Editor

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
    'sixshop_board'
  ));

-- 식스샵 게시판을 위에 이미 추가했으므로 이 파일만 다시 실행해도 멱등
