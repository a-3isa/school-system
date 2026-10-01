'use client';
import Link from 'next/link';
import { useState } from 'react';
import { download, upload } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Badge, Card, ErrorNote, Field, PageHead, toast } from '@/components/ui';

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
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const act = useAction();

  const check = () => file && act.run(async () => setReport(await upload<Report>('/students/import?preview=true', file)));
  const commit = async () => {
    if (!file) return;
    if (await act.run(async () => setReport(await upload<Report>('/students/import', file)))) toast('Import finished.');
  };

  return (
    <>
      <PageHead
        eyebrow="People"
        title="Import from Excel"
        sub="Add or update many students at once, with their parents and straps. Nothing is saved until every row is correct."
        actions={<button className="btn" type="button" onClick={() => act.run(() => download('/students/import/template', 'students-template.xlsx'))}>Download the template</button>}
      />
      <ErrorNote error={act.error} />
      <Card title="1. Choose the file">
        <Field label="Excel file (.xlsx)" id="file">
          <input id="file" className="input" type="file" accept=".xlsx" style={{ paddingTop: 7 }} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
        </Field>
        <div><button className="btn primary" type="button" disabled={!file || act.busy} onClick={check}>Check the file</button></div>
        <span className="muted small">Columns: Student code, First name, Last name, Arabic name, Class, Mother name, Mother email, Mother mobile, Father name, Father email, Father mobile, Strap. A parent needs a name, an email (they sign up in the app with it) and a mobile. A student code that already exists updates that student.</span>
      </Card>
      {report && (
        <Card title="2. Check and import" action={report.imported ? <Badge tone="ok">Imported</Badge> : report.errors.length ? <Badge tone="alert">{report.errors.length} to fix</Badge> : <Badge tone="ok">Ready</Badge>}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <Badge>{report.rows} rows</Badge>
            <Badge>{report.create} new students</Badge>
            <Badge>{report.update} updated</Badge>
            <Badge>{report.parents} parents</Badge>
            <Badge>{report.straps} straps</Badge>
          </div>
          {report.errors.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Row</th><th>What to fix</th></tr></thead>
                <tbody>{report.errors.map((e, i) => <tr key={i}><td className="num">{e.row}</td><td>{e.message}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {report.imported ? (
            <Link className="btn" href="/students">See students</Link>
          ) : (
            <div><button className="btn primary" type="button" disabled={!!report.errors.length || act.busy} onClick={commit}>Import {report.rows} rows</button></div>
          )}
        </Card>
      )}
    </>
  );
}
