'use client';
import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, setToken } from '@/lib/api';
import { ErrorNote } from '@/components/ui';

type Mode = 'signin' | 'forgot' | 'code';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(params.get('parent') ? 'Parents use the mobile app. This dashboard is for school staff.' : null);
  const [busy, setBusy] = useState(false);

  const go = (role: string) => router.replace(role === 'OWNER' ? '/owner' : role === 'TEACHER' ? '/class' : '/today');

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function signedIn(res: { token: string; user: { role: string } }) {
    if (res.user.role === 'PARENT') {
      setError('Parents use the mobile app. This dashboard is for school staff.');
      return;
    }
    setToken(res.token);
    go(res.user.role);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'signin') void run(async () => signedIn(await post('/auth/login', { login: email, password })));
    if (mode === 'forgot') void run(async () => { await post('/auth/password/forgot', { email }); setPassword(''); setMode('code'); });
    if (mode === 'code') void run(async () => signedIn(await post('/auth/password/set', { email, code, password })));
  }

  return (
    <form onSubmit={submit}>
      <div>
        <div className="eyebrow">School Platform</div>
        <h1>{mode === 'signin' ? 'Sign in' : 'New password'}</h1>
      </div>
      <ErrorNote error={error} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={mode === 'code'} />
      </div>
      {mode === 'code' && (
        <>
          <p className="muted small" style={{ margin: 0 }}>If this email has an account, a 6-digit code is on its way. It works for 15 minutes.</p>
          <div className="field">
            <label htmlFor="code">Code from the email</label>
            <input id="code" className="input num" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
        </>
      )}
      {mode !== 'forgot' && (
        <div className="field">
          <label htmlFor="password">{mode === 'code' ? 'New password (8 characters or more)' : 'Password'}</label>
          <input id="password" className="input" type="password" minLength={mode === 'code' ? 8 : undefined} autoComplete={mode === 'code' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
      )}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Email me a code' : 'Save and sign in'}
      </button>
      {mode === 'signin' ? (
        <button className="btn" type="button" onClick={() => { setError(null); setMode('forgot'); }}>Forgot password?</button>
      ) : (
        <button className="btn" type="button" onClick={() => { setError(null); setCode(''); setMode('signin'); }}>Back to sign in</button>
      )}
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
