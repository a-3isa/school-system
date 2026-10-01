'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { Toaster } from './ui';

interface NavItem {
  href: string;
  label: string;
  module?: string;
  roles?: string[];
}

const ADMIN = ['SCHOOL_ADMIN'];
const TEACHING = ['SCHOOL_ADMIN', 'TEACHER'];

const SCHOOL_NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ href: '/class', label: 'My class now', module: 'attendance', roles: ['TEACHER'] }, { href: '/today', label: 'Today' }] },
  {
    group: 'Attendance',
    items: [
      { href: '/attendance', label: 'Take attendance', module: 'attendance', roles: TEACHING },
      { href: '/attendance/exceptions', label: 'Exceptions', module: 'attendance' },
      { href: '/where', label: 'Where students are', module: 'attendance' },
    ],
  },
  { group: 'People', items: [{ href: '/students', label: 'Students & parents' }, { href: '/staff', label: 'Staff', roles: ADMIN }] },
  {
    group: 'School setup',
    items: [
      { href: '/timetable', label: 'Timetable' },
      { href: '/setup', label: 'Classes, rooms & periods', roles: ADMIN },
      { href: '/devices', label: 'Devices', roles: ADMIN },
      { href: '/modules', label: 'Modules & settings', roles: ADMIN },
      { href: '/audit', label: 'Audit log', roles: ADMIN },
    ],
  },
];

const OWNER_NAV = [{ group: 'Owner console', items: [{ href: '/owner', label: 'Schools' }, { href: '/owner/gateways', label: 'Gateways' }] }];

const ROLE_NAME: Record<string, string> = {
  OWNER: 'Platform owner', SCHOOL_ADMIN: 'School admin', TEACHER: 'Teacher', TRANSPORT: 'Transport', NURSE: 'Nurse', CANTEEN: 'Canteen', ACCOUNTANT: 'Accountant',
};

export function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  const pathname = usePathname();
  const groups = (me.role === 'OWNER' ? OWNER_NAV : SCHOOL_NAV)
    .map((g) => ({
      ...g,
      items: g.items.filter((i: NavItem) => (!i.module || me.modules.includes(i.module)) && (!i.roles || i.roles.includes(me.role))),
    }))
    .filter((g) => g.items.length);
  // The most specific matching link is the current page.
  const current = groups.flatMap((g) => g.items).filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="logo">{(me.schoolName ?? 'School Platform').slice(0, 1)}</span>
          <div>
            <div className="brand-name">{me.schoolName ?? 'School Platform'}</div>
            <div className="brand-sub">{me.name} · {ROLE_NAME[me.role] ?? me.role}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {groups.map((g) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-label">{g.group}</div>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} aria-current={current === i.href ? 'page' : undefined}>
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {me.email}
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="content">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}
