import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.decorators';
import { AudienceDto } from '../common/audience';
import { sniff } from '../students/files';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The child, if this parent may act for them: a missing or restricted link is "not found" (decision T4). */
export async function ownChild(prisma: PrismaService, parentId: string, studentId: string) {
  const link = await prisma.studentGuardian.findUnique({
    where: { studentId_userId: { studentId, userId: parentId } },
    include: { student: { include: { class: { select: { id: true, name: true } } } } },
  });
  if (!link || link.restricted) throw new NotFoundException('Child not found.');
  return link.student;
}

/** Classes a teacher teaches (the subjects the school assigned them) or leads as class teacher. */
export async function teacherClassIds(prisma: PrismaService, schoolId: string, teacherId: string): Promise<Set<string>> {
  const [lessons, homerooms] = await Promise.all([
    prisma.classSubject.findMany({ where: { teacherId, class: { schoolId } }, select: { classId: true }, distinct: ['classId'] }),
    prisma.class.findMany({ where: { schoolId, homeroomTeacherId: teacherId }, select: { id: true } }),
  ]);
  return new Set([...lessons.map((l) => l.classId), ...homerooms.map((c) => c.id)]);
}

/** A teacher may write only to their own classes; Student Affairs to anyone. */
export async function assertMayTarget(prisma: PrismaService, user: AuthUser, schoolId: string, audience: AudienceDto) {
  if (user.role !== Role.TEACHER) return;
  const own = await teacherClassIds(prisma, schoolId, user.id);
  const ok = audience.kind === 'CLASSES' && !!audience.ids?.length && audience.ids.every((id) => own.has(id));
  if (!ok) throw new ForbiddenException('Teachers can write to their own classes only.');
}

/** What an attachment really is (photo or PDF), judged by its bytes. */
export function checkAttachment(file: Express.Multer.File): string {
  const mime = sniff(file.buffer);
  if (!mime) throw new BadRequestException('Attach a photo (JPG, PNG or WebP) or a PDF.');
  return mime;
}

/** Sends a stored attachment the way the other files are sent. */
export function sendAttachment(res: Response, f: { mime: string; name?: string | null; data: Uint8Array | Buffer }) {
  res.setHeader('content-type', f.mime);
  res.setHeader('content-disposition', 'inline');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('cache-control', 'private, max-age=3600');
  res.send(Buffer.from(f.data));
}

/** First words of a text, for a notification or a list. */
export const excerpt = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A parent's or staff member's name as the other side reads it. */
export const titled = (u: { name: string; honorific?: string | null }) => {
  const h = { MR: 'Mr.', MS: 'Ms.', MRS: 'Mrs.', DR: 'Dr.' }[u.honorific ?? ''];
  return h ? `${h} ${u.name}` : u.name;
};

/** Someone a parent can write to or meet. */
export interface Contact {
  id: string;
  name: string;
  honorific: string | null;
  role: Role;
  subjects: string[];
  homeroom: boolean;
}

/** The teachers of a child's class (who the school assigned its subjects to) and its class teacher: the staff a parent may chat with or book (decision T3). */
export async function childTeachers(prisma: PrismaService, schoolId: string, classId: string | null): Promise<Contact[]> {
  if (!classId) return [];
  const [lessons, cls] = await Promise.all([
    prisma.classSubject.findMany({ where: { classId, class: { schoolId }, teacherId: { not: null } }, select: { teacherId: true, subject: { select: { name: true } } } }),
    prisma.class.findFirst({ where: { id: classId, schoolId }, select: { homeroomTeacherId: true } }),
  ]);
  const subjects = new Map<string, Set<string>>();
  for (const l of lessons) subjects.set(l.teacherId!, (subjects.get(l.teacherId!) ?? new Set()).add(l.subject.name));
  const homeroomId = cls?.homeroomTeacherId ?? null;
  const ids = [...new Set([...subjects.keys(), ...(homeroomId ? [homeroomId] : [])])];
  const teachers = await prisma.user.findMany({
    where: { id: { in: ids }, schoolId, active: true },
    select: { id: true, name: true, honorific: true, role: true },
    orderBy: { name: 'asc' },
  });
  return teachers.map((t) => ({ ...t, subjects: [...(subjects.get(t.id) ?? [])].sort(), homeroom: t.id === homeroomId }));
}
