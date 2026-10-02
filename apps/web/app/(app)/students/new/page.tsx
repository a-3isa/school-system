'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { StudentForm } from '@/components/StudentForm';
import { Note, PageHead, toast } from '@/components/ui';

export default function NewStudentPage() {
  const { me } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  return (
    <>
      <PageHead
        crumb={<><Link href="/students">{t.nav.students}</Link><span>/</span><b>{t.enrol.title}</b></>}
        title={t.enrol.title}
        sub={t.enrol.sub}
      />
      {me.role === 'SCHOOL_ADMIN' ? (
        <StudentForm
          onSaved={(s) => { toast(t.students.added(s.firstName)); router.push(`/students/${s.id}`); }}
          onCancel={() => router.push('/students')}
        />
      ) : (
        <Note>{t.enrol.adminOnly}</Note>
      )}
    </>
  );
}
