import { createHash } from "node:crypto";

export type AccountType = "checking" | "credit_card" | "savings";
export interface SimRow {
  externalId: string;
  date: string;
  description: string;
  amountMinor: number;
  type: "expense" | "savings";
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (s: string) => createHash("sha256").update(s).digest().readUInt32LE(0);

const DAILY: Record<AccountType, [string, number, number, number][]> = {
  // [description, probability per day, min cents, max cents]
  checking: [
    ["Grocery Market", 0.35, 1500, 9000],
    ["Corner Cafe", 0.3, 300, 900],
    ["Shell Gas Station fuel", 0.12, 3000, 6500],
    ["Uber trip", 0.08, 800, 3500],
    ["City Pharmacy", 0.04, 500, 4000],
  ],
  credit_card: [
    ["Amazon order", 0.2, 1200, 15000],
    ["Restaurant dinner", 0.15, 2500, 9000],
    ["Cinema tickets", 0.04, 1500, 4000],
    ["Department Store", 0.05, 2000, 12000],
  ],
  savings: [],
};

const MONTHLY: Record<AccountType, [number, string, number, "expense" | "savings"][]> = {
  // [day of month, description, cents, type]
  checking: [
    [1, "Rent payment", 140000, "expense"],
    [5, "Electric utility bill", 8500, "expense"],
    [8, "Internet service", 6000, "expense"],
    [20, "Water bill", 3500, "expense"],
  ],
  credit_card: [
    [15, "Netflix subscription", 1599, "expense"],
    [18, "Spotify subscription", 1099, "expense"],
    [3, "Gym membership", 4000, "expense"],
  ],
  savings: [
    [1, "Transfer to savings", 30000, "savings"],
    [15, "Transfer to savings", 30000, "savings"],
  ],
};

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** First sync starts on the 1st of the month 6 months ago, so history months are complete (research R8). */
export function firstSyncStart(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d.toISOString().slice(0, 10);
}

/** Deterministic per (accountId, day): re-syncing any range yields identical rows for the same days. */
export function generate(accountId: string, type: AccountType, fromDate: string, toDate: string): SimRow[] {
  const rows: SimRow[] = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const rand = mulberry32(seedOf(`${accountId}|${date}`));
    let seq = 0;
    const push = (description: string, amountMinor: number, t: "expense" | "savings") =>
      rows.push({ externalId: `${date}-${seq++}`, date, description, amountMinor, type: t });
    const dom = Number(date.slice(8, 10));
    for (const [day, description, cents, t] of MONTHLY[type]) if (day === dom) push(description, cents, t);
    for (const [description, p, min, max] of DAILY[type]) if (rand() < p) push(description, Math.round(min + rand() * (max - min)), "expense");
  }
  return rows;
}
