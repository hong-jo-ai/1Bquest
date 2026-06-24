-- 리뷰 토큰 짧은 링크 — 긴 base64url 토큰을 /r/<code> 짧은 코드로 매핑.
create table if not exists review_links (
  code text primary key,
  token text not null,
  mall text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists idx_review_links_created on review_links (created_at);
