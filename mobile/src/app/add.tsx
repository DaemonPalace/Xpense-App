import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Chip, Chips, ErrorText, Field, Screen, Body } from '@/components/ui';
import { api } from '@/lib/api';
import { localDate, parsePesos } from '@/lib/money';
import { t } from '@/strings';

const CATEGORIES = Object.keys(t.categories);

// ≤ 3 taps (FR-3.1): "+ Registrar gasto" → category → Guardar. Amount is typed, note is optional.
export default function AddExpense() {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amountMinor = parsePesos(amount);

  async function save() {
    if (!amountMinor || !category) return;
    setBusy(true);
    setError('');
    try {
      await api('POST', '/api/transactions', {
        date: localDate(),
        amountMinor,
        type: 'expense',
        category,
        description: note.trim() || t.categories[category],
      });
      router.back();
    } catch {
      setError(t.common.genericError);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label={t.add.amount} value={amount} onChangeText={setAmount} keyboardType="number-pad" autoFocus placeholder="$ 0" style={{ fontSize: 28 }} />
      <Body muted>{t.add.category}</Body>
      <Chips>
        {CATEGORIES.map((c) => (
          <Chip key={c} label={t.categories[c]} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </Chips>
      <Field label={t.add.note} value={note} onChangeText={setNote} maxLength={200} />
      <ErrorText>{error}</ErrorText>
      <Button label={t.common.save} onPress={save} busy={busy} disabled={!amountMinor || !category} />
    </Screen>
  );
}
