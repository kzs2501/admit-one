import { defineConfig } from "drizzle-kit";

/** Migrations are generated from the schema (`npm run db:generate`) and committed as SQL. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/backend/postgres/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "postgres://admit@localhost:54329/dresscircle" },
});
