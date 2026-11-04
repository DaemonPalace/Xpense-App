import type { Category } from "./transactions";

// First match wins, so specific merchants come before generic words. Keywords match at the start of a word
// (accents stripped), so "cine" does not hit "medicine". English kept for the simulator's descriptions.
const KEYWORDS: [Category, string[]][] = [
  ["savings", ["transfer to savings", "savings deposit", "savings transfer", "ahorro"]],
  ["subscriptions", ["netflix", "spotify", "disney", "hbo", "prime video", "youtube premium", "icloud", "suscripcion", "subscription"]],
  ["rideshare", ["uber", "didi", "cabify", "indriver", "indrive", "taxi", "lyft", "beat"]],
  ["parking", ["parking", "parqueadero", "parqueo"]],
  ["transport", ["transmilenio", "tullave", "sitp", "metro", "transit", "fuel", "gasolina", "gas station", "peaje", "terpel"]],
  ["snacks", ["juan valdez", "oma", "tostao", "coffee", "cafe", "snack", "gaseosa", "bakery", "panaderia", "dulceria"]],
  ["food", ["rappi", "ifood", "restaurant", "almuerzo", "lunch", "pizza", "grocer", "market", "mercado", "exito", "carulla", "jumbo", "olimpica", "d1"]],
  ["health", ["pharmacy", "farmacia", "drogueria", "doctor", "dentist", "odontolog", "clinic", "hospital", "gym", "eps"]],
  ["academic", ["libreria", "libro", "book", "fotocopia", "copias", "papeleria", "matricula", "universidad", "coursera", "udemy"]],
  ["outings", ["cinema", "cine", "movie", "concert", "concierto", "discoteca", "steam", "game", "cerveza", "bowling"]],
  ["housing", ["rent", "arriendo", "mortgage", "landlord", "administracion", "electric", "water", "internet", "gas bill", "phone bill", "utility", "servicios publicos", "enel", "codensa", "epm"]],
  ["shopping", ["amazon", "store", "tienda", "mall", "centro comercial", "falabella", "mercadolibre", "target", "walmart", "shop"]],
];

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = KEYWORDS.map(([c, words]) => [c, new RegExp(`\\b(?:${words.map(escape).join("|")})`)] as const);

export function categorize(description: string): Category {
  const d = description.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  for (const [category, re] of MATCHERS) if (re.test(d)) return category;
  return "other";
}
