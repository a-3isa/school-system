'use client';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { todayCairo } from '@/lib/api';
import { Roster } from '@/components/Roster';

function RosterRoute() {
  const { classId, periodId } = useParams<{ classId: string; periodId: string }>();
  const date = useSearchParams().get('date') ?? todayCairo();
  return <Roster classId={classId} periodId={periodId} date={date} />;
}

export default function RosterPage() {
  return (
    <Suspense>
      <RosterRoute />
    </Suspense>
  );
}
