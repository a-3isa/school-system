'use client';
import Link from 'next/link';
import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { dateTimeCairo, post, timeCairo, todayCairo } from '@/lib/api';
import { useApi, useEvery } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { EXCEPTION_TONE, Lesson, LessonRow } from '@/components/Lessons';
import { Empty, ErrorNote, Kpi, LiveStamp, Note, PageHead, Section, STATUS_GLYPH, STATUS_TONE, STATUSES, Tag } from '@/components/ui';

export default function TodayPage() {
  const { me } = useSession();
  const { t, x, day } = useI18n();
  const router = useRouter();
  // Today is the whole school; a teacher's only screen is their class.
  useEffect(() => {
    if (me.role === 'TEACHER') router.replace('/class');
  }, [me.role, router]);
  const date = todayCairo();
  const hasAttendance = me.modules.includes('attendance') && me.role !== 'TEACHER';
  const summary = useApi(hasAttendance ? `/attendance/summary?date=${date}` : null);
  const status = useApi<any>(`/school/day?date=${date}`);
  const closed = status.data && !status.data.open
    ? status.data.reason === 'HOLIDAY' ? t.eg.closed.HOLIDAY(status.data.name) : t.eg.closed[status.data.reason as 'WEEKEND' | 'BREAK' | 'OUTSIDE_YEAR']
    : null;
  const exceptions = useApi<any[]>(hasAttendance ? `/attendance/exceptions?date=${date}&status=OPEN` : null);
  const messages = useApi<any[]>(me.role === 'TEACHER' ? null : '/notifications');
  const lessons = useApi<Lesson[]>(hasAttendance && me.role === 'SCHOOL_ADMIN' ? `/attendance/my-lessons?date=${date}` : null);
  const refresh = useCallback(() => Promise.all([summary.reload(), exceptions.reload(), lessons.reload()]), [summary.reload, exceptions.reload, lessons.reload]);
  useEvery(15_000, refresh, hasAttendance);

  const periods: any[] = summary.data?.periods ?? [];
  const latest = [...periods].reverse().find((p) => Object.values(p.counts as Record<string, number>).some((n) => n > 0));
  const c = latest?.counts ?? { PRESENT: 0, LATE: 0, ABSENT: 0, ON_TRIP: 0, EXCUSED: 0 };
  const open = exceptions.data ?? [];
  const oldest = open.length ? open.reduce((a, b) => (a.createdAt < b.createdAt ? a : b)) : null;
  const unread = (messages.data ?? []).filter((m) => !m.readAt);

  async function markRead(ids: string[]) {
    await Promise.all(ids.map((id) => post(`/notifications/${id}/read`)));
    await messages.reload();
  }

  return (
    <>
      <PageHead sub={x([day(date), status.data?.term && t.eg.term(status.data.term), status.data?.year].filter(Boolean).join(' · '))} title={t.today.title} actions={hasAttendance && <LiveStamp at={summary.loadedAt} />} />
      {closed && <Note title={closed} />}
      {!hasAttendance && <Note>{t.today.noAttendance}</Note>}
      {hasAttendance && (
        <>
          <ErrorNote error={summary.error} />
          <div className="kpis">
            <Kpi label={t.today.students} value={summary.data?.students ?? '—'} sub={me.straps ? t.today.cameThroughGate(summary.data?.arrived ?? 0) : t.today.enrolled} />
            <Kpi label={latest ? t.today.presentIn(latest.number) : t.today.present} value={c.PRESENT + c.LATE} sub={latest ? t.today.ofN(summary.data?.students ?? 0) : t.today.noneMarked} color="var(--p)" />
            <Kpi label={t.today.absent} value={c.ABSENT} sub={latest ? t.today.inPeriod(latest.number) : '—'} color="var(--a)" />
            <Kpi label={t.today.needsAttention} value={exceptions.data ? open.length : '—'} sub={oldest ? t.today.oldestAt(timeCairo(oldest.createdAt)) : t.today.nothingOpen} color="var(--l)" />
          </div>
          <div className="cols">
            {lessons.data && (
              <Section title={t.today.lessons}>
                <div className="panel">
                  {lessons.data.length ? lessons.data.map((l) => <LessonRow key={`${l.classId}:${l.periodId}`} l={l} date={date} withButton={false} />) : <Empty>{t.today.noLessons}</Empty>}
                </div>
              </Section>
            )}
            <Section title={t.today.needsAttention} aside={open.length > 0 && <Link href="/attendance/exceptions" className="btn link">{t.today.seeAll(open.length)}</Link>}>
              <div className="panel">
                {open.length ? (
                  open.slice(0, 4).map((e) => (
                    <div key={e.id} className="list-row">
                      <span className="row"><Tag tone={EXCEPTION_TONE[e.type]}>{t.exc.type[e.type as keyof typeof t.exc.type] ?? e.type}</Tag><span className="small cap num">{timeCairo(e.createdAt)}</span></span>
                      <span style={{ fontSize: 14, lineHeight: 1.5 }}>{x(e.message)}</span>
                    </div>
                  ))
                ) : (
                  <Empty>{t.today.nothingNeeds}</Empty>
                )}
              </div>
            </Section>
          </div>
          <Section title={t.today.byPeriod}>
            <div className="panel scroll">
              <table style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th>{t.today.period}</th>
                    {STATUSES.map((s) => (
                      <th key={s} style={{ color: `var(--${STATUS_TONE[s].toLowerCase()})` }}><span aria-hidden="true">{STATUS_GLYPH[s]}</span> {t.status[s]}</th>
                    ))}
                    <th style={{ width: '28%' }} />
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => {
                    const total = STATUSES.reduce((n, s) => n + p.counts[s], 0);
                    return (
                      <tr key={p.id} className="num" style={{ color: total ? undefined : 'var(--cap)' }}>
                        <td><b style={{ fontWeight: 600 }}>{t.today.periodN(p.number)}</b><span className="sub ltr">{p.startTime}–{p.endTime}</span></td>
                        {STATUSES.map((s) => <td key={s}>{total ? p.counts[s] : '—'}</td>)}
                        <td>
                          <span className="stackbar">
                            {STATUSES.filter((s) => p.counts[s] > 0).map((s) => <span key={s} style={{ flex: p.counts[s], background: `var(--${STATUS_TONE[s].toLowerCase()})` }} />)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!periods.length && <Empty>{t.today.addPeriods}</Empty>}
            </div>
          </Section>
        </>
      )}
      {!!messages.data?.length && (
        <Section title={t.today.messages} aside={unread.length > 0 && <button type="button" className="btn link" onClick={() => markRead(unread.map((m) => m.id))}>{t.today.markAllRead}</button>}>
          <div className="panel">
            {messages.data.slice(0, 8).map((m) => (
              <div key={m.id} className="list-row" style={{ display: 'grid', gridTemplateColumns: '10px minmax(0,1fr) auto', gap: 14, alignItems: 'start', background: m.readAt ? undefined : 'var(--accent-wash)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 7, background: m.readAt ? 'transparent' : 'var(--accent)' }} />
                <span className="stack" style={{ gap: 3 }}>
                  <span style={{ fontSize: 15, lineHeight: 1.5, fontWeight: m.readAt ? 400 : 600 }}>{x(m.title)}</span>
                  <span className="small cap">{x(m.body)} · {x(dateTimeCairo(m.createdAt))}</span>
                </span>
                {!m.readAt && <button type="button" className="btn small" onClick={() => markRead([m.id])}>{t.today.markRead}</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
