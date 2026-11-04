import { log } from "./log";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Sends one notification to every token via Expo Push. Returns tokens Expo says are no longer registered. */
export async function sendPush(tokens: string[], title: string, body: string, correlationId?: string): Promise<string[]> {
  if (!tokens.length) return [];
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: "default", channelId: "alerts" }))),
  });
  if (!res.ok) {
    // Alert is already recorded and shown in-app; a failed push is logged, not retried.
    log("warn", "push send failed", { correlationId, status: res.status });
    return [];
  }
  const { data = [] } = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
  return tokens.filter((_, i) => data[i]?.status === "error" && data[i]?.details?.error === "DeviceNotRegistered");
}
