import { describe, expect, it } from "vitest";
import { categorize } from "../../src/lib/categorize";

describe("categorize", () => {
  it.each([
    ["Rent payment", "housing"],
    ["GROCERY MARKET #12", "food"],
    ["Uber trip", "rideshare"],
    ["Electric utility bill", "housing"],
    ["Netflix subscription", "subscriptions"],
    ["City Pharmacy", "health"],
    ["Amazon order", "shopping"],
    ["Transfer to savings", "savings"],
    ["Mystery charge", "other"],
    ["JUAN VALDEZ CAFÉ LA SABANA", "snacks"],
    ["RAPPI*RESTAURANTE", "food"],
    ["DiDi viaje", "rideshare"],
    ["Parqueadero Universidad", "parking"],
    ["Recarga TuLlave", "transport"],
    ["Librería Lerner", "academic"],
    ["Cine Colombia", "outings"],
    ["Medicine shop", "shopping"],
    ["Droguería Colsubsidio", "health"],
    ["Gimnasio Bodytech", "health"],
    ["Tienda OMA snack", "snacks"],
    ["Almuerzo restaurante campus", "food"],
  ])("%s → %s", (d, c) => expect(categorize(d)).toBe(c));
});
