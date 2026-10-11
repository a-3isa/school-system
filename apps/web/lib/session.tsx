'use client';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, getToken, setToken } from './api';
import { useI18n } from './i18n';

export interface Me {
  id: string;
  name: string;
  /** MR, MS, MRS or DR for staff. */
  honorific?: string | null;
  email: string | null;
  role: 'OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'TRANSPORT' | 'NURSE' | 'CANTEEN' | 'ACCOUNTANT' | 'SOCIAL_WORKER' | 'PARENT';
  schoolId: string | null;
  schoolName: string | null;
  schoolNameAr?: string | null;
  /** The school has uploaded its crest (GET /school/logo). */
  schoolLogo?: boolean;
  attendanceMode: 'MANUAL' | 'AUTOMATIC' | null;
  /** The school subscribes to automatic attendance: straps, gateways and tracking. */
  straps: boolean;
  modules: string[];
  /** Each enabled module's feature switches, e.g. features.messaging.chat. */
  features: Record<string, Record<string, boolean>>;
}

/** Does this school have the module, and (if given) the feature inside it? */
export function has(me: Pick<Me, 'modules' | 'features'>, module: string, feature?: string): boolean {
  return me.modules.includes(module) && (!feature || !!me.features?.[module]?.[feature]);
}

const SessionContext = createContext<{ me: Me; refresh: () => Promise<void>; logout: () => void } | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Loads the signed-in user, or sends the visitor to the login page. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  const refresh = async () => {
    const m = await api<Me>('/auth/me');
    // Remembered so the sign-in page can show the school's name next time.
    try {
      if (m.schoolName) localStorage.setItem('sp-school', JSON.stringify({ en: m.schoolName, ar: m.schoolNameAr ?? null }));
    } catch {
      /* storage unavailable */
    }
    setMe(m);
  };

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    refresh().catch(() => router.replace('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!me) return;
    if (me.role === 'PARENT') {
      setToken(null);
      router.replace('/login?parent=1');
    } else if (me.role === 'OWNER' && !pathname.startsWith('/owner')) {
      router.replace('/owner');
    }
  }, [me, pathname, router]);

  const logout = () => {
    setToken(null);
    router.replace('/login');
  };

  if (!me) return <div className="loading">{t.common.loading}</div>;
  return <SessionContext.Provider value={{ me, refresh, logout }}>{children}</SessionContext.Provider>;
}
