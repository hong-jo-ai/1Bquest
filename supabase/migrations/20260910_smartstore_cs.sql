-- CS 인박스에 '스마트스토어(네이버)' 채널 추가. 멱등.
--
-- 다른 마켓(무신사·W컨셉)과 달리 스마트스토어는 **커머스 API 로 답변까지 보낼 수 있다**
-- (POST /v1/pay-merchant/inquiries/:inquiryNo/answer). 그래서 "알림만 보내고 어드민에서 처리"
-- 하는 마켓 CS 방침(2026-09-01)의 예외로, 인박스에서 읽고 답장까지 끝낸다.
alter table cs_threads drop constraint if exists cs_threads_channel_check;
alter table cs_threads add constraint cs_threads_channel_check
  check (channel in (
    'gmail','threads','ig_dm','ig_comment','channeltalk','crisp','webchat',
    'kakao_bizchat','cafe24_board','sixshop_board','reddit','sixshop','wconcept','musinsa',
    'smartstore'
  ));
