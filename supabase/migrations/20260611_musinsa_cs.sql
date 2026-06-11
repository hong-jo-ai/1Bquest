-- CS 인박스에 'musinsa' 마켓 채널 추가 (식스샵/W컨셉 CS와 동일 구조). 멱등.
alter table cs_threads drop constraint if exists cs_threads_channel_check;
alter table cs_threads add constraint cs_threads_channel_check
  check (channel in (
    'gmail','threads','ig_dm','ig_comment','channeltalk','crisp',
    'kakao_bizchat','cafe24_board','sixshop_board','reddit','sixshop','wconcept','musinsa'
  ));
