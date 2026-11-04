import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Chip, Chips, ErrorText, Field, Screen, Body } from '@/components/ui';
import { api } from '@/lib/api';
import { parsePesos } from '@/lib/money';
import { t } from '@/strings';

const KINDS = ['allowance', 'salary', 'scholarship', 'other'] as const;

export default function Onboarding() {
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
      router.replace('/');
    } catch {
      setError(t.common.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label={t.onboarding.incomeLabel} value={income} onChangeText={setIncome} keyboardType="number-pad" placeholder="$ 1.000.000" editable={!incomeSaved} />
      <Body muted>{t.onboarding.incomeKind}</Body>
      <Chips>
        {KINDS.map((k) => (
          <Chip key={k} label={t.onboarding.kinds[k]} selected={kind === k} onPress={() => setKind(k)} />
        ))}
      </Chips>
      <Field label={t.onboarding.goalLabel} value={goal} onChangeText={setGoal} keyboardType="number-pad" placeholder="$ 200.000" />
      <ErrorText>{error}</ErrorText>
      <Button label={t.onboarding.start} onPress={start} busy={busy} disabled={!incomeMinor} />
    </Screen>
  );
}
