import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { BarChart, Callout, Card, CardHeading, colors, DashedLine, Progress, Screen, SmallLink, Text, TransactionList } from '@/components/ui';
import { useAppData } from '@/data-context';
import { formatCOP, localDate } from '@/lib/money';
import { t } from '@/strings';

export default function Hoy() {
  const { summary: s, recent, hasAccounts, openSheet } = useAppData();
  const [bankPromptHidden, hideBankPrompt] = useState(false);
  const [day, setDay] = useState(6); // selected bar; 6 = today
  if (!s) return null;

  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
  const expenses = recent.filter(x => x.type === 'expense');
  const values = days.map(d => { const key = localDate(d); return expenses.filter(x => x.date === key).reduce((a, x) => a + x.amountMinor, 0); });
  const labels = days.map(d => d.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '').slice(0, 3));
  const dayName = (i: number) => (i === 6 ? 'Hoy' : i === 5 ? 'Ayer' : days[i].toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' }));
  const today = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const pct = s.savingsGoalMinor ? Math.min(100, Math.round(s.savedMinor / s.savingsGoalMinor * 100)) : 100;
  const overToday = s.safeToSpendTodayMinor < 0;
  const banner = s.status === 'over' ? t.home.over(formatCOP(-s.remainingMinor)) : overToday ? t.home.overToday : s.status === 'warning' ? t.home.warning : null;

  return <Screen title="Hoy" subtitle={today[0].toUpperCase() + today.slice(1)} fab>
    {/* Siblings, not nested: a Pressable inside the link would be hidden from screen readers. */}
    {!hasAccounts && !bankPromptHidden ? <View className="mb-4">
      <Pressable accessibilityRole="link" accessibilityHint="Abre la pantalla para conectar tu banco" onPress={() => router.push('/cuentas')} className="active:opacity-80">
        <Card className="flex-row items-center gap-3 pr-12">
          <Ionicons name="card-outline" size={20} color={colors.ink} />
          <View className="flex-1"><Text className="font-semi text-[15px] text-ink">Registra gastos solo</Text><Text className="text-sm leading-5 text-muted">Conecta tu banco o importa un extracto y se anotan automáticamente</Text></View>
        </Card>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cerrar aviso" onPress={() => hideBankPrompt(true)} className="absolute right-0 top-0 h-12 w-12 items-center justify-center rounded-full active:opacity-60">
        <Ionicons name="close" size={20} color={colors.muted} />
      </Pressable>
    </View> : null}

    {banner ? <View className="mb-4"><Callout tone={s.status === 'warning' && !overToday ? 'amber' : 'danger'} icon="warning-outline" title={banner} /></View> : null}

    <View className="mb-4 rounded-[20px] bg-brand p-6">
      <Text className="font-label text-sm text-brand-soft">{t.home.safeToSpend}</Text>
      <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={{ letterSpacing: -0.9 }} className={`mt-1 font-heavy text-[44px] leading-[48px] ${overToday ? 'text-[#FECACA]' : 'text-white'}`}>{formatCOP(s.safeToSpendTodayMinor)}</Text>
      <Text className="mt-2 text-sm leading-5 text-brand-soft">{t.home.dailyLimit(formatCOP(s.dailyLimitMinor))} · {t.home.remaining(formatCOP(Math.max(0, s.remainingMinor)), s.daysLeft)}</Text>
      {s.savingsGoalMinor > 0 ? <View className="mt-6">
        <View className="mb-2 flex-row flex-wrap items-center justify-between gap-x-3"><Text className="font-label text-sm text-white">Meta de ahorro · {pct}%</Text><Text className="font-label text-sm text-white">{formatCOP(s.savedMinor)} / {formatCOP(s.savingsGoalMinor)}</Text></View>
        <Progress value={pct} color="#FFFFFF" track="#2F9188" label="Progreso de tu meta de ahorro" />
      </View> : null}
      <Pressable accessibilityRole="button" onPress={() => openSheet('saving')} className="mt-4 min-h-12 flex-row items-center gap-2 self-start active:opacity-80"><Ionicons name="arrow-up-circle-outline" size={20} color="#fff" /><Text className="font-semi text-sm text-white">Aportar a mi meta</Text></Pressable>
    </View>

    <Card className="mb-4">
      <CardHeading title="Esta semana" subtitle={`Gastaste ${formatCOP(values.reduce((a, v) => a + v, 0))}`} action={<SmallLink label="Ver todo" onPress={() => router.push('/movimientos')} />} />
      <View className="mb-4 flex-row items-center justify-between gap-3">
        <Text accessibilityLiveRegion="polite" className="text-sm text-ink"><Text className="font-semi text-sm capitalize text-ink">{dayName(day)}</Text>: {formatCOP(values[day])}</Text>
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="flex-row items-center gap-2"><DashedLine style={{ width: 16 }} /><Text className="text-xs text-muted">Límite diario</Text></View>
      </View>
      <BarChart values={values} labels={labels} highlight={day} onSelect={setDay} describe={dayName} limit={s.dailyLimitMinor} />
      {s.ant.count ? <View className="mt-4"><Callout title={t.dashboard.ant}>{t.dashboard.antSummary(s.ant.count, formatCOP(s.ant.totalMinor))}</Callout></View> : null}
    </Card>

    <Card>
      <CardHeading title="Últimos movimientos" action={<SmallLink label="Ver todo" onPress={() => router.push('/movimientos')} />} />
      <TransactionList items={recent.slice(0, 3)} ant={new Set(s.ant.txnIds)} />
    </Card>
  </Screen>;
}
