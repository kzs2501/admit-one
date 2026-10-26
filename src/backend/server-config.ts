/**
 * What the server backend needs from its environment, read once when it starts. In
 * development and in tests, anything unset falls back to a local default. Anywhere
 * else, a missing setting stops the server, so a deployment can never run with a
 * known webhook secret, sign tickets with the public demo key, or hash requests with a
 * key anyone can read here.
 */
import { RAZORPAY_API_URL, type RazorpaySettings } from "@/backend/razorpay/settings";
import { signDemoTicket } from "@/core/demo-ticket-key";
import {
  DEFAULT_SERVER_KEY_ID,
  isTicketKeyId,
  signTicket,
  ticketKeyFrom,
  type TicketClaims,
} from "@/core/ticket-token";

export interface ServerConfig {
  databaseUrl: string;
  webhookSecret: string;
  signTicket: (claims: TicketClaims) => string;
  /** Lets a scheduler call the delivery endpoint (`CRON_SECRET`); without it, the endpoint is off. */
  deliverySecret: string | null;
  /** Keys the hash Idempotency-Keys compare requests by (`http/idempotency.ts`). */
  fingerprintSecret: string;
  /**
   * The header that holds the client's IP, set by a proxy the server trusts: the rate
   * limit's key. On Vercel it's `x-forwarded-for`, which Vercel sets and overwrites, so
   * a client can't choose it; elsewhere, `TRUSTED_CLIENT_IP_HEADER` names it. Without
   * one, the server can't tell clients apart, and doesn't limit them.
   */
  clientIpHeader: string | null;
  /** Razorpay's test mode, when its keys are set: then the server takes payment through it, not the simulated provider. */
  razorpay: RazorpaySettings | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

const LOCAL_DATABASE_URL = "postgres://admit@localhost:54329/admit_one";
const LOCAL_WEBHOOK_SECRET = "whsec_development_only";
const LOCAL_FINGERPRINT_SECRET = "fingerprint_development_only";
const REQUIRED = ["DATABASE_URL", "WEBHOOK_SECRET", "TICKET_SIGNING_KEY", "FINGERPRINT_SECRET"] as const;

/** An empty setting is an unset one. */
const setting = (env: Environment, name: string) => (env[name] === "" ? undefined : env[name]);

/** Only development and tests may fall back to local defaults. */
const isLocal = (env: Environment) => env["NODE_ENV"] === "development" || env["NODE_ENV"] === "test";

const RAZORPAY_SETTINGS = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const;

/**
 * All three of Razorpay's settings, or none. Half a set is a mistake worth stopping for:
 * without the webhook secret, say, payments would be taken and never settled. Only
 * test-mode keys are taken — this is a demo, and no one should pay real money into it.
 */
function razorpayFrom(env: Environment): RazorpaySettings | null {
  const [keyId, keySecret, webhookSecret] = RAZORPAY_SETTINGS.map((name) => setting(env, name));
  if (keyId === undefined && keySecret === undefined && webhookSecret === undefined) return null;
  if (keyId === undefined || keySecret === undefined || webhookSecret === undefined) {
    const missing = RAZORPAY_SETTINGS.filter((name) => setting(env, name) === undefined);
    throw new Error(`Razorpay needs all of ${RAZORPAY_SETTINGS.join(", ")}; ${missing.join(", ")} isn't set.`);
  }
  if (!keyId.startsWith("rzp_test_")) {
    throw new Error("RAZORPAY_KEY_ID must be a test-mode key (rzp_test_…): this server takes no real payments.");
  }
  return { keyId, keySecret, webhookSecret, apiUrl: setting(env, "RAZORPAY_API_URL") ?? RAZORPAY_API_URL };
}

export function serverConfigFrom(env: Environment): ServerConfig {
  const missing = REQUIRED.filter((name) => setting(env, name) === undefined);
  if (missing.length > 0 && !isLocal(env)) {
    throw new Error(`The server backend needs ${missing.join(", ")} outside development and tests.`);
  }
  const keyId = setting(env, "TICKET_KEY_ID") ?? DEFAULT_SERVER_KEY_ID;
  if (!isTicketKeyId(keyId)) {
    throw new Error(`TICKET_KEY_ID must be lowercase letters, digits and hyphens (at most 32): ${keyId}`);
  }
  const secret = setting(env, "TICKET_SIGNING_KEY");
  const key = secret === undefined ? null : { kid: keyId, secretKey: ticketKeyFrom(secret) };
  return {
    databaseUrl: setting(env, "DATABASE_URL") ?? LOCAL_DATABASE_URL,
    webhookSecret: setting(env, "WEBHOOK_SECRET") ?? LOCAL_WEBHOOK_SECRET,
    signTicket: key ? (claims) => signTicket(claims, key) : signDemoTicket,
    deliverySecret: setting(env, "CRON_SECRET") ?? null,
    fingerprintSecret: setting(env, "FINGERPRINT_SECRET") ?? LOCAL_FINGERPRINT_SECRET,
    clientIpHeader:
      setting(env, "TRUSTED_CLIENT_IP_HEADER")?.toLowerCase() ?? (env["VERCEL"] === "1" ? "x-forwarded-for" : null),
    razorpay: razorpayFrom(env),
  };
}
