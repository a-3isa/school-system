'use client';
import Link from 'next/link';
import { minutes, nowCairo, todayCairo } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Tone } from './ui';

export interface Lesson {
  classId: string;
  className: string;
  periodId: string;
  period: number;
  startTime: string;
  endTime: string;
  subject: string;
  room: string;
  students: number;
  marked: number;
}

/** One lesson with how far it's marked, and a button to open its register. */
export function LessonRow({ l, date, withButton = true }: { l: Lesson; date: string; withButton?: boolean }) {
  const { t, x } = useI18n();
  const { me } = useSession();
  const isToday = date === todayCairo();
  const now = minutes(nowCairo());
  const s = minutes(l.startTime);
  const e = minutes(l.endTime);
  const done = l.students > 0 && l.marked >= l.students;
  const running = isToday && now >= s && now < e;
  const later = (isToday && now < s) || date > todayCairo();
  const count = `${l.marked} / ${l.students}`;

  let state: { cls: string; text: string; pct: number };
  if (done) state = { cls: 'done', text: `${count} · ${t.lessons.done}`, pct: 100 };
  else if (running) state = { cls: 'now', text: me.straps ? t.lessons.nowStraps : `${count} · ${t.lessons.nowManual}`, pct: Math.round(((now - s) / (e - s)) * 100) };
  else if (l.marked > 0) state = { cls: 'part', text: count, pct: Math.round((l.marked / Math.max(l.students, 1)) * 100) };
  else if (later) state = { cls: 'next', text: t.lessons.notStarted, pct: 0 };
  else state = { cls: 'part', text: `${count} · ${t.lessons.notMarked}`, pct: 0 };

  return (
    <div className={`lesson${running ? ' now' : ''}`}>
      <span className="when"><b>{t.lessons.p(l.period)}</b><span>{l.startTime}</span></span>
      <span className="what"><b>{x(`${l.className} · ${l.subject}`)}</b><span>{x(l.room)}</span></span>
      <span className="progress">
        <b className={`state-${state.cls}`}>{x(state.text)}</b>
        <span className="meter"><span style={{ width: `${state.pct}%` }} /></span>
      </span>
      {withButton && (
        <Link className={`btn${running ? ' primary' : ''}`} href={`/attendance/${l.classId}/${l.periodId}?date=${date}`}>
          {done ? t.lessons.view : t.lessons.open}
        </Link>
      )}
    </div>
  );
}

export const EXCEPTION_TONE: Record<string, Tone> = {
  NOT_IN_CLASS: 'A',
  LEFT_LESSON: 'L',
  LEFT_EARLY: 'T',
  STRAP_NOT_SEEN: 'E',
  LOW_BATTERY: 'L',
  GATEWAY_OFFLINE: 'E',
};
