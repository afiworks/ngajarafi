CREATE TABLE `teacher_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL,
	`version` text NOT NULL
);
