'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { todayCairo } from '@/lib/api';
import { useApi, useEvery } from '@/lib/hooks';
import { LangSwitch, useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Dict } from '@/lib/strings';
import { initials, Toaster } from './ui';
import { Crest } from './Crest';

type NavKey = keyof Dict['nav'];

interface NavItem {
  href: string;
  key: NavKey;
  module?: string;
  roles?: string[];
  /** Only for schools that subscribe to automatic attendance (straps). */
  straps?: boolean;
  /** Shows a number beside the link: open follow-ups, or excuses waiting for a decision. */
  count?: 'exceptions' | 'excuses';
}

const ADMIN = ['SCHOOL_ADMIN'];
/** Staff who see the whole school; a teacher only sees the class in front of them. */
const SCHOOL_WIDE = ['SCHOOL_ADMIN', 'TRANSPORT', 'NURSE', 'CANTEEN', 'ACCOUNTANT'];

const SCHOOL_NAV: { group: NavKey; items: NavItem[] }[] = [
  { group: 'overview', items: [{ href: '/today', key: 'today', roles: SCHOOL_WIDE }] },
  {
    group: 'attendance',
    items: [
      { href: '/attendance', key: 'take', module: 'attendance', roles: ADMIN },
      { href: '/attendance/exceptions', key: 'exceptions', module: 'attendance', roles: SCHOOL_WIDE, count: 'exceptions' },
      { href: '/excuses', key: 'excuses', module: 'attendance', roles: ADMIN, count: 'excuses' },
      { href: '/where', key: 'where', module: 'attendance', roles: SCHOOL_WIDE, straps: true },
    ],
  },
  {
    group: 'people',
    items: [
      { href: '/students', key: 'students', roles: SCHOOL_WIDE },
      { href: '/parents', key: 'parents', roles: SCHOOL_WIDE },
      { href: '/classes', key: 'classes', roles: SCHOOL_WIDE },
      { href: '/students/import', key: 'import', roles: ADMIN },
      { href: '/staff', key: 'staff', roles: ADMIN },
    ],
  },
  {
    group: 'setup',
    items: [
      { href: '/timetable', key: 'timetable', roles: SCHOOL_WIDE },
      { href: '/setup', key: 'structure', roles: ADMIN },
      { href: '/devices', key: 'devices', roles: ADMIN, straps: true },
      { href: '/modules', key: 'modules', roles: ADMIN },
      { href: '/audit', key: 'audit', roles: ADMIN },
    ],
  },
];

const OWNER_NAV: { group: NavKey; items: NavItem[] }[] = [
  { group: 'platform', items: [{ href: '/owner', key: 'schools' }, { href: '/owner/gateways', key: 'gateways' }] },
];

export function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  const { t, lang, staff } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const roleName = t.roles[me.role as keyof Dict['roles']] ?? me.role;
  const schoolName = me.schoolName ?? t.common.platformName;
  const strapsLabel = me.role === 'OWNER' ? t.roles.OWNER : me.straps ? t.shell.withStraps : t.shell.withoutStraps;

  const showCount = me.modules.includes('attendance') && SCHOOL_WIDE.includes(me.role);
  const open = useApi<any[]>(showCount ? `/attendance/exceptions?date=${todayCairo()}&status=OPEN` : null);
  useEvery(60_000, open.reload, showCount);
  const showExcuses = me.modules.includes('attendance') && me.role === 'SCHOOL_ADMIN';
  const waiting = useApi<any[]>(showExcuses ? '/excuses?status=PENDING' : null);
  useEvery(60_000, waiting.reload, showExcuses);
  const counts = { exceptions: open.data?.length ?? 0, excuses: waiting.data?.length ?? 0 };
  // A child who isn't at school and whose parents don't know where they are: the one thing that can't wait.
  const urgent = (open.data ?? []).filter((e) => e.type === 'ABSENT_UNKNOWN');

  const groups = (me.role === 'OWNER' ? OWNER_NAV : SCHOOL_NAV)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (!i.module || me.modules.includes(i.module)) && (!i.roles || i.roles.includes(me.role)) && (!i.straps || me.straps)),
    }))
    .filter((g) => g.items.length);
  // The most specific matching link is the current page.
  const current = groups.flatMap((g) => g.items).filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // Nobody stays on a page that isn't theirs (typed in, or a school without straps).
  const home = me.role === 'TEACHER' ? '/class' : groups[0]?.items[0]?.href;
  const allowed = me.role === 'TEACHER' ? pathname === '/class' : !!current;
  useEffect(() => {
    if (!allowed && home && pathname !== home) router.replace(home);
  }, [allowed, home, pathname, router]);
  if (!allowed) return null;

  // A teacher has one screen and no menu: the class in front of them.
  if (me.role === 'TEACHER') {
    return (
      <div className="app solo">
        <main className="main">
          <div className="topbar">
            <span className="topbar-school"><Crest name={schoolName} hasLogo={me.schoolLogo} size="sm" /><span className="school-text"><b>{lang === 'ar' && me.schoolNameAr ? me.schoolNameAr : schoolName}</b><span className="sub">{strapsLabel}</span></span></span>
            <div className="topbar-right">
              <span className="me">
                <span className="avatar" aria-hidden="true">{initials(me.name)}</span>
                <span className="me-text"><b>{staff(me)}</b><span>{roleName}</span></span>
              </span>
              <LangSwitch />
              <button type="button" className="signout" onClick={logout}>{t.shell.signOut}</button>
            </div>
          </div>
          {children}
        </main>
        <Toaster />
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="side-school">
          <Crest name={schoolName} hasLogo={me.schoolLogo} />
          <span className="school-text">
            <b>{lang === 'ar' && me.schoolNameAr ? me.schoolNameAr : schoolName}</b>
            <span className="sub">{strapsLabel}</span>
          </span>
        </div>
        {groups.map((g) => (
          <nav className="nav" key={g.group} aria-label={t.nav[g.group]}>
            <div className="nav-label">{t.nav[g.group]}</div>
            {g.items.map((i) => (
              <Link key={i.href} href={i.href} aria-current={current === i.href ? 'page' : undefined}>
                <span>{t.nav[i.key]}</span>
                {i.count && counts[i.count] > 0 && <span className="count">{counts[i.count]}</span>}
              </Link>
            ))}
          </nav>
        ))}
        <div className="side-foot">
          <div className="me">
            <span className="avatar" aria-hidden="true">{initials(me.name)}</span>
            <span className="me-text"><b>{staff(me)}</b><span>{roleName}</span></span>
          </div>
          <LangSwitch />
          <button type="button" className="signout" onClick={logout}>{t.shell.signOut}</button>
        </div>
      </aside>
      <main className="main">
        {urgent.length > 0 && (
          <Link href="/attendance/exceptions" className="note error urgent" role="alert">
            <span className="note-body"><b>{t.urgent.title(urgent.length)}</b><span>{t.urgent.body} {urgent.map((e) => e.student && `${e.student.firstName} ${e.student.lastName}`).filter(Boolean).join(' · ')}</span></span>
            <span style={{ marginInlineStart: 'auto', fontWeight: 600, whiteSpace: 'nowrap' }}>{t.urgent.open} →</span>
          </Link>
        )}
        {children}
      </main>
      <Toaster />
    </div>
  );
}
