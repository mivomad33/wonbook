-- SQLite는 기본값 없는 not null 컬럼을 ADD COLUMN으로 더할 수 없다. 이 시점의 categories는 비어 있어(5단계 전에는 카테고리를 넣는 코드가 없다) 지우고 다시 만든다.
-- 마이그레이션은 트랜잭션 안에서 돌아 foreign_keys를 끌 수 없지만, 빈 테이블이라 지울 때 외래 키에 걸리지 않는다.
DROP TABLE `categories`;
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`group` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_parent_name_unique` ON `categories` (coalesce("parent_id", 0), `name`);
