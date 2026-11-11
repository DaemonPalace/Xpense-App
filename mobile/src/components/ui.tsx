// Design system ported from the Xpense_AI prototype (NativeWind + Plus Jakarta Sans).
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text as RNText, TextInput, View,
  type TextInputProps, type TextProps,
} from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppData } from '@/data-context';
import { announce } from '@/lib/announce';
import { CognitoError } from '@/lib/cognito';
import type { Transaction } from '@/lib/api';
import { formatCOP, groupPesos } from '@/lib/money';
import { t } from '@/strings';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const colors = {
  brand: '#0F766E', brandSoft: '#DDF3EF', brandDark: '#0B4F4A', ink: '#0F2E2B', muted: '#4A6361',
  line: '#D9E6E3', amber: '#B45309', amberSoft: '#FEF3C7', chart: '#3E968A', danger: '#B91C1C', hint: '#5F7A77',
};

type CatStyle = { icon: IconName; background: string; color: string };
const cat = (icon: IconName, background: string, color: string): CatStyle => ({ icon, background, color });
/** One look per backend category (backend/src/lib/transactions.ts CATEGORIES). */
export const categoryStyle: Record<string, CatStyle> = {
  food: cat('restaurant-outline', '#FEF3C7', '#B45309'),
  snacks: cat('cafe-outline', '#FFEDD5', '#C2410C'),
  transport: cat('bus-outline', '#E0F2FE', '#0369A1'),
  rideshare: cat('car-outline', '#E0E7FF', '#4338CA'),
  parking: cat('car-sport-outline', '#D1FAE5', '#047857'),
  outings: cat('beer-outline', '#FCE7F3', '#BE185D'),
  academic: cat('book-outline', '#EDE9FE', '#6D28D9'),
  shopping: cat('bag-outline', '#FEE2E2', '#B91C1C'),
  health: cat('medkit-outline', '#DCFCE7', '#15803D'),
  housing: cat('home-outline', '#F1F5F9', '#334155'),
  subscriptions: cat('repeat-outline', '#F3E8FF', '#7E22CE'),
  savings: cat('lock-closed-outline', '#DDF3EF', '#0F766E'),
  other: cat('receipt-outline', '#EEF2F1', '#4A6361'),
};
export const styleFor = (category: string) => categoryStyle[category] ?? categoryStyle.other;

export function errorMessage(e: unknown): string {
  if (e instanceof CognitoError) return t.cognitoErrors[e.code] ?? t.common.genericError;
  return t.common.genericError;
}

/** Text with Plus Jakarta Sans regular by default; any `font-*` class in className replaces it. */
export function Text({ className = '', ...props }: TextProps & { className?: string }) {
  return <RNText {...props} className={/\bfont-/.test(className) ? className : `font-body ${className}`} />;
}

/* ---------- Layout ---------- */

export function Screen({ title, subtitle, fab, children }: { title: string; subtitle?: string; fab?: boolean; children: React.ReactNode }) {
  const { openSheet } = useAppData();
  return <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
    {/* Android is edge-to-edge (the window no longer resizes), so behavior must be set on both platforms. */}
    <KeyboardAvoidingView behavior="padding" className="flex-1">
    <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: fab ? 104 : 32 }} keyboardShouldPersistTaps="handled">
      <View className="mb-6 flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text accessibilityRole="header" className="font-heavy text-[30px] leading-[36px] text-ink">{title}</Text>
          {subtitle ? <Text className="mt-1 text-sm leading-5 text-muted">{subtitle}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Mi perfil" onPress={() => router.push('/perfil')} className="h-12 w-12 items-center justify-center rounded-full bg-brand-soft active:opacity-80">
          <Ionicons name="person" size={22} color={colors.brand} />
        </Pressable>
      </View>
      {children}
    </ScrollView>
    </KeyboardAvoidingView>
    {fab ? <View pointerEvents="box-none" className="absolute bottom-4 right-5 flex-row items-center gap-3">
      <Pressable accessibilityRole="button" accessibilityLabel={t.home.addIncome} onPress={() => openSheet('income')} className="min-h-12 flex-row items-center gap-1.5 rounded-full border border-line bg-white px-4 shadow-sm active:opacity-85">
        <Ionicons name="add" size={20} color={colors.brand} /><Text className="font-semi text-sm text-brand">Ingreso</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t.home.add} onPress={() => openSheet('expense')} className="min-h-14 flex-row items-center gap-2 rounded-full bg-brand px-5 shadow-lg active:opacity-85">
        <Ionicons name="add" size={24} color="#fff" /><Text className="font-strong text-base text-white">Gasto</Text>
      </Pressable>
    </View> : null}
  </SafeAreaView>;
}

/** Plain scrolling page with a back button (stack screens outside the tabs). */
export function Page({ title, back = true, children }: { title?: string; back?: boolean; children: React.ReactNode }) {
  return <SafeAreaView className="flex-1 bg-canvas">
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {title ? <View className="mb-6 flex-row items-center gap-3">
          {back && router.canGoBack() ? <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} className="h-12 w-12 items-center justify-center rounded-full bg-white active:opacity-70"><Ionicons name="arrow-back" size={22} color={colors.ink} /></Pressable> : null}
          <Text accessibilityRole="header" className="flex-1 font-heavy text-[26px] leading-[32px] text-ink">{title}</Text>
        </View> : null}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <View className={`rounded-3xl border border-line bg-panel p-5 ${className}`}>{children}</View>;
}

export function CardHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <View className="mb-4 flex-row items-start justify-between gap-3">
    <View className="flex-1"><Text accessibilityRole="header" className="font-strong text-lg text-ink">{title}</Text>{subtitle ? <Text className="mt-1 text-sm leading-5 text-muted">{subtitle}</Text> : null}</View>
    {action}
  </View>;
}

/** Text action. `button` for actions that do something here (default role is link: navigation); `danger` for destructive ones. */
export function SmallLink({ label, onPress, button, danger }: { label: string; onPress: () => void; button?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole={button ? 'button' : 'link'} onPress={onPress} hitSlop={8} className="min-h-11 justify-center active:opacity-70"><Text className={`font-strong text-sm ${danger ? 'text-danger' : 'text-brand'}`}>{label}</Text></Pressable>;
}

/* ---------- Controls ---------- */

export function Button({ label, onPress, variant = 'primary', icon, className = '', disabled = false, busy = false }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName; className?: string; disabled?: boolean; busy?: boolean }) {
  const box = { primary: 'bg-brand', secondary: 'bg-brand-soft', ghost: 'bg-transparent', danger: 'bg-[#FEE2E2]' }[variant];
  const text = { primary: 'text-white', secondary: 'text-brand', ghost: 'text-brand', danger: 'text-danger' }[variant];
  const tint = { primary: '#fff', secondary: colors.brand, ghost: colors.brand, danger: colors.danger }[variant];
  const off = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress} className={`min-h-12 flex-row items-center justify-center gap-2 rounded-2xl px-5 active:opacity-80 ${box} ${off ? 'opacity-50' : ''} ${className}`}>
    {busy ? <ActivityIndicator color={tint} /> : icon ? <Ionicons name={icon} size={20} color={tint} /> : null}
    <Text className={`font-strong text-[15px] ${text}`}>{label}</Text>
  </Pressable>;
}

export function Chip({ label, tone = 'brand' }: { label: string; tone?: 'brand' | 'green' | 'amber' }) {
  const box = tone === 'green' ? 'bg-mint' : tone === 'amber' ? 'bg-amber-soft' : 'bg-brand-soft';
  const text = tone === 'green' ? 'text-green' : tone === 'amber' ? 'text-amber' : 'text-brand';
  return <View className={`self-start rounded-full px-3 py-1.5 ${box}`}><Text className={`font-strong text-xs ${text}`}>{label}</Text></View>;
}

/** Tappable choice pill (category, preset amounts). */
export function Choice({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: IconName }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} className={`min-h-12 flex-row items-center gap-2 rounded-full px-4 active:opacity-80 ${selected ? 'bg-brand' : 'bg-brand-soft'}`}>
    {icon ? <Ionicons name={icon} size={18} color={selected ? '#fff' : colors.brand} /> : null}
    <Text className={`font-semi text-sm ${selected ? 'text-white' : 'text-brand'}`}>{label}</Text>
  </Pressable>;
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return <View accessibilityRole="tablist" className="flex-row rounded-2xl bg-[#E4EEEC] p-1">
    {options.map(option => <Pressable key={option.value} accessibilityRole="tab" accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)} className={`min-h-12 flex-1 items-center justify-center rounded-xl px-2 py-1 ${value === option.value ? 'bg-white' : ''}`}>
      <Text className={`text-center text-sm ${value === option.value ? 'font-strong text-brand' : 'font-semi text-muted'}`}>{option.label}</Text>
    </Pressable>)}
  </View>;
}

export function Stepper({ value, min = 1, max = 7, onChange: change, label }: { value: number; min?: number; max?: number; onChange: (value: number) => void; label: string }) {
  const onChange = (v: number) => { change(v); announce(`${v} ${v === 1 ? 'vez' : 'veces'} por semana`); };
  return <View className="flex-row items-center justify-between rounded-2xl bg-canvas p-2">
    <Pressable accessibilityRole="button" accessibilityLabel={`Menos ${label}`} disabled={value <= min} onPress={() => onChange(value - 1)} className={`h-12 w-12 items-center justify-center rounded-xl bg-white active:opacity-70 ${value <= min ? 'opacity-40' : ''}`}><Ionicons name="remove" size={24} color={colors.brand} /></Pressable>
    <Text accessibilityLiveRegion="polite" className="font-strong text-base text-ink">{value} {value === 1 ? 'vez' : 'veces'} por semana</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Más ${label}`} disabled={value >= max} onPress={() => onChange(value + 1)} className={`h-12 w-12 items-center justify-center rounded-xl bg-white active:opacity-70 ${value >= max ? 'opacity-40' : ''}`}><Ionicons name="add" size={24} color={colors.brand} /></Pressable>
  </View>;
}

/**
 * Text input. With `secureTextEntry` it gets a show/hide toggle; `children` render under the input.
 * `money`: peso amount. The value stays plain digits and is shown with thousands dots ("1.500.000").
 */
export function Field({ label, money, helper, right, secureTextEntry, children, value, onChangeText, ...input }: TextInputProps & { label: string; value: string; onChangeText: (value: string) => void; money?: boolean; helper?: string; right?: React.ReactNode; children?: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  return <View className="mb-4">
    <Text className="mb-2 font-semi text-sm text-ink">{label}</Text>
    <View className="min-h-12 flex-row items-center rounded-2xl border border-field bg-white pl-4">
      {money ? <Text className="mr-1 font-semi text-base text-muted">$</Text> : null}
      <TextInput accessibilityLabel={label} className="min-h-12 flex-1 pr-4 font-body text-base text-ink" placeholderTextColor={colors.hint} autoCapitalize="none" secureTextEntry={secureTextEntry && !shown}
        keyboardType={money ? 'number-pad' : undefined} value={money ? groupPesos(value) : value} onChangeText={money ? v => onChangeText(v.replace(/\D/g, '')) : onChangeText} {...input} />
      {secureTextEntry ? <Pressable accessibilityRole="button" accessibilityLabel={shown ? t.auth.hidePassword : t.auth.showPassword} onPress={() => setShown(!shown)} className="h-12 w-12 items-center justify-center active:opacity-70">
        <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.muted} />
      </Pressable> : right}
    </View>
    {helper ? <Text className="mt-1.5 text-xs leading-[18px] text-muted">{helper}</Text> : null}
    {children}
  </View>;
}

/** Live checklist of password rules: green check when met, grey circle when not. */
export function Checklist({ items }: { items: { label: string; ok: boolean }[] }) {
  return <View className="mt-2 gap-1">{items.map(i => <View key={i.label} accessible accessibilityLabel={`${i.label}: ${i.ok ? 'cumple' : 'falta'}`} className="flex-row items-center gap-2">
    <Ionicons name={i.ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={i.ok ? '#047857' : colors.muted} />
    <Text className={`text-xs ${i.ok ? 'text-green' : 'text-muted'}`}>{i.label}</Text>
  </View>)}</View>;
}

/** Dropdown: a field-looking button that opens a sheet with the options. */
export function Select({ label, value, options, onChange, placeholder }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  return <View className="mb-4">
    <Text className="mb-2 font-semi text-sm text-ink">{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || placeholder}`} onPress={() => setOpen(true)} className="min-h-12 flex-row items-center rounded-2xl border border-field bg-white px-4 active:opacity-80">
      <Text className={`flex-1 text-base ${value ? 'text-ink' : 'text-hint'}`}>{value || placeholder}</Text>
      <Ionicons name="chevron-down" size={20} color={colors.muted} />
    </Pressable>
    <Sheet visible={open} close={() => setOpen(false)} title={label}>
      {options.map(o => <Pressable key={o} accessibilityRole="button" accessibilityState={{ selected: o === value }} onPress={() => { onChange(o); setOpen(false); }} className="min-h-12 flex-row items-center justify-between border-b border-line py-3 active:opacity-70">
        <Text className={`text-base ${o === value ? 'font-strong text-brand' : 'text-ink'}`}>{o}</Text>
        {o === value ? <Ionicons name="checkmark" size={22} color={colors.brand} /> : null}
      </Pressable>)}
    </Sheet>
  </View>;
}

export function FormError({ message }: { message: string }) {
  useEffect(() => announce(message), [message]);
  if (!message) return null;
  return <View accessibilityRole="alert" className="mb-4 flex-row items-start gap-2 rounded-2xl bg-amber-soft p-3"><Ionicons name="alert-circle" size={20} color={colors.amber} /><Text className="flex-1 text-sm leading-5 text-amber">{message}</Text></View>;
}

/* ---------- Feedback & data ---------- */

export function Progress({ value, color = colors.brand, track = '#E4EEEC', label }: { value: number; color?: string; track?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }} style={{ backgroundColor: track }} className="h-2.5 overflow-hidden rounded-full"><View style={{ width: `${pct}%`, backgroundColor: color }} className="h-full rounded-full" /></View>;
}

export function Callout({ icon = 'bulb-outline', tone = 'amber', title, children }: { icon?: IconName; tone?: 'amber' | 'brand' | 'danger'; title: string; children?: React.ReactNode }) {
  const box = { amber: 'bg-amber-soft', brand: 'bg-brand-soft', danger: 'bg-[#FEE2E2]' }[tone];
  const color = { amber: colors.amber, brand: colors.brand, danger: colors.danger }[tone];
  return <View accessibilityRole={tone === 'danger' ? 'alert' : undefined} className={`flex-row gap-3 rounded-2xl p-4 ${box}`}>
    <Ionicons name={icon} size={22} color={color} />
    <View className="flex-1"><Text className="font-strong text-sm text-ink">{title}</Text>{children ? <Text className="mt-1 text-sm leading-5 text-ink">{children}</Text> : null}</View>
  </View>;
}

export function IconTile({ icon, background, color, size = 44 }: { icon: IconName; background: string; color: string; size?: number }) {
  return <View style={{ backgroundColor: background, width: size, height: size }} className="items-center justify-center rounded-2xl"><Ionicons name={icon} size={size * 0.5} color={color} /></View>;
}

const ORIGIN: Record<Transaction['origin'], string> = { manual: '', sync: ' · Banco', csv: ' · CSV', vault: ' · Caja fuerte' };

/** With `onDelete` every row gets a trash button. */
export function TransactionList({ items, empty = t.movements.empty, ant, onDelete }: { items: Transaction[]; empty?: string; ant?: Set<string>; onDelete?: (item: Transaction) => void }) {
  if (!items.length) return <Text className="py-4 text-sm text-muted">{empty}</Text>;
  return <View>{items.map((item, index) => {
    const style = styleFor(item.category);
    const label = t.categories[item.category] ?? (item.category === 'savings' ? t.vault.title : item.category);
    const [y, m, d] = item.date.split('-').map(Number);
    const date = new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    const saving = item.type === 'savings';
    return <View key={item.txnId} className={`flex-row items-center py-3 ${index < items.length - 1 ? 'border-b border-line' : ''}`}>
      <View accessible accessibilityLabel={`${item.description}, ${label}, ${date}, ${formatCOP(item.amountMinor)}`} className="flex-1 flex-row items-center gap-3">
        <IconTile icon={style.icon} background={style.background} color={style.color} />
        <View className="flex-1"><Text numberOfLines={1} className="font-semi text-[15px] text-ink">{item.description}</Text><Text className="mt-0.5 text-xs text-muted">{label} · {date}{ORIGIN[item.origin]}{ant?.has(item.txnId) ? ` · ${t.movements.ant}` : ''}</Text></View>
        <Text className={`font-strong text-[15px] ${saving ? 'text-brand' : 'text-ink'}`}>{saving ? '' : '− '}{formatCOP(item.amountMinor)}</Text>
      </View>
      {onDelete ? <Pressable accessibilityRole="button" accessibilityLabel={`${t.movements.delete}: ${item.description}`} onPress={() => onDelete(item)} className="-mr-2 h-12 w-12 items-center justify-center active:opacity-60">
        <Ionicons name="trash-outline" size={20} color={colors.muted} />
      </Pressable> : null}
    </View>;
  })}</View>;
}

/**
 * Values in minor units; `floor` keeps tiny weeks from looking huge (default $40.000).
 * Each bar is a button: tapping it calls `onSelect` (the screen shows that bar's amount).
 */
export function BarChart({ values, labels, highlight, onSelect, describe, height = 120, floor = 4_000_000 }: { values: number[]; labels: string[]; highlight: number; onSelect: (index: number) => void; describe: (index: number) => string; height?: number; floor?: number }) {
  const max = Math.max(...values, floor);
  return <View style={{ height: height + 26 }}>
    <View className="flex-1 flex-row items-end justify-around gap-1.5 pb-6">
      {values.map((value, index) => <Pressable key={index} accessibilityRole="button" accessibilityState={{ selected: index === highlight }} accessibilityLabel={`${describe(index)}: ${formatCOP(value)}`} onPress={() => { onSelect(index); announce(`${describe(index)}: ${formatCOP(value)}`); }} className="h-full flex-1 items-center justify-end active:opacity-70">
        <View className="w-full max-w-[28px] rounded-t-lg" style={{ height: Math.max(4, Math.min(height, value / max * height)), backgroundColor: index === highlight ? colors.brand : colors.chart }} />
        <Text className={`absolute -bottom-[22px] text-xs ${index === highlight ? 'font-strong text-brand' : 'text-muted'}`}>{labels[index]}</Text>
      </Pressable>)}
    </View>
    <View pointerEvents="none" className="absolute bottom-6 left-0 right-0 border-t border-line" />
  </View>;
}

export function GradientTile({ children, colors: stops, className = '' }: { children: React.ReactNode; colors: [string, string, ...string[]]; className?: string }) {
  return <View className={`overflow-hidden rounded-3xl ${className}`}><LinearGradient colors={stops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>{children}</LinearGradient></View>;
}

/* ---------- Bottom sheet ---------- */

/**
 * `footer` stays pinned under the scrolling content (the primary button).
 * `dirty`: the form has input, so a backdrop tap only hides the keyboard; the close button still closes.
 */
export function Sheet({ visible = true, close, title, children, footer, dirty = false }: { visible?: boolean; close: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; dirty?: boolean }) {
  const insets = useSafeAreaInsets();
  // The dim backdrop fades in (Modal "fade") while only the panel slides up.
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
    <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end bg-[#0B2523AA]">
      <Pressable accessible={false} onPress={dirty ? Keyboard.dismiss : close} className="absolute inset-0" />
      <Animated.View entering={SlideInDown.duration(280)} style={{ paddingBottom: Math.max(32, insets.bottom + 16) }} className="max-h-[92%] rounded-t-[28px] bg-panel px-5 pt-5">
        <View className="mb-4 flex-row items-center justify-between gap-3">
          <Text accessibilityRole="header" className="flex-1 font-heavy text-xl text-ink">{title}</Text>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cerrar" className="h-12 w-12 items-center justify-center rounded-full bg-canvas active:opacity-70"><Ionicons name="close" size={22} color={colors.muted} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {footer ? <View className="pt-3">{footer}</View> : null}
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>;
}

export function Loading() {
  return <View className="flex-1 items-center justify-center bg-canvas"><ActivityIndicator color={colors.brand} /></View>;
}
