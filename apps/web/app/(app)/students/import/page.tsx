'use client';
import Link from 'next/link';
import { useState } from 'react';
import { download, upload } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, PageHead, toast } from '@/components/ui';

interface Report {
  rows: number;
  create: number;
  update: number;
  parents: number;
  straps: number;
  errors: { row: number; message: string }[];
  imported: boolean;
}

export default function ImportPage() {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const act = useAction();

  const check = async () => {
    if (file && (await act.run(async () => setReport(await upload<Report>('/students/import?preview=true', file))))) setStep(3);
  };
  const commit = async () => {
    if (!file) return;
    if (await act.run(async () => setReport(await upload<Report>('/students/import', file)))) {
      toast(t.imp.doneToast);
      setStep(4);
    }
  };
  const badRows = report ? new Set(report.errors.map((e) => e.row)).size : 0;
  const steps = [t.imp.step1, t.imp.step2, t.imp.step3, t.imp.step4];

  return (
    <>
      <PageHead sub={t.imp.sub} title={t.nav.import} />
      <ol className="steps">
        {steps.map((l, i) => (
          <li key={l} className={i + 1 < step ? 'done' : undefined} aria-current={i + 1 === step ? 'step' : undefined}>
            {i + 1} · {l}
          </li>
        ))}
      </ol>
      <ErrorNote error={act.error} />
      <div className="step-body">
        {step === 1 && (
          <>
            <h3>{t.imp.s1Title}</h3>
            <p>{t.imp.s1Text}</p>
            <div className="row wrap">
              <button type="button" className="btn primary" disabled={act.busy} onClick={() => act.run(() => download('/students/import/template', 'students-template.xlsx'))}>{t.imp.s1Download}</button>
              <button type="button" className="btn" onClick={() => setStep(2)}>{t.imp.haveFile}</button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h3>{t.imp.s2Title}</h3>
            <p>{t.imp.s2Text}</p>
            <label className="drop">
              <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
              <b>{t.imp.s2Drop}</b>
              <span>{file ? file.name : '.xlsx'}</span>
            </label>
            <div className="row wrap">
              <button type="button" className="btn primary" disabled={!file || act.busy} onClick={check}>{act.busy ? t.common.oneMoment : t.imp.s2Check}</button>
              <button type="button" className="btn" onClick={() => setStep(1)}>{t.common.back}</button>
            </div>
          </>
        )}
        {step === 3 && report && (
          <>
            <h3>{report.errors.length ? t.imp.s3Fix(badRows) : t.imp.s3Ready}</h3>
            <p>{report.errors.length ? t.imp.s3FixText : t.imp.s3ReadyText(report.create, report.update, report.parents, report.straps)}</p>
            <div className="check-kpis">
              <span>{t.imp.kRows}<b>{report.rows}</b></span>
              <span>{t.imp.kReady}<b style={{ color: 'var(--p)' }}>{report.rows - badRows}</b></span>
              <span>{t.imp.kProblems}<b style={{ color: report.errors.length ? 'var(--a)' : undefined }}>{badRows}</b></span>
            </div>
            {report.errors.length > 0 && (
              <div className="problems">
                {report.errors.map((e, i) => <div key={i}><span>{t.imp.row(e.row)}</span><span>{e.message}</span></div>)}
              </div>
            )}
            <div className="row wrap">
              <button type="button" className="btn primary" disabled={!!report.errors.length || act.busy} onClick={commit}>{t.imp.importN(report.rows)}</button>
              <button type="button" className="btn" onClick={() => setStep(2)}>{t.imp.uploadFixed}</button>
            </div>
          </>
        )}
        {step === 4 && report && (
          <>
            <h3>{t.imp.s4Title(report.rows)}</h3>
            <p>{t.imp.s4Text}</p>
            <Link className="btn primary" href="/students">{t.imp.seeStudents}</Link>
          </>
        )}
      </div>
    </>
  );
}
