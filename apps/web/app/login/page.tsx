'use client';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, setToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, Field } from '@/components/ui';
import { Crest } from '@/components/Crest';

type Mode = 'signin' | 'forgot' | 'code';

function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(params.get('parent') ? 'parent' : null);
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
      setError('parent');
      return;
    }
    setToken(res.token);
    go(res.user.role);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'signin') void run(async () => signedIn(await post('/auth/login', { login: email, password })));
    if (mode === 'forgot') void run(async () => { await post('/auth/password/forgot', { email }); setPassword(''); setMode('code'); });
    if (mode === 'code') void run(async () => signedIn(await post('/auth/password/reset', { email, code, password })));
  }

  const back = () => { setError(null); setCode(''); setMode('signin'); };

  return (
    <form onSubmit={submit}>
      {mode !== 'signin' && <span className="small muted" style={{ fontWeight: 600 }}>{mode === 'forgot' ? t.login.step1 : t.login.step2}</span>}
      <h1>{mode === 'signin' ? t.login.signIn : mode === 'forgot' ? t.login.resetTitle : t.login.checkEmail}</h1>
      {mode === 'forgot' && <p>{t.login.resetSub}</p>}
      {mode === 'code' && <p>{t.login.checkEmailSub} <b style={{ color: 'var(--ink)', fontWeight: 500 }}><bdi dir="ltr">{email}</bdi></b></p>}
      <ErrorNote error={error === 'parent' ? t.login.parents : error} />
      {mode !== 'code' && (
        <Field label={t.common.email} id="email">
          <input id="email" className="input" type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
      )}
      {mode === 'code' && (
        <Field label={t.login.code} id="code">
          <input id="code" className="input num code-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
      )}
      {mode !== 'forgot' && (
        <Field label={mode === 'code' ? t.login.newPassword : t.login.password} id="password" help={mode === 'code' ? t.login.pwHelp : undefined}>
          <input id="password" className="input" type="password" minLength={mode === 'code' ? 8 : undefined} autoComplete={mode === 'code' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
      )}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? t.common.oneMoment : mode === 'signin' ? t.login.signIn : mode === 'forgot' ? t.login.sendCode : t.login.saveSignIn}
      </button>
      {mode === 'signin' && <button className="btn link" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => { setError(null); setMode('forgot'); }}>{t.login.forgot}</button>}
      {mode === 'forgot' && <button className="btn link" type="button" style={{ alignSelf: 'flex-start' }} onClick={back}>{t.login.back}</button>}
      {mode === 'code' && (
        <>
          <p className="small">{t.login.noCode}</p>
          <button className="btn link" type="button" style={{ alignSelf: 'flex-start' }} onClick={back}>{t.login.back}</button>
        </>
      )}
    </form>
  );
}

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  // The school this computer last signed in to; the platform's name before that.
  const [school, setSchool] = useState<{ en: string; ar: string | null } | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sp-school');
      if (saved) setSchool(JSON.parse(saved));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const name = (lang === 'ar' && school?.ar) || school?.en || t.common.platformName;
  return (
    <div className="signin">
      <section className="signin-side">
        <div className="signin-brand">
          <Crest name={school?.en ?? t.common.platformName} size="lg" />
          <span><span className="school-name">{name}</span><span className="portal">{t.login.portal}</span></span>
        </div>
        <div className="pitch">
          <div className="signin-ruler" aria-hidden="true">
            <span className="done" style={{ flex: 45 }} /><span className="done" style={{ flex: 45 }} /><span className="gap" style={{ flex: 20 }} />
            <span className="now" style={{ flex: 45 }} /><span style={{ flex: 45 }} /><span className="gap" style={{ flex: 20 }} />
            <span style={{ flex: 45 }} /><span style={{ flex: 45 }} />
          </div>
          <p>{t.login.tagline}</p>
        </div>
        <small>{t.login.help}</small>
      </section>
      <section className="signin-main">
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn small" lang={lang === 'en' ? 'ar' : 'en'} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{lang === 'en' ? 'عربي' : 'English'}</button>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </div>
  );
}
