import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { announce } from '@/lib/announce';
import { api, ApiError, type Summary, type Transaction } from '@/lib/api';
import { localDate } from '@/lib/money';
import { registerForPush } from '@/lib/push';
import { useSession } from '@/session-context';
import { t } from '@/strings';

export type Sheet = 'expense' | 'income' | 'plan' | 'saving' | null;

interface AppData {
  summary: Summary | null;
  /** Newest first: this month plus the last 7 days (first page, ≤ 100). */
  recent: Transaction[];
  hasAccounts: boolean;
  error: string;
  refresh(): Promise<void>;
  sheet: Sheet;
  openSheet(s: Exclude<Sheet, null>): void;
  closeSheet(): void;
  toast: string;
  notify(message: string): void;
}

const Ctx = createContext<AppData | null>(null);

/** Server state for the signed-in screens, plus the global sheets and toast from the prototype. */
export function DataProvider({ children }: { children: ReactNode }) {
  // Remount on sign-in/out so one user's data never leaks into the next session. The (tabs) layout loads it.
  return <Provider key={useSession().status}>{children}</Provider>;
}

function Provider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await api<Summary>('GET', '/api/summary');
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 6);
      const from = [localDate(weekAgo), `${s.month}-01`].sort()[0];
      const [page, accounts] = await Promise.all([
        api<{ items: Transaction[] }>('GET', `/api/transactions?from=${from}&to=${s.today}`),
        api<unknown[]>('GET', '/api/accounts'),
      ]);
      setSummary(s);
      setRecent(page.items);
      setHasAccounts(accounts.length > 0);
      setError('');
      if (s.consented && s.onboarded) registerForPush();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setError(t.common.genericError);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    announce(toast);
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  return <Ctx.Provider value={{
    summary, recent, hasAccounts, error, refresh, sheet, toast,
    openSheet: setSheet, closeSheet: () => setSheet(null), notify: setToast,
  }}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData outside DataProvider');
  return v;
}
