import * as SecureStore from 'expo-secure-store';

import { CognitoError, refresh, type Tokens } from './cognito';

const KEY = 'xpense.session';
let cached: Tokens | null | undefined;

export async function loadSession(): Promise<Tokens | null> {
  if (cached === undefined) {
    const raw = await SecureStore.getItemAsync(KEY);
    cached = raw ? (JSON.parse(raw) as Tokens) : null;
  }
  return cached;
}

export async function saveSession(tokens: Tokens | null): Promise<void> {
  cached = tokens;
  if (tokens) await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
  else await SecureStore.deleteItemAsync(KEY);
}

/** Valid access token, refreshed when it is about to expire; null when the user must sign in again. */
export async function accessToken(): Promise<string | null> {
  const t = await loadSession();
  if (!t) return null;
  if (t.expiresAt - 60_000 > Date.now()) return t.accessToken;
  try {
    const next = await refresh(t);
    await saveSession(next);
    return next.accessToken;
  } catch (e) {
    if (e instanceof CognitoError) {
      await saveSession(null); // refresh token expired or revoked
      return null;
    }
    throw e; // offline: keep the session
  }
}
