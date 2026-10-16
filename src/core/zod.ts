/**
 * Zod, configured once. Import `z` from here, never from "zod" — a lint rule enforces
 * it — so the configuration is in place before any schema is built.
 *
 * `jitless`: Zod compiles fast parsers with `new Function`, and first probes whether it
 * may. The Content Security Policy forbids eval, so the probe fails: harmlessly, but
 * the browser still reports a policy violation for it (ADR 009).
 */
import { z } from "zod";

z.config({ jitless: true });

export { z };
