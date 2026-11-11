import { useState } from 'react';
import { View } from 'react-native';

import { Card, Chip, IconTile, Screen, Segmented, Text } from '@/components/ui';
import { useAppData } from '@/data-context';
import { mealBudget, meals } from '@/lib/meals';
import { formatCOP } from '@/lib/money';

const pesos = (v: number) => formatCOP(v * 100);

export default function Comida() {
  const { summary } = useAppData();
  const [filter, setFilter] = useState<'all' | 'budget'>('budget');
  const daily = summary?.dailyLimitMinor ?? 0;
  const budget = mealBudget(daily);
  const visible = meals.filter(meal => filter === 'all' || meal.price <= budget);
  return <Screen title="Comida" subtitle="Comer bien sin salirte de tu meta de ahorro.">
    <View className="mb-5 rounded-[28px] bg-brand-soft p-6">
      <Text className="font-semi text-sm text-brand">Presupuesto por comida</Text>
      <Text accessibilityRole="header" className="mt-1 font-heavy text-[36px] leading-[44px] text-ink">{pesos(budget)}</Text>
      <Text className="mt-1 text-sm leading-5 text-ink">Calculado con tu límite de {formatCOP(daily)} diarios, repartido entre tus comidas.</Text>
    </View>
    <View className="mb-4"><Segmented value={filter} onChange={setFilter} options={[{ value: 'budget', label: 'Dentro de mi presupuesto' }, { value: 'all', label: 'Todas' }]} /></View>
    {visible.length ? visible.map(meal => <Card key={meal.id} className="mb-3">
      <View className="flex-row gap-4">
        <IconTile icon={meal.icon} background="#DDF3EF" color="#0F766E" size={52} />
        <View className="flex-1">
          <Text className="text-xs text-muted">{meal.moment}</Text>
          <Text className="font-strong text-base leading-[22px] text-ink">{meal.title}</Text>
          <Text className="mt-1 text-sm leading-5 text-muted">{meal.text}</Text>
          <View className="mt-3 flex-row flex-wrap items-center gap-2">
            <Text className="font-heavy text-lg text-ink">{pesos(meal.price)}</Text>
            <Chip tone="green" label={`Ahorras ${pesos(meal.compare - meal.price)}`} />
          </View>
          <Text className="mt-1 text-xs text-muted">frente a un combo de {pesos(meal.compare)}</Text>
        </View>
      </View>
    </Card>) : <Card><Text className="text-sm leading-5 text-muted">Ninguna receta cabe hoy en {pesos(budget)}. Cambia a “Todas” para verlas o ajusta tu plan en la pestaña Gemelo.</Text></Card>}
    <Text className="mt-2 text-xs leading-[18px] text-muted">Precios ilustrativos. Confirma precios, disponibilidad e ingredientes en tu cafetería.</Text>
  </Screen>;
}
