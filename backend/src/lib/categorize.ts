import type { Category } from "./transactions";

const KEYWORDS: [Category, string[]][] = [
  ["savings", ["transfer to savings", "savings deposit", "savings transfer"]],
  ["housing", ["rent", "mortgage", "landlord", "hoa"]],
  ["utilities", ["electric", "water", "internet", "gas bill", "phone bill", "utility"]],
  ["food", ["grocery", "groceries", "restaurant", "cafe", "coffee", "pizza", "market", "bakery"]],
  ["transport", ["uber", "lyft", "fuel", "gas station", "parking", "transit", "metro", "taxi"]],
  ["entertainment", ["netflix", "spotify", "cinema", "movie", "concert", "steam", "game"]],
  ["health", ["pharmacy", "doctor", "dentist", "clinic", "hospital", "gym"]],
  ["shopping", ["amazon", "store", "mall", "target", "walmart", "shop"]],
];

export function categorize(description: string): Category {
  const d = description.toLowerCase();
  for (const [category, words] of KEYWORDS) if (words.some((w) => d.includes(w))) return category;
  return "other";
}
