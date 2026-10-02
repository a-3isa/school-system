'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { StudentForm } from '@/components/StudentForm';
import { ErrorNote, Note, PageHead, toast } from '@/components/ui';

export default function EditStudentPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const student = useApi<any>(`/students/${id}`);
  if (!student.data) return <ErrorNote error={student.error} />;
  const s = student.data;
  const name = `${s.firstName} ${s.lastName}`;
  return (
    <>
      <PageHead
        crumb={<><Link href="/students">{t.nav.students}</Link><span>/</span><Link href={`/students/${id}`}>{name}</Link><span>/</span><b>{t.enrol.editTitle}</b></>}
        title={t.enrol.editTitle}
        sub={name}
      />
      {me.role === 'SCHOOL_ADMIN' ? (
        <StudentForm student={s} onSaved={() => { toast(t.enrol.saved); router.push(`/students/${id}`); }} onCancel={() => router.push(`/students/${id}`)} />
      ) : (
        <Note>{t.enrol.adminOnly}</Note>
      )}
    </>
  );
}
