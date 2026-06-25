-- 상품 리뷰 연결(그룹) — 색상만 다른 같은 컬렉션 등 여러 상품의 리뷰를 공유 노출.
-- 같은 group_key 의 상품들은 위젯에서 서로의 리뷰를 함께 보여준다(리뷰에이드 연동 대체).
create table if not exists review_link_groups (
  id bigint generated always as identity primary key,
  mall text not null,
  group_key text not null,       -- 같은 키 = 한 그룹
  product_no int not null,
  created_at timestamptz not null default now(),
  unique (mall, product_no)      -- 한 상품은 한 그룹에만
);
create index if not exists idx_rlg_lookup on review_link_groups (mall, group_key);
