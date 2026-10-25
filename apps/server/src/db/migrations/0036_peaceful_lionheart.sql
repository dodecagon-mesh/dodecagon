CREATE TABLE `message_send_requests` (
	`user_id` integer NOT NULL,
	`client_request_id` text NOT NULL,
	`payload` text NOT NULL,
	`message_id` integer,
	`failure` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `client_request_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `message_send_requests_message_idx` ON `message_send_requests` (`message_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `client_request_id` text;