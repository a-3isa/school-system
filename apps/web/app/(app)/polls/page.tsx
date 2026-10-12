'use client';
import { useState } from 'react';
import { cairoInstant, dateTimeCairo, post, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Audience, AudiencePicker } from '@/components/AudiencePicker';
import { Modal } from '@/components/Modal';
import { Empty, ErrorNote, Field, PageHead, Tag, toast } from '@/components/ui';
import { TimeInput } from '@/components/TimeInput';

const tomorrow = () => new Date(Date.now() + 86400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

export default function PollsPage() {
  const { me } = useSession();
  const { t, x } = useI18n();
  const canWrite = me.role === 'SCHOOL_ADMIN' || me.role === 'TEACHER';
  const polls = useApi<any[]>('/polls');
  const act = useAction();
  const [creating, setCreating] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const names = useApi<any>(who ? `/polls/${who}` : null);

  async function close(id: string) {
    if (await act.run(() => post(`/polls/${id}/close`))) {
      toast(t.poll.closedToast);
      await polls.reload();
    }
  }

  return (
    <>
      <PageHead sub={t.poll.sub} title={t.nav.polls} actions={canWrite ? <button type="button" className="btn primary" onClick={() => setCreating(true)}>{t.poll.new}</button> : undefined} />
      <ErrorNote error={(polls.error ?? act.error) && x((polls.error ?? act.error)!)} />
      <section className="panel">
        {polls.data?.length ? (
          polls.data.map((p) => (
            <article key={p.id} className="list-row" style={{ gap: 12, padding: '18px 20px' }}>
              <div className="row wrap" style={{ alignItems: 'flex-start' }}>
                <div className="stack grow" style={{ minWidth: 0 }}>
                  <span className="row wrap">
                    <Tag tone={p.open ? 'P' : 'E'}>{p.open ? t.poll.open : t.poll.closed}</Tag>
                    <strong style={{ fontSize: 16 }}>{x(p.question)}</strong>
                  </span>
                  <span className="small muted">
                    {t.audience.summary(p.audience.kind, p.audience.ids.length)} · {t.poll.voted(p.voters, p.targets)} · {p.open ? t.poll.closesOn(dateTimeCairo(p.closesAt)) : ''}
                  </span>
                </div>
                <div className="row wrap">
                  {!p.anonymous && me.role === 'SCHOOL_ADMIN' && <button type="button" className="btn small" aria-expanded={who === p.id} onClick={() => setWho(who === p.id ? null : p.id)}>{t.poll.who}</button>}
                  {p.open && canWrite && <button type="button" className="btn small" disabled={act.busy} onClick={() => void close(p.id)}>{t.poll.close}</button>}
                </div>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {p.options.map((o: any) => (
                  <div key={o.id} className="result-row">
                    <span>{x(o.label)}</span>
                    <span className="meter" aria-hidden="true"><span style={{ width: `${p.voters ? (o.votes / p.voters) * 100 : 0}%` }} /></span>
                    <span className="small num">{t.poll.votes(o.votes)}</span>
                  </div>
                ))}
              </div>
              {who === p.id && names.data?.byOption && (
                <div className="stack small" style={{ gap: 4 }}>
                  {p.options.map((o: any) => (
                    <span key={o.id}><b>{x(o.label)}:</b> {(names.data.byOption[o.id] ?? []).map(x).join(' · ') || '—'}</span>
                  ))}
                </div>
              )}
            </article>
          ))
        ) : polls.data ? (
          <Empty title={t.poll.none}>{t.poll.noneSub}</Empty>
        ) : (
          <Empty>{t.common.loading}</Empty>
        )}
      </section>
      {creating && <Creator teacher={me.role === 'TEACHER'} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); toast(t.poll.created); await polls.reload(); }} />}
    </>
  );
}

function Creator({ teacher, onClose, onCreated }: { teacher: boolean; onClose: () => void; onCreated: () => void | Promise<void> }) {
  const { t, x } = useI18n();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [showResults, setShowResults] = useState(true);
  const [day, setDay] = useState(tomorrow());
  const [time, setTime] = useState('14:00');
  const [audience, setAudience] = useState<Audience>({ kind: teacher ? 'CLASSES' : 'SCHOOL', ids: [] });
  const act = useAction();

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = question.trim() && filled.length >= 2 && day >= todayCairo() && (audience.kind === 'SCHOOL' || audience.ids.length > 0);

  async function create() {
    if (await act.run(() => post('/polls', {
      question: question.trim(), options: filled, multiple, anonymous, showResults,
      closesAt: cairoInstant(day, time).toISOString(), audience,
    }))) await onCreated();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t.poll.new}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button type="button" className="btn primary" disabled={act.busy || !ready} onClick={() => void create()}>{t.poll.create}</button>
        </>
      }
    >
      <div className="form" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <ErrorNote error={act.error && x(act.error)} />
        <Field label={t.poll.question} id="poll-q">
          <input id="poll-q" className="input" maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </Field>
        <div className="field">
          {t.poll.options}
          {options.map((o, i) => (
            <span key={i} className="row" style={{ gap: 8 }}>
              <input className="input grow" maxLength={80} aria-label={t.poll.option(i + 1)} placeholder={t.poll.option(i + 1)} value={o} onChange={(e) => setOptions(options.map((v, j) => (j === i ? e.target.value : v)))} />
              {options.length > 2 && <button type="button" className="icon-btn" aria-label={t.poll.removeOption} onClick={() => setOptions(options.filter((_, j) => j !== i))}>✕</button>}
            </span>
          ))}
          {options.length < 10 && <button type="button" className="link-btn small" style={{ justifySelf: 'start' }} onClick={() => setOptions([...options, ''])}>+ {t.poll.addOption}</button>}
        </div>
        <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />{t.poll.multiple}</label>
        <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />{t.poll.anonymous}</label>
        <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={showResults} onChange={(e) => setShowResults(e.target.checked)} />{t.poll.showResults}</label>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Field label={t.poll.closesAt} id="poll-day"><input id="poll-day" className="input" type="date" min={todayCairo()} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label={t.poll.closesTime} id="poll-time"><TimeInput id="poll-time" className="input num" value={time} onChange={(v) => setTime(v)} /></Field>
        </div>
        <div className="field">
          {t.audience.label}
          <AudiencePicker value={audience} onChange={setAudience} only={teacher ? ['CLASSES'] : undefined} />
        </div>
      </div>
    </Modal>
  );
}
