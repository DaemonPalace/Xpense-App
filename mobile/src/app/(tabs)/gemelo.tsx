import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Button, Callout, Card, CardHeading, Field, Progress, Screen, Stepper, Text } from '@/components/ui';
import { useAppData } from '@/data-context';
import { api } from '@/lib/api';
import { formatCOP } from '@/lib/money';

type Insights = {
  forecast: { status: 'ok' | 'insufficient_history' | 'pending'; historyMonths: number; overall: { nextMonthMinor: number; next3MonthsMinor: number } | null };
  processing: boolean;
};

/** F12 digital twin: this month's plan, the forecast-worker projection and a habit simulator. */
export default function Gemelo() {
  const { summary: s, openSheet } = useAppData();
  const [insights, setInsights] = useState<Insights | null>(null);
  const [habitCost, setHabitCost] = useState('6000');
  const [frequency, setFrequency] = useState(3);
  useFocusEffect(useCallback(() => void api<Insights>('GET', '/api/insights').then(setInsights, () => {}), []));
  if (!s) return null;

  const reserved = Math.max(s.savingsGoalMinor, s.savedMinor);
  const gap = Math.max(0, s.savingsGoalMinor - s.savedMinor);
  const monthly = Math.max(0, Number(habitCost.replace(/\D/g, '')) || 0) * 100 * frequency * 4;
  const closes = gap ? Math.min(100, Math.round(monthly / gap * 100)) : 100;
  const fc = insights?.forecast;
  const projected = fc?.status === 'ok' && fc.overall ? fc.overall : null;

  return <Screen title="Tu gemelo" subtitle="Una simulación de tus finanzas para decidir mejor hoy.">
    <View className="mb-5 rounded-[28px] bg-brand-soft p-6">
      <Text className="font-semi text-sm text-brand">Tu plan de este mes</Text>
      <Text accessibilityRole="header" className="mt-2 font-heavy text-[26px] leading-[32px] text-ink">Puedes gastar {formatCOP(s.dailyLimitMinor)} al día</Text>
      <Text className="mt-2 text-[15px] leading-6 text-ink">Reservando {formatCOP(reserved)} para tu meta, te quedan {formatCOP(Math.max(0, s.remainingMinor))} para {s.daysLeft} {s.daysLeft === 1 ? 'día' : 'días'}.</Text>
      <View className="mt-5"><Progress value={s.savingsGoalMinor ? s.savedMinor / s.savingsGoalMinor * 100 : 100} track="#B9E3DC" label="Progreso de tu meta de ahorro" /><Text className="mt-2 text-xs text-muted">Ahorrado {formatCOP(s.savedMinor)} de {formatCOP(s.savingsGoalMinor)} · Caja fuerte {formatCOP(s.vaultBalanceMinor)}</Text></View>
      <View className="mt-5 flex-row gap-3">
        <Button label="Aportar" icon="arrow-up-circle-outline" onPress={() => openSheet('saving')} className="flex-1" />
        <Button label="Ajustar plan" variant="secondary" onPress={() => openSheet('plan')} className="flex-1 bg-white" />
      </View>
    </View>

    <Card className="mb-5">
      <CardHeading title="Si sigues así" subtitle="Proyección con tu historial de gastos." />
      {projected ? <>
        {[['Próximo mes', projected.nextMonthMinor, 1], ['Próximos 3 meses', projected.next3MonthsMinor, 3]].map(([label, spend, months]) => {
          const save = s.inflowsMinor * (months as number) - (spend as number);
          return <View key={label as string} className="flex-row items-center justify-between border-b border-line py-3">
            <Text className="text-sm text-muted">{label}</Text>
            <View className="items-end"><Text className="font-strong text-sm text-ink">Gasto {formatCOP(spend as number)}</Text><Text className={`text-xs ${save >= 0 ? 'text-green' : 'text-danger'}`}>{save >= 0 ? `Ahorro ${formatCOP(save)}` : `Déficit ${formatCOP(-save)}`}</Text></View>
          </View>;
        })}
      </> : <Text className="text-sm leading-5 text-muted">{fc?.status === 'pending' || insights?.processing ? 'Calculando tu proyección…' : 'Necesitamos al menos 2 meses de movimientos. Conecta el banco de prueba o importa un extracto desde tu perfil.'}</Text>}
    </Card>

    <Card>
      <CardHeading title="¿Y si cambias un hábito?" subtitle="Mira cuánto sumaría reducir un gasto frecuente." />
      <Field label="¿Cuánto cuesta cada vez?" prefix="$" value={habitCost} onChangeText={setHabitCost} keyboardType="number-pad" />
      <Text className="mb-2 font-semi text-sm text-ink">¿Cuántas veces por semana?</Text>
      <View className="mb-5"><Stepper value={frequency} onChange={setFrequency} label="veces por semana" /></View>
      <Callout title={`Podrías ahorrar ${formatCOP(monthly)} al mes`}>{gap ? `Eso cubre cerca del ${closes}% de lo que te falta para tu meta. ` : ''}Tú decides qué vale la pena.</Callout>
    </Card>
    <Text className="mt-4 text-xs leading-[18px] text-muted">Las proyecciones son orientativas: promedio ponderado de tus últimos meses.</Text>
  </Screen>;
}
