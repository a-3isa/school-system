'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { todayCairo } from '@/lib/api';
import { useApi, useEvery } from '@/lib/hooks';
import { LangSwitch, useI18n } from '@/lib/i18n';
import { has, useSession } from '@/lib/session';
import { useChatEvent } from '@/lib/socket';
import { Dict } from '@/lib/strings';
import { initials, Toaster } from './ui';
import { Crest } from './Crest';

type NavKey = keyof Dict['nav'];

interface NavItem {
  href: string;
  key: NavKey;
  module?: string;
  /** A feature switch inside the module (e.g. messaging › polls). */
  feature?: string;
  roles?: string[];
  /** Only for schools that subscribe to automatic attendance (straps). */
  straps?: boolean;
  /** Shows a number beside the link: open follow-ups, excuses waiting for a decision, or unread messages. */
  count?: 'exceptions' | 'excuses' | 'messages';
}

const ADMIN = ['SCHOOL_ADMIN'];
/** Staff who see the whole school; a teacher only sees their own classes. */
const SCHOOL_WIDE = ['SCHOOL_ADMIN', 'TRANSPORT', 'NURSE', 'CANTEEN', 'ACCOUNTANT', 'SOCIAL_WORKER'];
/** Every member of staff, teachers included. */
export const STAFF = [...SCHOOL_WIDE, 'TEACHER'];

/** Who writes announcements and polls (teachers to their own classes only), and who chats with parents. */
const WRITERS = ['SCHOOL_ADMIN', 'SOCIAL_WORKER', 'TEACHER'];
const CHATTERS = ['SCHOOL_ADMIN', 'TEACHER'];

// Later features add their own items here (academics, activities).
const SCHOOL_NAV: { group: NavKey; items: NavItem[] }[] = [
  { group: 'teaching', items: [{ href: '/class', key: 'myClass', roles: ['TEACHER'] }, { href: '/profile', key: 'myProfile', roles: ['TEACHER'] }] },
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
    group: 'messages',
    items: [
      { href: '/messages', key: 'inbox', module: 'messaging', feature: 'chat', roles: CHATTERS, count: 'messages' },
      { href: '/announcements', key: 'announcements', module: 'messaging', roles: WRITERS },
      { href: '/polls', key: 'polls', module: 'messaging', feature: 'polls', roles: WRITERS },
      { href: '/meetings', key: 'meetings', module: 'messaging', feature: 'meetings', roles: CHATTERS },
      { href: '/emergency', key: 'emergency', module: 'messaging', roles: ADMIN },
    ],
  },
  {
    group: 'academics',
    items: [
      { href: '/academics/gradebook', key: 'gradebook', module: 'academics', roles: WRITERS },
      { href: '/academics/exams', key: 'exams', module: 'academics', roles: STAFF },
      { href: '/academics/report-cards', key: 'reportCards', module: 'academics', feature: 'reportCards', roles: WRITERS },
    ],
  },
  { group: 'behaviour', items: [{ href: '/behaviour', key: 'behaviourNotes', module: 'behavior', roles: WRITERS }] },
  {
    group: 'activities',
    items: [
      { href: '/activities', key: 'clubs', module: 'activities', roles: STAFF },
      { href: '/trips', key: 'trips', module: 'activities', feature: 'trips', roles: STAFF },
      { href: '/events', key: 'events', module: 'activities', feature: 'events', roles: ADMIN },
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
  // Unread parent messages: counted every minute, and straight away when one arrives.
  const showMessages = has(me, 'messaging', 'chat') && CHATTERS.includes(me.role);
  const unread = useApi<{ count: number }>(showMessages ? '/threads/unread-count' : null);
  useEvery(60_000, unread.reload, showMessages);
  useChatEvent('message', unread.reload, showMessages);
  useChatEvent('read', unread.reload, showMessages);
  const counts = { exceptions: open.data?.length ?? 0, excuses: waiting.data?.length ?? 0, messages: unread.data?.count ?? 0 };
  // A child who isn't at school and whose parents don't know where they are: the one thing that can't wait.
  const urgent = (open.data ?? []).filter((e) => e.type === 'ABSENT_UNKNOWN');

  const groups = (me.role === 'OWNER' ? OWNER_NAV : SCHOOL_NAV)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (!i.module || has(me, i.module, i.feature)) && (!i.roles || i.roles.includes(me.role)) && (!i.straps || me.straps)),
    }))
    .filter((g) => g.items.length);
  // The most specific matching link is the current page.
  const current = groups.flatMap((g) => g.items).filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // Nobody stays on a page that isn't theirs (typed in, or a school without straps).
  // A teacher's first link is their class in front of them.
  const home = groups[0]?.items[0]?.href;
  const allowed = !!current;
  useEffect(() => {
    if (!allowed && home && pathname !== home) router.replace(home);
  }, [allowed, home, pathname, router]);
  if (!allowed) return null;

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
