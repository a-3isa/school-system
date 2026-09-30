'use client';
import Link from 'next/link';
import { todayCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Badge, Card, Empty, ErrorNote, Kpi, PageHead } from '@/components/ui';

export default function TodayPage() {
  const { me } = useSession();
  const date = todayCairo();
  const hasAttendance = me.modules.includes('attendance');
  const summary = useApi(hasAttendance ? `/attendance/summary?date=${date}` : null);
  const exceptions = useApi<any[]>(hasAttendance ? `/attendance/exceptions?date=${date}&status=OPEN` : null);
  const lessons = useApi<any[]>(hasAttendance && ['SCHOOL_ADMIN', 'TEACHER'].includes(me.role) ? `/attendance/my-lessons?date=${date}` : null);

  const periods: any[] = summary.data?.periods ?? [];
  const latest = [...periods].reverse().find((p) => Object.values(p.counts as Record<string, number>).some((n) => n > 0));
  const c = latest?.counts ?? { PRESENT: 0, LATE: 0, ABSENT: 0, ON_TRIP: 0, EXCUSED: 0 };

  return (
    <>
      <PageHead
        eyebrow={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' })}
        title={`Today at ${me.schoolName ?? 'school'}`}
        sub={me.attendanceMode === 'AUTOMATIC' ? 'Attendance is taken automatically from the straps. Anything that needs a person is listed below.' : 'Teachers take attendance on the classroom PCs, period by period.'}
      />
      {!hasAttendance && <div className="notice">Attendance isn’t switched on for this school.</div>}
      {hasAttendance && (
        <>
          <ErrorNote error={summary.error} />
          <div className="grid g4">
            <Kpi label="Students" value={summary.data?.students ?? '—'} sub="enrolled" />
            <Kpi label="Present" value={c.PRESENT + c.LATE} sub={latest ? `period ${latest.number} · ${c.LATE} late` : 'no period marked yet'} />
            <Kpi label="Absent" value={c.ABSENT} sub={latest ? `period ${latest.number}` : '—'} />
            <Kpi label="Needs attention" value={exceptions.data?.length ?? '—'} sub="open exceptions" />
          </div>
          <div className="grid g2">
            {lessons.data && (
              <Card title={me.role === 'TEACHER' ? 'Your lessons today' : 'Lessons today'} pad={false}>
                {lessons.data.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Period</th><th>Class</th><th>Subject</th><th>Marked</th><th /></tr>
                      </thead>
                      <tbody>
                        {lessons.data.map((l) => (
                          <tr key={`${l.classId}:${l.periodId}`}>
                            <td className="num">{l.period} · {l.startTime}</td>
                            <td>{l.className}</td>
                            <td>{l.subject} <span className="muted small">· {l.room}</span></td>
                            <td>{l.marked >= l.students && l.students ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">{l.marked} / {l.students}</Badge>}</td>
                            <td><Link className="btn small" href={`/attendance/${l.classId}/${l.periodId}?date=${date}`}>Open</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>No lessons today.</Empty>
                )}
              </Card>
            )}
            <Card title="Needs attention" action={<Link href="/attendance/exceptions" className="small">All exceptions →</Link>}>
              {exceptions.data?.length ? (
                exceptions.data.slice(0, 8).map((e) => (
                  <div key={e.id} className="row between">
                    <span>{e.message}</span>
                    <Badge tone={e.type === 'GATEWAY_OFFLINE' || e.type === 'LEFT_EARLY' ? 'alert' : 'warn'}>{e.type.replace(/_/g, ' ').toLowerCase()}</Badge>
                  </div>
                ))
              ) : (
                <span className="muted">Nothing needs attention right now.</span>
              )}
            </Card>
          </div>
          <Card title="Attendance by period" pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Period</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>On a trip</th></tr>
                </thead>
                <tbody>
                  {periods.map((p) => (
                    <tr key={p.id} className="num">
                      <td>{p.number} · {p.startTime}–{p.endTime}</td>
                      <td>{p.counts.PRESENT}</td><td>{p.counts.LATE}</td><td>{p.counts.ABSENT}</td><td>{p.counts.EXCUSED}</td><td>{p.counts.ON_TRIP}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!periods.length && <Empty>Add the school’s periods in Classes, rooms &amp; periods.</Empty>}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
