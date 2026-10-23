CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`institution` text,
	`external_key` text,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`opening_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_institution_external_key_unique` ON `accounts` (`institution`, coalesce("external_key", '')) WHERE "institution" is not null;--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_parent_name_unique` ON `categories` (coalesce("parent_id", 0), `name`);--> statement-breakpoint
CREATE TABLE `category_rules` (
	`id` integer PRIMARY KEY NOT NULL,
	`match_key` text NOT NULL,
	`category_id` integer NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_rules_match_key_unique` ON `category_rules` (`match_key`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`inserted_count` integer NOT NULL,
	`deleted_count` integer NOT NULL,
	`backup_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`time` text,
	`seq` integer,
	`amount` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`method` text,
	`memo` text,
	`card_label` text,
	`balance_after` integer,
	`raw` text,
	`import_id` integer,
	`transfer_peer_id` integer,
	`category_id` integer,
	`category_source` text,
	`edited_at` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transfer_peer_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transactions_amount_nonzero" CHECK("transactions"."amount" <> 0),
	CONSTRAINT "transactions_transfer_manual" CHECK("transactions"."kind" <> 'transfer' or "transactions"."source" = 'manual'),
	CONSTRAINT "transactions_adjustment_system" CHECK("transactions"."kind" <> 'adjustment' or "transactions"."source" = 'system')
);
--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);