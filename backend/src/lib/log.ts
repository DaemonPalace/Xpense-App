import { ulid } from "ulid";

const SECRET_KEYS = new Set(["password", "token", "authorization", "accesstoken", "refreshtoken", "idtoken"]);
const component = process.env.COMPONENT ?? "unknown";

/** Strip secrets and mask long digit runs (account numbers) — FR-030. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\d{8,}/g, (d) => "****" + d.slice(-4));
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!SECRET_KEYS.has(k.toLowerCase())) out[k] = redact(v);
    }
    return out;
  }
  return value;
}

export function withCorrelation(id?: string | null): string {
  return id && /^[\w-]{1,64}$/.test(id) ? id : ulid();
}

export function log(level: "info" | "warn" | "error", message: string, fields: Record<string, unknown> & { correlationId?: string } = {}) {
  const line = JSON.stringify({ level, message, component, ...(redact(fields) as object) });
  (level === "error" ? console.error : console.log)(line);
}

export function errorFields(err: unknown) {
  return err instanceof Error ? { errorType: err.name, errorMessage: err.message } : { errorType: "Unknown", errorMessage: String(err) };
}
