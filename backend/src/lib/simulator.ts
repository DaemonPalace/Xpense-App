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

const P = (pesos: number) => pesos * 100; // COP → minor units

// A La Sabana student's month, in COP, using local merchants so categorize() and ant detection have real work.
const DAILY: Record<AccountType, [string, number, number, number][]> = {
  // [description, probability per day, min minor, max minor]
  checking: [
    ["Almuerzo restaurante campus", 0.45, P(12_000), P(22_000)],
    ["JUAN VALDEZ CAFE", 0.3, P(4_500), P(12_000)],
    ["Tienda OMA snack", 0.25, P(3_000), P(8_000)],
    ["Recarga TuLlave TransMilenio", 0.15, P(10_000), P(30_000)],
    ["Parqueadero Universidad", 0.2, P(6_000), P(12_000)],
    ["DIDI viaje", 0.08, P(9_000), P(25_000)],
    ["Droguería", 0.04, P(8_000), P(45_000)],
  ],
  credit_card: [
    ["RAPPI*RESTAURANTE", 0.12, P(25_000), P(60_000)],
    ["UBER viaje", 0.06, P(10_000), P(30_000)],
    ["Cine Colombia", 0.05, P(15_000), P(35_000)],
    ["Falabella compra", 0.04, P(50_000), P(250_000)],
    ["Librería Lerner", 0.03, P(20_000), P(120_000)],
  ],
  savings: [],
};

const MONTHLY: Record<AccountType, [number, string, number, "expense" | "savings"][]> = {
  // [day of month, description, minor, type]
  checking: [[3, "Plan celular internet", P(55_000), "expense"]],
  credit_card: [
    [15, "NETFLIX.COM", P(26_900), "expense"],
    [18, "SPOTIFY", P(16_900), "expense"],
    [3, "Gimnasio Bodytech", P(120_000), "expense"],
  ],
  savings: [
    [1, "Transferencia a ahorro", P(100_000), "savings"],
    [15, "Transferencia a ahorro", P(100_000), "savings"],
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
