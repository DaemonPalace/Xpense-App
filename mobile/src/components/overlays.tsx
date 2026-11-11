import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppData } from '@/data-context';
import { api, ApiError } from '@/lib/api';
import { formatCOP, localDate, parsePesos } from '@/lib/money';
import { t } from '@/strings';
import { Button, Choice, Field, FormError, styleFor, Sheet, Text, type IconName } from './ui';

/** Runs an API call for a sheet: busy flag, generic error, refresh + toast on success. */
function useSubmit() {
  const { refresh, closeSheet, notify } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(run: () => Promise<unknown>, done: string, messageFor: (e: unknown) => string = () => t.common.genericError) {
    setBusy(true);
    setError('');
    try {
      await run();
      closeSheet();
      notify(done);
      refresh();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, submit };
}

/* ---------- Registrar gasto (FR-3.1: ≤ 3 taps with a quick preset) ---------- */

const CATEGORIES = Object.keys(t.categories);
const quick: { label: string; description: string; pesos: number; category: string; icon: IconName }[] = [
  { label: 'Cafetería', description: 'Compra en cafetería', pesos: 9000, category: 'snacks', icon: 'cafe-outline' },
  { label: 'Bus', description: 'Viaje en bus', pesos: 3200, category: 'transport', icon: 'bus-outline' },
  { label: 'Parqueadero', description: 'Pago de parqueadero', pesos: 5000, category: 'parking', icon: 'bicycle-outline' },
];

function ExpenseContent() {
  const { closeSheet } = useAppData();
  const { busy, error, setError, submit } = useSubmit();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('food');
  const amountMinor = parsePesos(amount);
  const save = () => {
    if (!amountMinor) return setError('Escribe un valor mayor a cero.');
    submit(() => api('POST', '/api/transactions', {
      date: localDate(), amountMinor, type: 'expense', category, description: name.trim() || t.categories[category],
    }), 'Gasto registrado. Tu panorama se actualizó.');
  };
  return <Sheet close={closeSheet} title={t.add.title}>
    <Text className="mb-2 font-semi text-sm text-ink">Pago rápido</Text>
    <View className="mb-5 flex-row flex-wrap gap-2">{quick.map(q => <Choice key={q.label} label={q.label} icon={q.icon} selected={name === q.description} onPress={() => { setName(q.description); setAmount(String(q.pesos)); setCategory(q.category); setError(''); }} />)}</View>
    <Field label="¿En qué gastaste?" value={name} onChangeText={setName} placeholder="Ej. Café después de clase" maxLength={200} />
    <Field label={t.add.amount} prefix="$" value={amount} onChangeText={setAmount} placeholder="8000" keyboardType="number-pad" />
    <Text className="mb-2 font-semi text-sm text-ink">{t.add.category}</Text>
    <View className="mb-5 flex-row flex-wrap gap-2">{CATEGORIES.map(c => <Choice key={c} label={t.categories[c]} icon={styleFor(c).icon} selected={category === c} onPress={() => setCategory(c)} />)}</View>
    <FormError message={error} />
    <Button label="Guardar gasto" onPress={save} busy={busy} className="w-full" />
  </Sheet>;
}

/* ---------- Plan: monthly income + monthly savings goal ---------- */

type Income = { id: string; name: string; kind: string; amountMinor: number; dayOfMonth: number };
type Goal = { id: string; name: string; targetMinor: number; monthly: boolean };

function PlanContent() {
  const { summary, closeSheet } = useAppData();
  const { busy, error, setError, submit } = useSubmit();
  const [income, setIncome] = useState(summary ? String(summary.inflowsMinor / 100) : '');
  const [goal, setGoal] = useState(summary ? String(summary.savingsGoalMinor / 100) : '');
  const save = () => {
    const incomeMinor = parsePesos(income);
    const goalMinor = parsePesos(goal);
    if (!incomeMinor || !goalMinor) return setError('Escribe valores mayores a cero.');
    if (goalMinor >= incomeMinor) return setError(t.onboarding.goalTooBig);
    submit(async () => {
      const [incomes, goals] = await Promise.all([api<Income[]>('GET', '/api/incomes'), api<Goal[]>('GET', '/api/goals')]);
      // ponytail: the plan edits the first income and first monthly goal; a multi-income UI can list them all later.
      const inc = incomes[0];
      if (inc) await api('PUT', `/api/incomes/${inc.id}`, { ...inc, amountMinor: incomeMinor });
      else await api('POST', '/api/incomes', { name: t.onboarding.kinds.allowance, kind: 'allowance', amountMinor: incomeMinor });
      const g = goals.find(x => x.monthly);
      if (g) await api('PUT', `/api/goals/${g.id}`, { ...g, targetMinor: goalMinor });
      else await api('POST', '/api/goals', { name: t.onboarding.goalName, targetMinor: goalMinor, monthly: true });
    }, 'Tu plan de ahorro se actualizó.');
  };
  return <Sheet close={closeSheet} title="Ajustar mi plan">
    <Text className="mb-5 text-sm leading-5 text-muted">Cambia tu meta o tu ingreso y tu gemelo recalcula cuánto puedes gastar.</Text>
    <Field label={t.onboarding.incomeLabel} prefix="$" value={income} onChangeText={setIncome} keyboardType="number-pad" helper="Mesada, beca o ingresos. Puede ser un estimado." />
    <Field label={t.onboarding.goalLabel} prefix="$" value={goal} onChangeText={setGoal} keyboardType="number-pad" />
    <FormError message={error} />
    <Button label="Guardar plan" onPress={save} busy={busy} className="w-full" />
  </Sheet>;
}

/* ---------- Aportar = depósito en la caja fuerte (cuenta como ahorro del mes) ---------- */

function SavingContent() {
  const { summary, closeSheet } = useAppData();
  const { busy, error, setError, submit } = useSubmit();
  const [amount, setAmount] = useState('');
  const save = () => {
    const amountMinor = parsePesos(amount);
    if (!amountMinor) return setError('Escribe un aporte mayor a cero.');
    submit(() => api('POST', '/api/vault/deposit', { amountMinor }), 'Aporte registrado: tu meta avanzó.',
      e => e instanceof ApiError && e.code === 'insufficient_vault' ? t.vault.insufficient : t.common.genericError);
  };
  return <Sheet close={closeSheet} title="Aportar a mi meta">
    <Text className="mb-4 text-sm leading-5 text-muted">{t.vault.intro} En la caja fuerte: <Text className="font-strong text-ink">{formatCOP(summary?.vaultBalanceMinor ?? 0)}</Text>.</Text>
    <View className="mb-4 flex-row flex-wrap gap-2">{[10000, 20000, 50000].map(v => <Choice key={v} label={formatCOP(v * 100)} selected={amount === String(v)} onPress={() => setAmount(String(v))} />)}</View>
    <Field label="Otro valor" prefix="$" value={amount} onChangeText={setAmount} placeholder="20000" keyboardType="number-pad" />
    <FormError message={error} />
    <Button label={t.vault.deposit} onPress={save} busy={busy} className="w-full" />
  </Sheet>;
}

/** All global sheets; mounted once in the root layout. */
export function Sheets() {
  const { sheet } = useAppData();
  if (sheet === 'expense') return <ExpenseContent />;
  if (sheet === 'plan') return <PlanContent />;
  if (sheet === 'saving') return <SavingContent />;
  return null;
}

export function Toast() {
  const { toast } = useAppData();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ bottom: insets.bottom + 140 }} className="absolute left-5 right-5 flex-row items-center gap-2 rounded-2xl bg-brand-dark px-4 py-3.5">
    <Ionicons name="checkmark-circle" size={20} color="#A7F3D0" /><Text className="flex-1 font-semi text-sm text-white">{toast}</Text>
  </View>;
}
