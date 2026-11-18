import { describe, expect, it } from "vitest";
import { bogotaDay, dropSelfTransfers, htmlToText, parseBankMail, parseCop, parseMovement } from "../../src/lib/mail";

const date = "Sat, 15 Nov 2026 22:30:00 -0500";

describe("parseCop", () => {
  it("handles Colombian and US separators", () => {
    expect(parseCop("25.000,00")).toBe(2_500_000);
    expect(parseCop("25,000.50")).toBe(2_500_050);
    expect(parseCop("1.250.000")).toBe(125_000_000);
  });
});

describe("parseBankMail", () => {
  it("parses a Bancolombia purchase alert", () => {
    expect(parseBankMail({ subject: "Alertas", body: "Bancolombia le informa Compra por $25.000,00 en RAPPI COLOMBIA 12:30. 15/11/2026 T.Cred *1234", date }))
      .toEqual({ date: "2026-11-15", description: "Compra RAPPI COLOMBIA", amountMinor: 2_500_000 });
  });
  it("parses a Nequi payment", () => {
    expect(parseBankMail({ subject: "Pagaste", body: "Pagaste $12.500 en TIENDA D1 desde tu Nequi.", date })?.description).toBe("Pagaste TIENDA D1");
  });
  it("ignores credits and mails without an amount", () => {
    expect(parseBankMail({ subject: "Recibiste plata", body: "Recibiste $50.000 de JUAN PEREZ.", date })).toBeNull();
    expect(parseBankMail({ subject: "Tu extracto", body: "Ya está disponible tu extracto.", date })).toBeNull();
  });
  it("reads HTML bodies", () => {
    const body = htmlToText("<p>Davivienda le informa compra por&nbsp;<b>$8.000</b> en CINE COLOMBIA</p><p>Si no fuiste tú, llama al pago...</p>");
    expect(parseBankMail({ subject: "Compra", body, date })?.amountMinor).toBe(800_000);
  });
  it("uses the Bogotá calendar day", () => {
    expect(bogotaDay("Sun, 16 Nov 2026 03:00:00 +0000")).toBe("2026-11-15");
  });
});

describe("parseMovement (Nequi / RappiPay)", () => {
  const nequiIn = (from: string, amt: string, d = "Sun, 15 Nov 2026 16:22:31 +0000") => ({
    subject: "¡Recibiste plata por Bre-B!",
    body: `NEQUI ¡Hola, SANTIAGO PRIETO TRUJILLO! Recibiste ${amt} de ${from} el 15 de noviembre de 2026 a las 11:22 a.m, desde el banco Rappipay.`,
    date: d,
  });
  const rappiOut = (amt: string, d = "Sun, 15 Nov 2026 16:22:31 +0000") => ({
    subject: "¡Listo! Tu dinero está en camino",
    body: `¡Hola, Santiago! Aquí los detalles:\nMonto transferido\n$${amt}\nRappiCuenta de origen ****9463 Cuenta destino ****6342 Banco Nequi S.A. CF Costo de la transacción Gratis`,
    date: d,
  });

  it("reads received money, transfers and loan payments", () => {
    expect(parseMovement(nequiIn("OLGA LUCIA TRUJILLO", "30.000"))).toMatchObject({ direction: "in", amountMinor: 3_000_000, description: "Recibiste de Olga Lucia Trujillo", self: false });
    expect(parseMovement(nequiIn("SANTIAGO PRIETO TRUJILLO", "42.000"))).toMatchObject({ direction: "in", self: true });
    expect(parseMovement(rappiOut("42.000,00"))).toMatchObject({ direction: "out", amountMinor: 4_200_000, description: "Transferencia a Nequi", toBank: "NEQUI" });
    expect(parseMovement({ subject: "Tu dinero ya está disponible.", body: "Monto recibido $34.000 Banco Nequi Nro. de transacción 1", date })).toMatchObject({ direction: "in", amountMinor: 3_400_000, description: "Recibiste desde Nequi" });
    expect(parseMovement({ subject: "Pago exitoso", body: "cuota de tu Crédito Nequi. Pagaste en total $41.547,41 Lo que pagaste de capital fue $25.465,99", date }))
      .toMatchObject({ direction: "out", amountMinor: 4_154_741, description: "Cuota Crédito Nequi" });
    expect(parseMovement({ subject: "🗽 ¿New York en la lista?", body: "Vuela a 0% de interés", date })).toBeNull();
  });

  it("drops transfers between own accounts but keeps the rest", () => {
    const rows = [rappiOut("42.000,00"), nequiIn("SANTIAGO PRIETO TRUJILLO", "42.000"), rappiOut("14.000,00"), nequiIn("PABLO BOADA", "30.000")].map((m) => parseMovement(m)!);
    expect(dropSelfTransfers(rows).map((r) => r.description)).toEqual(["Transferencia a Nequi", "Recibiste de Pablo Boada"]);
    expect(dropSelfTransfers(rows)[0].amountMinor).toBe(1_400_000);
  });
});
