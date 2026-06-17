-- PAULVICE 웹사이트 자체 상담 위젯 채널 추가.
-- 고객 위젯 수신/상담원 답장 모두 기존 cs_threads/cs_messages에 저장한다.

alter table cs_threads drop constraint if exists cs_threads_channel_check;
alter table cs_threads add constraint cs_threads_channel_check
  check (channel in (
    'gmail','threads','ig_dm','ig_comment','channeltalk','crisp','webchat',
    'kakao_bizchat','cafe24_board','sixshop_board','reddit','sixshop','wconcept','musinsa'
  ));
