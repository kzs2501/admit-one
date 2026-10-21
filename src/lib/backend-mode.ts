/**
 * Which backend answers `/api/*`: the sandbox in the browser (the default, and the
 * public demo), or the server on Postgres. Chosen when the app is built, with
 * `NEXT_PUBLIC_BACKEND=server`, so each build has one answer and no runtime switch.
 */
export const isServerMode = process.env["NEXT_PUBLIC_BACKEND"] === "server";
