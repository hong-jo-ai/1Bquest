-- 외부 채널(무신사·29CM·W컨셉) 상품평을 자사몰 위젯에 노출하기 위한 수집 테이블.
-- 공개 상품페이지의 리뷰 API에서 긁어와 자사몰 product_no로 매칭 저장(출처 표기).
create table if not exists channel_reviews (
  id bigint generated always as identity primary key,
  channel text not null,                       -- 'musinsa' | '29cm' | 'wconcept'
  channel_review_id text not null,             -- 플랫폼 리뷰 고유 id (중복방지)
  channel_goods_no text,                        -- 플랫폼 상품 id
  channel_goods_name text,                      -- 플랫폼 상품명
  product_no integer,                           -- 매칭된 자사몰 product_no (nullable)
  mall text not null default 'paulvice_kr',
  rating numeric,                               -- 별점(1~5)
  content text,
  author text,                                  -- 작성자(마스킹)
  photos jsonb not null default '[]'::jsonb,    -- 사진 URL 배열
  review_date timestamptz,                      -- 원본 작성일
  scraped_at timestamptz not null default now(),
  unique (channel, channel_review_id)
);
create index if not exists channel_reviews_product_idx on channel_reviews (product_no, channel);
create index if not exists channel_reviews_goods_idx on channel_reviews (channel, channel_goods_no);
