'use client';
import { useApi } from '@/lib/hooks';
import { Card, Empty, ErrorNote, PageHead } from '@/components/ui';

export default function AuditPage() {
  const log = useApi<any[]>('/audit');
  return (
    <>
      <PageHead eyebrow="School setup" title="Audit log" sub="Every change, who made it and when. The latest 200 are shown." />
      <ErrorNote error={log.error} />
      <Card pad={false}>
        {log.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>What</th><th>Item</th><th>Details</th></tr></thead>
              <tbody>
                {log.data.map((a) => (
                  <tr key={a.id}>
                    <td className="num small">{new Date(a.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}</td>
                    <td>{a.action}</td>
                    <td className="small">{a.entity}</td>
                    <td className="small muted" style={{ maxWidth: 480, overflowWrap: 'anywhere' }}>{a.data ? JSON.stringify(a.data) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{log.loading ? 'Loading…' : 'Nothing recorded yet.'}</Empty>
        )}
      </Card>
    </>
  );
}
