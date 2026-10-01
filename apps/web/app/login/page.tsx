'use client';
import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, setToken } from '@/lib/api';
import { ErrorNote } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('parent') ? 'Parents use the mobile app. This dashboard is for school staff.' : null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ token: string; user: { role: string } }>('/auth/login', { login, password });
      setToken(res.token);
      router.replace(res.user.role === 'OWNER' ? '/owner' : '/today');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div>
        <div className="eyebrow">School Platform</div>
        <h1>Sign in</h1>
      </div>
      <ErrorNote error={error} />
      <div className="field">
        <label htmlFor="login">Email or phone</label>
        <input id="login" className="input" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
