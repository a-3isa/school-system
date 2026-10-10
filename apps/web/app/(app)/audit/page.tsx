'use client';
import { useState } from 'react';
import { dateTimeCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, PageHead, Tabs } from '@/components/ui';

type Filter = 'all' | 'attendance' | 'people' | 'setup';
/** Which tab each kind of change belongs to, by the first part of its action. */
const AREA: Record<string, Filter> = {
  attendance: 'attendance', exception: 'attendance', excuse: 'attendance',
  student: 'people', guardian: 'people', staff: 'people', parent: 'people',
};

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** A change's details as short readable text: "Note: Spoke with the mother · Type: LEFT_EARLY". Hides internal ids. */
function detailsText(data: unknown): string {
  if (data == null || typeof data !== 'object') return data == null ? '' : String(data);
  return Object.entries(data as Record<string, unknown>)
    .filter(([k, v]) => v != null && v !== '' && !/(^id$|Id$|Ids$)/.test(k))
    .map(([k, v]) => {
      const value = Array.isArray(v) ? `${v.length}` : typeof v === 'object' ? detailsText(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
      return `${words(k)}: ${value}`;
    })
    .join(' · ');
}

export default function AuditPage() {
  const { t, x } = useI18n();
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
            <thead><tr><th>{t.audit.when}</th><th>{t.audit.what}</th><th>{t.audit.details}</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="num muted" style={{ whiteSpace: 'nowrap' }}>{dateTimeCairo(a.createdAt)}</td>
                  <td className="strong" style={{ fontSize: 14 }}>{t.audit.actions[a.action as keyof typeof t.audit.actions] ?? a.action}</td>
                  <td className="small muted" style={{ maxWidth: 520, overflowWrap: 'anywhere' }}>{a.data ? x(detailsText(a.data)) : ''}</td>
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
