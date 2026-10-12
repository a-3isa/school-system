'use client';
import { useParams } from 'next/navigation';
import { StaffProfile } from '@/components/StaffProfile';

/** One member of staff: Student Affairs opens it from Faculty & staff. */
export default function StaffMemberPage() {
  const { id } = useParams<{ id: string }>();
  return <StaffProfile id={id} />;
}
