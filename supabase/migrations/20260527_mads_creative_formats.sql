-- MADS: 광고세트별 소재 포맷 캐시
--
-- 성장 조언 엔진(growthAdvisor)의 '소재 유형 다양성' 규칙용.
-- 일일 동기화 시 활성 광고의 소재 포맷(video/image)을 수집해 저장.
-- 예: 전부 video면 image 소재 추가 권장.

alter table mads_ad_sets
  add column if not exists creative_formats text[];
