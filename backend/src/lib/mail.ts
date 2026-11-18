import { parseAmount } from "./money";

// Bank alert e-mails ("Bancolombia le informa Compra por $25.000,00 en RAPPI ...") forwarded by Zapier/Make.
// Only debits become transactions: the app tracks income separately, so credits are ignored.
// ponytail: keyword regexes cover the common Colombian alert wording; add a verb when a bank's mail is ignored.
const DEBIT = /\b(compra(ste)?|pago|pagaste|retiro|retiraste|transferencia|transferiste|enviaste|env[ií]o|d[eé]bito|cargo|avance)\b/i;
const CREDIT = /\b(recibiste|recibi[oó]|abono|consignaci[oó]n|te (enviaron|transfirieron)|dep[oó]sito|reembolso|devoluci[oó]n|pago de n[oó]mina)\b/i;
const AMOUNT = /(?:\$|COP)\s?(\d[\d.,]*)/;
const MERCHANT = /\ben\s+(.+?)(?=\s+(?:el|a las|con|desde|por|fecha|hora)\b|\s+\d{1,2}[:/]\d{2}|[.,;\n]|$)/i;

/** "25.000,00" / "25,000.00" / "25.000" → minor units. Colombian alerts use "." for thousands. */
export function parseCop(raw: string): number {
  const s = raw.replace(/[.,]+$/, "");
  const m = /^(.*?)[.,](\d{2})$/.exec(s);
  const whole = (m ? m[1] : s).replace(/[.,]/g, "");
  return parseAmount(`${whole}.${m ? m[2] : "00"}`);
}

export const htmlToText = (html: string) =>
  html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Calendar day in Bogotá (UTC-5, no DST) for an e-mail Date header; falls back to now. */
export function bogotaDay(date: string | undefined, now = new Date()): string {
  const d = date ? new Date(date) : now;
  return (isNaN(d.getTime()) ? now : d).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

export interface MailInput {
  subject?: string;
  body?: string;
  date?: string;
}

/** Debit alert → { date, description, amountMinor }; anything else → null. */
export function parseBankMail(mail: MailInput, now = new Date()): { date: string; description: string; amountMinor: number } | null {
  const subject = (mail.subject ?? "").trim();
  const text = `${subject}\n${mail.body ?? ""}`.replace(/[ \t ]+/g, " ");
  const m = AMOUNT.exec(text);
  if (!m) return null;
  // Judge the sentence around the amount: footers mention "pago"/"abono" in boilerplate.
  const start = Math.max(text.lastIndexOf("\n", m.index), m.index - 200, 0);
  const nl = text.indexOf("\n", m.index + m[0].length);
  const sentence = text.slice(start, nl === -1 ? undefined : nl);
  const verb = DEBIT.exec(sentence);
  if (!verb || CREDIT.test(sentence)) return null;
  let amountMinor: number;
  try {
    amountMinor = parseCop(m[1]);
  } catch {
    return null;
  }
  if (!amountMinor) return null;
  const merchant = MERCHANT.exec(sentence.slice(m.index + m[0].length - start)) ?? MERCHANT.exec(sentence);
  const name = merchant?.[1].replace(/^[\s*]+|[\s*]+$/g, "");
  const v = verb[0][0].toUpperCase() + verb[0].slice(1).toLowerCase();
  const description = (name ? `${v} ${name}` : subject || v).slice(0, 200);
  return { date: bogotaDay(mail.date, now), description, amountMinor };
}

export interface Movement {
  direction: "out" | "in";
  date: string;
  /** e-mail time in ms, for pairing transfers between the user's own accounts */
  at: number;
  description: string;
  amountMinor: number;
  /** money received from the user's own name (a move between own accounts, not income) */
  self?: boolean;
  /** destination bank of an outgoing transfer, e.g. "Nequi" */
  toBank?: string;
}

const AMT = String.raw`\$?\s?(\d[\d.,]*)`;
const title = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Any money movement in a bank/wallet e-mail. Known Nequi and RappiPay formats first (transfers, received money,
 * loan payments), then generic purchase alerts. Returns null for marketing and anything without an amount.
 */
export function parseMovement(mail: MailInput, now = new Date()): Movement | null {
  const flat = `${mail.subject ?? ""} ${mail.body ?? ""}`.replace(/\s+/g, " ");
  const d = mail.date ? new Date(mail.date) : now;
  const at = isNaN(d.getTime()) ? now.getTime() : d.getTime();
  const date = bogotaDay(mail.date, now);
  const amount = (raw: string) => {
    try {
      return parseCop(raw);
    } catch {
      return 0;
    }
  };
  const mk = (direction: Movement["direction"], raw: string, description: string, extra: Partial<Movement> = {}): Movement | null => {
    const amountMinor = amount(raw);
    return amountMinor ? { direction, date, at, description: description.slice(0, 200), amountMinor, ...extra } : null;
  };

  // Nequi: "Recibiste 42.000 de SANTIAGO PRIETO el 15 de noviembre ..." (greeting "¡Hola, SANTIAGO PRIETO!" = the user)
  let m = new RegExp(`Recibiste ${AMT} de (.+?) el `, "i").exec(flat);
  if (m) {
    const me = /Hola,? ([^!¡]+)!/i.exec(flat)?.[1];
    return mk("in", m[1], `Recibiste de ${title(m[2])}`, { self: Boolean(me && norm(me) === norm(m[2])) });
  }
  // RappiPay: "Monto recibido $34.000 Banco Nequi"
  if ((m = new RegExp(`Monto recibido ${AMT}`, "i").exec(flat))) {
    const bank = /Monto recibido \S+ Banco (\p{L}+)/iu.exec(flat)?.[1];
    return mk("in", m[1], bank ? `Recibiste desde ${title(bank)}` : "Dinero recibido");
  }
  // RappiPay: "Monto transferido $42.000,00 ... Cuenta destino ****6342 Banco Nequi S.A."
  if ((m = new RegExp(`Monto transferido ${AMT}`, "i").exec(flat))) {
    const bank = /Cuenta destino \S+ Banco (\p{L}+)/iu.exec(flat)?.[1];
    return mk("out", m[1], bank ? `Transferencia a ${title(bank)}` : "Transferencia enviada", { toBank: bank ? norm(bank) : undefined });
  }
  // Nequi credit installment: "Pagaste en total $41.547,41"
  if ((m = new RegExp(`Pagaste en total ${AMT}`, "i").exec(flat))) {
    return mk("out", m[1], /Cr[eé]dito Nequi/i.test(flat) ? "Cuota Crédito Nequi" : "Pago de cuota");
  }
  const p = parseBankMail(mail, now);
  return p ? { direction: "out", at, ...p } : null;
}

/**
 * Drops moves between the user's own accounts: money received from their own name, and the outgoing transfer it
 * pairs with (same amount within 15 min, e.g. RappiPay → own Nequi). Counting them would double expenses/income.
 * ponytail: pairing only sees one sync batch; a pair split across two 15-min polls keeps the outgoing side.
 */
export function dropSelfTransfers<T extends Movement>(rows: T[]): T[] {
  const selfIn = rows.filter((r) => r.direction === "in" && r.self);
  const paired = new Set<T>();
  for (const s of selfIn) {
    const out = rows.find((r) => r.direction === "out" && r.toBank && !paired.has(r) && r.amountMinor === s.amountMinor && Math.abs(r.at - s.at) <= 15 * 60_000);
    if (out) paired.add(out);
  }
  return rows.filter((r) => !(r.direction === "in" && r.self) && !paired.has(r));
}
