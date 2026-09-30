'use client';
import Link from 'next/link';
import { useState } from 'react';
import { todayCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Badge, Card, Empty, ErrorNote, Field, PageHead } from '@/components/ui';

export default function AttendanceHome() {
  const [date, setDate] = useState(todayCairo());
  const lessons = useApi<any[]>(`/attendance/my-lessons?date=${date}`);

  return (
    <>
      <PageHead
        eyebrow="Attendance"
        title="Take attendance"
        sub="Pick a lesson to mark every student. Teachers can mark and correct today; earlier days are corrected by an admin."
        actions={
          <Field label="Day" id="day">
            <input id="day" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        }
      />
      <ErrorNote error={lessons.error} />
      <Card title="Lessons" pad={false}>
        {lessons.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Period</th><th>Time</th><th>Class</th><th>Subject</th><th>Room</th><th>Marked</th><th /></tr>
              </thead>
              <tbody>
                {lessons.data.map((l) => (
                  <tr key={`${l.classId}:${l.periodId}`}>
                    <td className="num">{l.period}</td>
                    <td className="num">{l.startTime}–{l.endTime}</td>
                    <td>{l.className}</td>
                    <td>{l.subject}</td>
                    <td>{l.room}</td>
                    <td>{l.students && l.marked >= l.students ? <Badge tone="ok">All {l.students}</Badge> : <Badge tone="warn">{l.marked} of {l.students}</Badge>}</td>
                    <td><Link className="btn small primary" href={`/attendance/${l.classId}/${l.periodId}?date=${date}`}>Mark</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{lessons.loading ? 'Loading…' : 'No lessons on this day.'}</Empty>
        )}
      </Card>
    </>
  );
}
