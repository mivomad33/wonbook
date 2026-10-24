ALTER TABLE "categories" ADD COLUMN "color" text DEFAULT 'gray' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "icon" text DEFAULT 'tag' NOT NULL;--> statement-breakpoint
-- 기존 카테고리 채우기(design-refresh 명세서 4.5-3): 처음 카테고리 이름은 기본값(src/db/default-categories.ts와 같은 값),
-- 그 밖의 지출·수입은 묶음 안 순서대로 팔레트를 돌려 쓰고 아이콘은 기본값(tag), 이동은 회색으로 둔다.
UPDATE "categories" SET "color" = v.color, "icon" = v.icon
FROM (VALUES
  ('장보기', 'green', 'shopping-cart'),
  ('외식·배달', 'orange', 'utensils'),
  ('카페·간식', 'brown', 'coffee'),
  ('생활용품', 'teal', 'spray-can'),
  ('쇼핑·의류', 'rose', 'shirt'),
  ('주거·관리비', 'amber', 'house'),
  ('통신', 'sky', 'smartphone'),
  ('교통·차량', 'blue', 'bus'),
  ('의료·건강', 'red', 'heart-pulse'),
  ('육아·교육', 'pink', 'graduation-cap'),
  ('여가·여행', 'violet', 'plane'),
  ('구독·디지털', 'indigo', 'monitor-play'),
  ('세금·공과금', 'sky', 'landmark'),
  ('보험', 'blue', 'shield'),
  ('경조사·기부', 'violet', 'gift'),
  ('기타 지출', 'gray', 'circle-ellipsis'),
  ('급여', 'blue', 'briefcase'),
  ('정부 지원', 'teal', 'building-2'),
  ('부수입', 'violet', 'coins'),
  ('이자·배당', 'green', 'piggy-bank'),
  ('환급·캐시백', 'amber', 'receipt'),
  ('기타 수입', 'gray', 'wallet'),
  ('카드대금', 'gray', 'credit-card'),
  ('내 계좌·페이 이동', 'gray', 'arrow-left-right'),
  ('개인 송금', 'gray', 'send')
) AS v(name, color, icon)
WHERE "categories"."name" = v.name;--> statement-breakpoint
UPDATE "categories" SET "color" = (ARRAY['green', 'teal', 'sky', 'blue', 'indigo', 'violet', 'pink', 'rose', 'red', 'orange', 'amber', 'brown'])[((r.n - 1) % 12) + 1]
FROM (
  SELECT c.id, row_number() OVER (PARTITION BY c.user_id, c."group" ORDER BY c.sort_order, c.id) AS n
  FROM "categories" c
  WHERE c."group" <> 'move' AND c.name NOT IN ('장보기', '외식·배달', '카페·간식', '생활용품', '쇼핑·의류', '주거·관리비', '통신', '교통·차량', '의료·건강', '육아·교육', '여가·여행', '구독·디지털', '세금·공과금', '보험', '경조사·기부', '기타 지출', '급여', '정부 지원', '부수입', '이자·배당', '환급·캐시백', '기타 수입', '카드대금', '내 계좌·페이 이동', '개인 송금')
) AS r
WHERE "categories".id = r.id;
