CREATE TABLE "hold_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hold_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_key" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hold_attempts_by_client" ON "hold_attempts" USING btree ("client_key","at");--> statement-breakpoint
CREATE INDEX "hold_attempts_by_age" ON "hold_attempts" USING btree ("at");