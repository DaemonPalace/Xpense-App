import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { setOnUnauthorized } from '@/lib/api';
import * as cognito from '@/lib/cognito';
import { loadSession, saveSession } from '@/lib/session';

type Status = 'loading' | 'signedOut' | 'signedIn';
interface SessionValue {
  status: Status;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    loadSession().then((s) => setStatus(s ? 'signedIn' : 'signedOut'), () => setStatus('signedOut'));
    setOnUnauthorized(() => {
      saveSession(null).finally(() => setStatus('signedOut'));
    });
  }, []);

  const value: SessionValue = {
    status,
    async signIn(email, password) {
      await saveSession(await cognito.signIn(email.trim().toLowerCase(), password));
      setStatus('signedIn');
    },
    async signOut() {
      await saveSession(null);
      setStatus('signedOut');
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
