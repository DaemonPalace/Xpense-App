import { describe, expect, it } from "vitest";
import { bogotaDay, htmlToText, parseBankMail, parseCop } from "../../src/lib/mail";

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
