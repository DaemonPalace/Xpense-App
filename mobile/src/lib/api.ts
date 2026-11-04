import { config } from './config';
import { accessToken } from './session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let onUnauthorized = () => {};
export const setOnUnauthorized = (fn: () => void) => void (onUnauthorized = fn);

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  if (!token) {
    onUnauthorized();
    throw new ApiError(401, 'unauthorized', 'Session expired');
  }
  const res = await fetch(config.apiUrl + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? '');
  }
  return json as T;
}

/** Mirror of backend/src/lib/summary.ts Summary plus the /api/summary extras. */
export interface Summary {
  today: string;
  currency: string;
  consented: boolean;
  onboarded: boolean;
  month: string;
  daysLeft: number;
  inflowsMinor: number;
  savingsGoalMinor: number;
  savedMinor: number;
  allowedMinor: number;
  spentMinor: number;
  spentTodayMinor: number;
  remainingMinor: number;
  dailyLimitMinor: number;
  safeToSpendTodayMinor: number;
  pctUsed: number;
  status: 'ok' | 'warning' | 'over';
}
