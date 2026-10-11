'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { LangSwitch, useI18n } from '@/lib/i18n';
import { ReportCardSheet } from '@/components/ReportCardSheet';
import { ErrorNote } from '@/components/ui';

/** One report card on an A4 page. The browser's Print turns it into a PDF in either language. */
export default function PrintReportCardPage() {
  const { id } = useParams<{ id: string }>();
  const { t, x } = useI18n();
  const card = useApi<any>(`/academics/report-cards/${id}`);

  return (
    <div className="rc-page" style={{ padding: '24px 16px' }}>
      <div className="rc-toolbar">
        <Link className="btn" href="/academics/report-cards">← {t.acad.back}</Link>
        <div className="row">
          <LangSwitch />
          <button type="button" className="btn primary" onClick={() => window.print()}>{t.acad.print}</button>
        </div>
      </div>
      <ErrorNote error={card.error && x(card.error)} />
      {card.data && <ReportCardSheet s={card.data.snapshot} draft={card.data.status === 'DRAFT'} />}
    </div>
  );
}
