import type { Summary } from "./summary";

/** Spending alerts (FR-10). Each SK is written with attribute_not_exists, so an alert fires once per period. */
export interface Alert {
  sk: string;
  kind: "pct80" | "pct100" | "daily";
  title: string;
  body: string;
}

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmt = (minor: number) => cop.format(Math.trunc(minor / 100));

export function dueAlerts(s: Summary, today: string): Alert[] {
  if (s.inflowsMinor <= 0) return []; // not onboarded: nothing to compare against
  const out: Alert[] = [];
  const days = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;
  if (s.pctUsed >= 100) {
    out.push({
      sk: `ALERT#${s.month}#pct100`,
      kind: "pct100",
      title: "Llegaste a tu límite del mes",
      body: `Cada gasto extra sale de tu meta de ahorro de ${fmt(s.savingsGoalMinor)}. Quedan ${days(s.daysLeft)}.`,
    });
  } else if (s.pctUsed >= 80) {
    out.push({
      sk: `ALERT#${s.month}#pct80`,
      kind: "pct80",
      title: `Ya usaste el ${s.pctUsed}% de tu presupuesto`,
      body: `Te quedan ${fmt(s.remainingMinor)} para ${days(s.daysLeft)}: gasta máximo ${fmt(s.dailyLimitMinor)} al día para cumplir tu meta.`,
    });
  }
  if (s.safeToSpendTodayMinor < 0) {
    out.push({
      sk: `ALERT#${s.month}#daily#${today}`,
      kind: "daily",
      title: "Pasaste tu límite de hoy",
      body: `Hoy llevas ${fmt(s.spentTodayMinor)} y tu límite era ${fmt(s.dailyLimitMinor)}. Mañana tu límite será menor.`,
    });
  }
  return out;
}
