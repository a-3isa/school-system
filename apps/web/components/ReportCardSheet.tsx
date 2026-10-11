'use client';
import { HONORIFICS, useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Crest } from './Crest';

export interface Band { min: number; label: string; labelAr: string; gpa?: number }

/** What a report card says, as the API sends it (see ReportSnapshot in the API). */
export interface Snapshot {
  student: { id: string; name: string; nameAr: string | null; code: string; gender: string | null };
  class: { name: string; gradeName: string; system: string | null };
  year: { name: string };
  term: 1 | 2;
  subjects: { subjectId: string; name: string; percent: number | null; band: Band | null; comment: string | null; teacher: string | null }[];
  overall: { percent: number | null; band: Band | null; gpa?: number | null };
  attendance: { present: number; late: number; absent: number; excused: number; onTrip: number; days: number };
  classTeacherComment: string | null;
  classTeacher: string | null;
  principalComment: string | null;
  principalName: string | null;
  school: { name: string; nameAr: string | null };
  issuedAt: string;
}

/** "Ms. Hana Nabil" → «مس Hana Nabil» in Arabic; the names themselves stay as written. */
function titled(name: string | null, lang: 'en' | 'ar'): string {
  if (!name || lang === 'en') return name ?? '';
  const m = name.match(/^(Mr|Ms|Mrs|Dr)\.\s+(.*)$/);
  return m ? `${HONORIFICS.ar[m[1].toUpperCase() as 'MR' | 'MS' | 'MRS' | 'DR']} ${m[2]}` : name;
}

/** The report card laid out on an A4 page: the same for the screen preview and for printing. */
export function ReportCardSheet({ s, draft }: { s: Snapshot; draft?: boolean }) {
  const { t, x, lang, day } = useI18n();
  const { me } = useSession();
  const schoolName = lang === 'ar' && s.school.nameAr ? s.school.nameAr : s.school.name;
  const studentName = lang === 'ar' && s.student.nameAr ? s.student.nameAr : s.student.name;
  const band = (b: Band | null) => (b ? (lang === 'ar' ? b.labelAr : b.label) : '—');
  const percent = (p: number | null) => (p === null ? '—' : x(`${p}%`));
  const a = s.attendance;

  return (
    <article className="rc-sheet" lang={lang} aria-label={t.acad.reportCard}>
      <header className="rc-head">
        <Crest name={schoolName} hasLogo={me.schoolLogo} size="lg" />
        <div className="rc-school">
          <b>{x(schoolName)}</b>
          <span>{x(`${t.acad.reportCard} · ${t.acad.term(s.term)} · ${s.year.name}`)}</span>
        </div>
      </header>
      {draft && <div className="rc-draft">{t.acad.status.DRAFT}</div>}
      <h1 className="rc-title">{t.acad.reportCard}</h1>

      <dl className="rc-facts">
        <div><dt>{t.common.name}</dt><dd>{x(studentName)}</dd></div>
        <div><dt>{t.acad.studentId}</dt><dd><bdi dir="ltr">{s.student.code}</bdi></dd></div>
        <div><dt>{t.acad.classLabel}</dt><dd>{x(s.class.name)}</dd></div>
        <div><dt>{t.acad.yearGroupLabel}</dt><dd>{x(s.class.gradeName)}</dd></div>
        <div><dt>{t.acad.yearLabel}</dt><dd>{x(s.year.name)}</dd></div>
        <div><dt>{t.acad.termLabel}</dt><dd>{t.acad.term(s.term)}</dd></div>
      </dl>

      <table className="rc-table">
        <thead>
          <tr><th>{t.acad.subjectCol}</th><th className="num">%</th><th className="num">{t.acad.gradeCol}</th><th>{t.acad.commentCol}</th></tr>
        </thead>
        <tbody>
          {s.subjects.map((sub) => (
            <tr key={sub.subjectId}>
              <td>
                <b>{x(sub.name)}</b>
                {sub.teacher && <div className="small muted">{x(titled(sub.teacher, lang))}</div>}
              </td>
              <td className="num">{percent(sub.percent)}</td>
              <td className="num">{x(band(sub.band))}</td>
              <td>{sub.comment ? x(sub.comment) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{t.acad.overallLine}{s.overall.gpa != null ? ` · ${t.acad.gpa(s.overall.gpa)}` : ''}</td>
            <td className="num">{percent(s.overall.percent)}</td>
            <td className="num">{x(band(s.overall.band))}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <p className="rc-line">{x(t.acad.attendance(a.days, a.absent))} · {x(t.acad.attendanceDetail(a.present, a.late, a.excused))}</p>

      <div className="rc-comments">
        <section className="rc-box">
          <h3>{t.acad.classTeacherComment}</h3>
          <p>{s.classTeacherComment ? x(s.classTeacherComment) : ''}</p>
          <div className="rc-sign">{s.classTeacher ? x(`${t.acad.classTeacher}: ${titled(s.classTeacher, lang)}`) : t.acad.classTeacher}</div>
        </section>
        <section className="rc-box">
          <h3>{t.acad.principalComment}</h3>
          <p>{s.principalComment ? x(s.principalComment) : ''}</p>
          <div className="rc-sign">{s.principalName ? x(`${t.acad.principal}: ${titled(s.principalName, lang)}`) : t.acad.principal} · {t.acad.signature}</div>
        </section>
      </div>
      <footer className="rc-foot">{x(t.acad.issued(day(s.issuedAt.slice(0, 10))))}</footer>
    </article>
  );
}
