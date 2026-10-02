'use client';
import { useState } from 'react';
import { dateTimeCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, PageHead, Tabs } from '@/components/ui';

type Filter = 'all' | 'attendance' | 'people' | 'setup';
/** Which tab each kind of change belongs to, by the first part of its action. */
const AREA: Record<string, Filter> = {
  attendance: 'attendance', exception: 'attendance',
  student: 'people', guardian: 'people', staff: 'people', parent: 'people',
};

export default function AuditPage() {
  const { t } = useI18n();
  const log = useApi<any[]>('/audit');
  const [filter, setFilter] = useState<Filter>('all');
  const area = (action: string) => AREA[action.split('.')[0]] ?? 'setup';
  const rows = (log.data ?? []).filter((a) => filter === 'all' || area(a.action) === filter);

  return (
    <>
      <PageHead sub={t.audit.sub} title={t.nav.audit} />
      <Tabs label={t.nav.audit} value={filter} onChange={setFilter} items={[['all', t.audit.all], ['attendance', t.audit.attendance], ['people', t.audit.people], ['setup', t.audit.setup]]} />
      <ErrorNote error={log.error} />
      <div className="panel scroll">
        {rows.length ? (
          <table style={{ minWidth: 640 }}>
            <thead><tr><th>{t.audit.when}</th><th>{t.audit.who}</th><th>{t.audit.what}</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="num muted" style={{ whiteSpace: 'nowrap' }}>{dateTimeCairo(a.createdAt)}</td>
                  <td className="strong" style={{ fontSize: 14 }}>{a.actorName ?? t.audit.system}</td>
                  <td style={{ fontSize: 14 }}>{t.audit.actions[a.action as keyof typeof t.audit.actions] ?? a.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{log.loading ? t.common.loading : t.audit.none}</Empty>
        )}
      </div>
    </>
  );
}
