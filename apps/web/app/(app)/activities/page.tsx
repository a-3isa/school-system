'use client';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { has, useSession } from '@/lib/session';
import { Places } from '@/components/ClassPicker';
import { ClubDetail, useDaysLine } from '@/components/ClubDetail';
import { ClubModal } from '@/components/ClubModal';
import { Empty, ErrorNote, PageHead, Tag, toast } from '@/components/ui';

/** Clubs and after-school activities: the year's catalogue, and each club's members and register. */
export default function ClubsPage() {
  const { me } = useSession();
  const { t, x, staff, lang } = useI18n();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const paidOn = has(me, 'activities', 'paidActivities');
  const clubs = useApi<any[]>('/activities');
  const daysLine = useDaysLine();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const list = clubs.data ?? [];
  const current = openId ? list.find((c) => c.id === openId) : undefined;

  const modal = editing && (
    <ClubModal
      club={editing === 'new' ? null : editing}
      paidOn={paidOn}
      onClose={() => setEditing(null)}
      onSaved={async (saved) => {
        toast(editing === 'new' ? t.act.created : t.act.saved);
        setEditing(null);
        await clubs.reload();
        if (editing === 'new' && saved?.id) setOpenId(saved.id);
      }}
    />
  );

  if (current) {
    return (
      <>
        <ClubDetail
          club={current}
          paidOn={paidOn}
          isAdmin={isAdmin}
          onBack={() => setOpenId(null)}
          onEdit={() => setEditing(current)}
          onChanged={() => void clubs.reload()}
          onArchived={() => { setOpenId(null); void clubs.reload(); }}
        />
        {modal}
      </>
    );
  }

  return (
    <>
      <PageHead
        sub={t.act.clubsSub}
        title={t.nav.clubs}
        actions={isAdmin ? <button type="button" className="btn primary" onClick={() => setEditing('new')}>{t.act.newClub}</button> : undefined}
      />
      <ErrorNote error={clubs.error && x(clubs.error)} />
      <section className="panel">
        {list.length ? (
          list.map((c) => (
            <article key={c.id} className="list-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span className="stack" style={{ flex: '1 1 260px', gap: 3 }}>
                <button type="button" className="btn link" style={{ justifyContent: 'flex-start', fontWeight: 600, fontSize: 16, padding: 0, color: 'var(--ink)' }} onClick={() => setOpenId(c.id)}>
                  {x(lang === 'ar' && c.nameAr ? c.nameAr : c.name)}
                </button>
                <span className="small muted">
                  {daysLine(c.days)} · <bdi dir="ltr">{c.startTime}–{c.endTime}</bdi>
                  {c.supervisor ? ` · ${staff(c.supervisor)}` : ''}
                  {c.room ? ` · ${x(c.room.name)}` : ''}
                </span>
              </span>
              <span className="row wrap" style={{ gap: 12, flex: '0 1 auto' }}>
                <Places n={c.enrolled} capacity={c.capacity} />
                {c.waitlisted > 0 && <span className="small muted">{t.act.waitlistN(c.waitlisted)}</span>}
                {c.fee != null && <Tag>{t.act.feeEgp(c.fee)}</Tag>}
                {!c.signupOpen && <Tag tone="L">{t.act.signupClosed}</Tag>}
              </span>
            </article>
          ))
        ) : (
          <Empty title={clubs.loading ? undefined : t.act.noClubs}>{clubs.loading ? t.common.loading : t.act.noClubsSub}</Empty>
        )}
      </section>
      {modal}
    </>
  );
}
