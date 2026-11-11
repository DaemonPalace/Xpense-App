import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Choice, Field, FormError, Page, Text } from '@/components/ui';
import { useAppData } from '@/data-context';
import { api } from '@/lib/api';
import { parsePesos } from '@/lib/money';
import { useSession } from '@/session-context';
import { t } from '@/strings';

const KINDS = ['allowance', 'salary', 'scholarship', 'other'] as const;

export default function Onboarding() {
  const { refresh } = useAppData();
  const { signOut } = useSession();
  const [income, setIncome] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('allowance');
  const [goal, setGoal] = useState('');
  const [incomeSaved, setIncomeSaved] = useState(false); // so a retry after a failed goal doesn't duplicate the income
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const incomeMinor = parsePesos(income);
  const goalMinor = parsePesos(goal);

  async function start() {
    if (!incomeMinor) return;
    if (goalMinor && goalMinor >= incomeMinor) return setError(t.onboarding.goalTooBig);
    setBusy(true);
    setError('');
    try {
      if (!incomeSaved) {
        await api('POST', '/api/incomes', { name: t.onboarding.kinds[kind], kind, amountMinor: incomeMinor });
        setIncomeSaved(true);
      }
      if (goalMinor) await api('POST', '/api/goals', { name: t.onboarding.goalName, targetMinor: goalMinor, monthly: true });
      await refresh();
      router.replace('/hoy');
    } catch {
      setError(t.common.genericError);
    } finally {
      setBusy(false);
    }
  }

  return <Page title="Empecemos por tu meta" back={false}>
    <Text className="mb-5 text-sm leading-5 text-muted">Solo necesitamos dos datos para calcular cuánto puedes gastar cada día.</Text>
    <Field label={t.onboarding.incomeLabel} money value={income} onChangeText={setIncome} placeholder="1.000.000" editable={!incomeSaved} />
    <Text className="mb-2 font-semi text-sm text-ink">{t.onboarding.incomeKind}</Text>
    <View className="mb-5 flex-row flex-wrap gap-2">{KINDS.map(k => <Choice key={k} label={t.onboarding.kinds[k]} selected={kind === k} onPress={() => setKind(k)} />)}</View>
    <Field label={t.onboarding.goalLabel} money value={goal} onChangeText={setGoal} placeholder="200.000" />
    <FormError message={error} />
    <Button label={t.onboarding.start} onPress={start} busy={busy} disabled={!incomeMinor} className="w-full" />
    <Button variant="ghost" label={t.settings.signOut} onPress={signOut} className="mt-2 w-full" />
  </Page>;
}
