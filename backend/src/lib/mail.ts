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
