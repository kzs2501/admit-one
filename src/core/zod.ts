/**
 * Zod, configured once. Import it from here as a namespace, `import * as z from
 * "@/core/zod"`, never from "zod" — a lint rule enforces the module — so the
 * configuration is in place before any schema is built.
 *
 * `jitless`: Zod compiles fast parsers with `new Function`, and first probes whether it
 * may. The Content Security Policy forbids eval, so the probe fails: harmlessly, but
 * the browser still reports a policy violation for it (ADR 009).
 *
 * Why a namespace, re-exported name by name: `import { z } from "zod"` is one object
 * holding all of Zod, every locale included, so a bundler keeps all of it (90 KB
 * gzip, on every page). Through a namespace import, it keeps only what's used.
 */
import { config } from "zod";

config({ jitless: true });

export * from "zod";
