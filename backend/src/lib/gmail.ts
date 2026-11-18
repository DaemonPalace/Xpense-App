import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { htmlToText, type MailInput } from "./mail";

// Gmail read-only access for bank alert e-mails. Client id/secret and the token key come from the stack
// (gitignored .google-oauth.json / .token-key); without them the feature reports "not configured".
export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const BACKFILL_DAYS = 30;
const MAX_MESSAGES = 500; // ponytail: per sync run; raise or paginate across runs if a user gets more alerts than this

// Gmail search matches whole tokens of the sender, so list each bank's sender domain token.
// ponytail: add a bank here when its alerts don't show up.
const SENDERS = ["bancolombia", "notificacionesbancolombia", "davivienda", "nequi", "bbva", "bancodebogota", "bancodeoccidente",
  "colpatria", "scotiabankcolpatria", "itau", "avvillas", "bancopopular", "daviplata", "bancofalabella", "rappipay",
  "nu", "lulobank", "bancocajasocial", "bancoagrario", "serfinanza"];

export const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI && process.env.TOKEN_KEY);

export class GmailAuthError extends Error {}

// ---- refresh token at rest: AES-256-GCM, so a table export alone doesn't expose Gmail access ----
const key = () => Buffer.from(process.env.TOKEN_KEY!, "base64");
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

/** fetch with a 10 s timeout and 3 tries on network errors / 5xx: Google occasionally hangs or answers 503. */
async function gfetch(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (res.status < 500 || attempt === 3) return res;
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
}

// ---- OAuth ----
export function authUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // always returns a refresh token, also on reconnect
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(params: Record<string, string>): Promise<any> {
  const res = await gfetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (body.error === "invalid_grant") throw new GmailAuthError("Gmail access expired or was revoked — reconnect Gmail");
  if (!res.ok) throw new Error(`Google token endpoint ${res.status}: ${JSON.stringify(body.error ?? "").slice(0, 200)}`);
  return body;
}

export async function exchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string }> {
  const t = await token({ code, grant_type: "authorization_code", redirect_uri: process.env.GOOGLE_REDIRECT_URI! });
  if (!String(t.scope ?? "").split(" ").includes(SCOPE)) throw new GmailAuthError("Gmail read permission was not granted");
  if (!t.refresh_token) throw new GmailAuthError("Google did not return a refresh token");
  return { refreshToken: t.refresh_token, accessToken: t.access_token };
}

export const accessToken = async (refreshToken: string): Promise<string> => (await token({ refresh_token: refreshToken, grant_type: "refresh_token" })).access_token;

export async function revoke(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => undefined);
}

// ---- Gmail API ----
async function gmail(access: string, path: string): Promise<any> {
  const res = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${access}` } });
  if (res.status === 401 || res.status === 403) throw new GmailAuthError("Gmail access expired or was revoked — reconnect Gmail");
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  return res.json();
}

export const profileEmail = async (access: string): Promise<string> => (await gmail(access, "profile")).emailAddress;

/** Gmail search for bank alerts received after `since`. */
export const searchQuery = (since: Date) => `from:(${SENDERS.join(" OR ")}) after:${Math.floor(since.getTime() / 1000)}`;

export async function listMessageIds(access: string, since: Date): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({ q: searchQuery(since), maxResults: "100", ...(pageToken ? { pageToken } : {}) });
    const page = await gmail(access, `messages?${q}`);
    ids.push(...(page.messages ?? []).map((m: any) => m.id));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && ids.length < MAX_MESSAGES);
  return ids.slice(0, MAX_MESSAGES);
}

const b64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** Gmail API message (format=full) → subject, text body and Date header. */
export function toMail(msg: any): MailInput & { id: string } {
  const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
  const header = (n: string) => headers.find((h) => h.name.toLowerCase() === n)?.value;
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: any) => {
    if (p?.body?.data && !p.filename) (p.mimeType === "text/html" ? html : p.mimeType === "text/plain" ? plain : []).push(b64(p.body.data));
    (p?.parts ?? []).forEach(walk);
  };
  walk(msg.payload);
  const date = header("date") ?? (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : undefined);
  return { id: msg.id, subject: header("subject"), body: plain.join("\n") || htmlToText(html.join("\n")), date };
}

export async function fetchMails(access: string, ids: string[]): Promise<(MailInput & { id: string })[]> {
  const out: (MailInput & { id: string })[] = [];
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map((id) => gmail(access, `messages/${id}?format=full`)));
    out.push(...batch.map(toMail));
  }
  return out;
}
