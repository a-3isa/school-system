'use client';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, getToken, setToken } from './api';

export interface Me {
  id: string;
  name: string;
  email: string | null;
  role: 'OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'TRANSPORT' | 'NURSE' | 'CANTEEN' | 'ACCOUNTANT' | 'PARENT';
  schoolId: string | null;
  schoolName: string | null;
  attendanceMode: 'MANUAL' | 'AUTOMATIC' | null;
  modules: string[];
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

  const refresh = async () => setMe(await api<Me>('/auth/me'));

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

  if (!me) return <div className="empty">Loading…</div>;
  return <SessionContext.Provider value={{ me, refresh, logout }}>{children}</SessionContext.Provider>;
}
