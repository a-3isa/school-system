'use client';
import { StaffProfile } from '@/components/StaffProfile';
import { useSession } from '@/lib/session';

/** A teacher's own profile: what they teach and their week. */
export default function MyProfilePage() {
  const { me } = useSession();
  return <StaffProfile id={me.id} own />;
}
