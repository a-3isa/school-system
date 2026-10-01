'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { todayCairo } from '@/lib/api';
import { useApi, useEvery } from '@/lib/hooks';
import { LangSwitch, useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Dict } from '@/lib/strings';
import { initials, Toaster } from './ui';

type NavKey = keyof Dict['nav'];

interface NavItem {
  href: string;
  key: NavKey;
  module?: string;
  roles?: string[];
  /** Only for schools that subscribe to automatic attendance (straps). */
  straps?: boolean;
  /** Shows the number of open exceptions. */
  count?: boolean;
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
      { href: '/attendance/exceptions', key: 'exceptions', module: 'attendance', roles: SCHOOL_WIDE, count: true },
      { href: '/where', key: 'where', module: 'attendance', roles: SCHOOL_WIDE, straps: true },
    ],
  },
  {
    group: 'people',
    items: [
      { href: '/students', key: 'students', roles: SCHOOL_WIDE },
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
  const { t } = useI18n();
  const pathname = usePathname();
  const roleName = t.roles[me.role as keyof Dict['roles']] ?? me.role;
  const schoolName = me.schoolName ?? t.common.platformName;
  const strapsLabel = me.role === 'OWNER' ? t.roles.OWNER : me.straps ? t.shell.withStraps : t.shell.withoutStraps;

  const showCount = me.modules.includes('attendance') && SCHOOL_WIDE.includes(me.role);
  const open = useApi<any[]>(showCount ? `/attendance/exceptions?date=${todayCairo()}&status=OPEN` : null);
  useEvery(60_000, open.reload, showCount);

  // A teacher has one screen and no menu: the class in front of them.
  if (me.role === 'TEACHER') {
    return (
      <div className="app solo">
        <main className="main">
          <div className="topbar">
            <span className="topbar-school"><b>{schoolName}</b><span>{strapsLabel}</span></span>
            <div className="topbar-right">
              <span className="me">
                <span className="avatar" aria-hidden="true">{initials(me.name)}</span>
                <span className="me-text"><b>{me.name}</b><span>{roleName}</span></span>
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

  const groups = (me.role === 'OWNER' ? OWNER_NAV : SCHOOL_NAV)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (!i.module || me.modules.includes(i.module)) && (!i.roles || i.roles.includes(me.role)) && (!i.straps || me.straps)),
    }))
    .filter((g) => g.items.length);
  // The most specific matching link is the current page.
  const current = groups.flatMap((g) => g.items).filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="app">
      <aside className="side">
        <div className="side-school">
          <b>{schoolName}</b>
          <span>{strapsLabel}</span>
        </div>
        {groups.map((g) => (
          <nav className="nav" key={g.group} aria-label={t.nav[g.group]}>
            <div className="nav-label">{t.nav[g.group]}</div>
            {g.items.map((i) => (
              <Link key={i.href} href={i.href} aria-current={current === i.href ? 'page' : undefined}>
                <span>{t.nav[i.key]}</span>
                {i.count && !!open.data?.length && <span className="count">{open.data.length}</span>}
              </Link>
            ))}
          </nav>
        ))}
        <div className="side-foot">
          <div className="me">
            <span className="avatar" aria-hidden="true">{initials(me.name)}</span>
            <span className="me-text"><b>{me.name}</b><span>{roleName}</span></span>
          </div>
          <LangSwitch />
          <button type="button" className="signout" onClick={logout}>{t.shell.signOut}</button>
        </div>
      </aside>
      <main className="main">{children}</main>
      <Toaster />
    </div>
  );
}
