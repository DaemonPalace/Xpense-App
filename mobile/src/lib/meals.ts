import type { IconName } from '@/components/ui';

/** Illustrative campus meals (prices in pesos, not minor units) from the Xpense_AI prototype. */
export type Meal = { id: string; icon: IconName; title: string; text: string; moment: string; price: number; compare: number };
export const meals: Meal[] = [
  { id: 'avena', icon: 'sunny-outline', title: 'Avena con fruta y canela', text: 'Energía lenta para llegar a la primera clase.', moment: 'Desayuno', price: 4000, compare: 8000 },
  { id: 'arepa', icon: 'restaurant-outline', title: 'Arepa con huevo y aguacate', text: 'Grasas buenas y proteína para toda la mañana.', moment: 'Desayuno', price: 6000, compare: 11000 },
  { id: 'sandwich', icon: 'fast-food-outline', title: 'Sándwich integral, huevo y fruta', text: 'Sencillo y completo para media jornada.', moment: 'Almuerzo', price: 8000, compare: 14000 },
  { id: 'bowl', icon: 'leaf-outline', title: 'Bowl de arroz, lentejas y vegetales', text: 'Proteína vegetal, fibra y energía para clases.', moment: 'Almuerzo', price: 9000, compare: 16000 },
  { id: 'pollo', icon: 'nutrition-outline', title: 'Ensalada de pollo y quinoa', text: 'Ligera y saciante para días de estudio largo.', moment: 'Almuerzo', price: 12000, compare: 18000 },
];

/** Roughly what one meal can cost (pesos) so the day still fits the daily limit. */
export const mealBudget = (dailyLimitMinor: number) => Math.max(0, Math.round((dailyLimitMinor / 100) * 0.55 / 100) * 100);
