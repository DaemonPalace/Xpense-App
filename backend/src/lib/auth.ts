import { timingSafeEqual } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function requireOrigin(headers: Record<string, string | undefined>): void {
  const expected = Buffer.from(process.env.ORIGIN_SECRET ?? "");
  const got = Buffer.from(headers["x-origin-secret"] ?? "");
  if (!expected.length || got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new HttpError(403, "forbidden", "Forbidden");
  }
}

let verifier: { verify(token: string): Promise<Record<string, unknown>> } | undefined;

export async function requireUser(headers: Record<string, string | undefined>): Promise<{ sub: string; email?: string }> {
  const m = /^Bearer (.+)$/.exec(headers.authorization ?? "");
  if (!m) throw new HttpError(401, "unauthorized", "Missing token");
  verifier ??= CognitoJwtVerifier.create({
    userPoolId: process.env.USER_POOL_ID!,
    clientId: process.env.CLIENT_ID!,
    tokenUse: "access",
  }) as any;
  try {
    const payload = await verifier!.verify(m[1]);
    return { sub: String(payload.sub), email: payload.email as string | undefined };
  } catch {
    throw new HttpError(401, "unauthorized", "Invalid or expired token");
  }
}
