import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BarChart, Callout, Card, CardHeading, colors, Progress, Screen, SmallLink, Text, TransactionList } from '@/components/ui';
import { useAppData } from '@/data-context';
import { formatCOP, localDate } from '@/lib/money';
import { loadSession } from '@/lib/session';
import { t } from '@/strings';

export default function Hoy() {
  const { summary: s, recent, hasAccounts, openSheet } = useAppData();
  const [bankPromptHidden, hideBankPrompt] = useState(false);
  const [day, setDay] = useState(6); // selected bar; 6 = today
  const [name, setName] = useState('');
  useEffect(() => void loadSession().then(x => setName(x?.name ?? '')), []);
  if (!s) return null;

  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
  const expenses = recent.filter(x => x.type === 'expense');
  const values = days.map(d => { const key = localDate(d); return expenses.filter(x => x.date === key).reduce((a, x) => a + x.amountMinor, 0); });
  const labels = days.map(d => d.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '').slice(0, 3));
  const dayName = (i: number) => (i === 6 ? 'Hoy' : i === 5 ? 'Ayer' : days[i].toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' }));
  const pct = s.savingsGoalMinor ? Math.min(100, Math.round(s.savedMinor / s.savingsGoalMinor * 100)) : 100;
  const overToday = s.safeToSpendTodayMinor < 0;
  const banner = s.status === 'over' ? t.home.over(formatCOP(-s.remainingMinor)) : overToday ? t.home.overToday : s.status === 'warning' ? t.home.warning : null;

  return <Screen title="Hoy" subtitle={`Hola${name ? `, ${name}` : ''}. Así va tu mes.`} fab>
    {!hasAccounts && !bankPromptHidden ? <Pressable accessibilityRole="link" accessibilityHint="Abre la pantalla para conectar tu banco" onPress={() => router.push('/cuentas')} className="mb-5 active:opacity-80">
      <Card className="flex-row items-center gap-3 pr-12">
        <Ionicons name="card-outline" size={28} color={colors.brand} />
        <View className="flex-1"><Text className="font-strong text-[15px] text-ink">Registra gastos solo</Text><Text className="text-sm leading-5 text-muted">Conecta tu banco o importa un extracto y se anotan automáticamente.</Text></View>
      </Card>
      <Pressable accessibilityRole="button" accessibilityLabel="Cerrar aviso" hitSlop={4} onPress={() => hideBankPrompt(true)} className="absolute right-1 top-1 h-11 w-11 items-center justify-center rounded-full active:opacity-60">
        <Ionicons name="close" size={20} color={colors.muted} />
      </Pressable>
    </Pressable> : null}

    {banner ? <View className="mb-5"><Callout tone={s.status === 'warning' && !overToday ? 'amber' : 'danger'} icon="warning-outline" title={banner} /></View> : null}

    <View className="mb-5 rounded-[28px] bg-brand p-6">
      <Text className="font-semi text-sm text-brand-soft">{t.home.safeToSpend}</Text>
      <Text accessibilityRole="header" className={`mt-1 font-heavy text-[44px] leading-[52px] ${overToday ? 'text-[#FECACA]' : 'text-white'}`}>{formatCOP(s.safeToSpendTodayMinor)}</Text>
      <Text className="mt-1 text-sm leading-5 text-brand-soft">{t.home.dailyLimit(formatCOP(s.dailyLimitMinor))} · {t.home.remaining(formatCOP(Math.max(0, s.remainingMinor)), s.daysLeft)}</Text>
      {s.savingsGoalMinor > 0 ? <View className="mt-5">
        <View className="mb-2 flex-row items-center justify-between"><Text className="font-semi text-sm text-white">Meta de ahorro · {pct}%</Text><Text className="font-semi text-sm text-white">{formatCOP(s.savedMinor)} / {formatCOP(s.savingsGoalMinor)}</Text></View>
        <Progress value={pct} color="#FFFFFF" track="#2F9188" label="Progreso de tu meta de ahorro" />
      </View> : null}
      <Pressable accessibilityRole="button" onPress={() => openSheet('saving')} className="mt-4 min-h-11 flex-row items-center gap-1 self-start active:opacity-80"><Ionicons name="arrow-up-circle-outline" size={20} color="#fff" /><Text className="font-strong text-sm text-white">Aportar a mi meta</Text></Pressable>
    </View>

    <Card className="mb-5">
      <CardHeading title="Esta semana" subtitle={`Gastaste ${formatCOP(values.reduce((a, v) => a + v, 0))}`} action={<SmallLink label="Ver todo" onPress={() => router.push('/movimientos')} />} />
      <Text accessibilityLiveRegion="polite" className="mb-3 text-sm text-ink"><Text className="font-semi text-sm capitalize text-ink">{dayName(day)}</Text>: {formatCOP(values[day])}</Text>
      <BarChart values={values} labels={labels} highlight={day} onSelect={setDay} describe={dayName} />
      {s.ant.count ? <View className="mt-5"><Callout title={t.dashboard.ant}>{t.dashboard.antSummary(s.ant.count, formatCOP(s.ant.totalMinor))}</Callout></View> : null}
    </Card>

    <Card className="mb-5">
      <CardHeading title="Últimos movimientos" action={<SmallLink label="Ver todo" onPress={() => router.push('/movimientos')} />} />
      <TransactionList items={recent.slice(0, 3)} ant={new Set(s.ant.txnIds)} />
    </Card>

  </Screen>;
}
