import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma, Role } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, SCHOOL_WIDE } from '../auth/auth.decorators';

/** The papers a school keeps for a student, as photos or scans. */
export const FILE_KINDS = ['PHOTO', 'BIRTH_CERTIFICATE', 'VACCINATION_RECORD', 'PARENT_ID', 'PREVIOUS_SCHOOL_REPORT', 'TRANSFER_LETTER', 'PASSPORT', 'OTHER'] as const;
/** A student can't be added without these. */
export const REQUIRED_FILES = ['PHOTO', 'BIRTH_CERTIFICATE'] as const;
const MAX_BYTES = 5 * 1024 * 1024;

/** What the file really is, from its first bytes (the name and the browser's word aren't trusted). */
export function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** Every staff member sees a student's photo; the nurse also the vaccination record; the rest is for the admin. */
export function canOpen(role: Role, kind: string) {
  return role === Role.SCHOOL_ADMIN || kind === 'PHOTO' || (role === Role.NURSE && kind === 'VACCINATION_RECORD');
}

export const fileSelect = { id: true, kind: true, mime: true, size: true, createdAt: true } satisfies Prisma.StudentFileSelect;

@Injectable()
export class StudentFilesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Checks and keeps an upload. Without a student it waits to be attached when the student is saved. */
  async upload(user: AuthUser, schoolId: string, kind: string, file: Express.Multer.File | undefined, studentId: string | null) {
    if (!file) throw new BadRequestException('Attach the photo or scan as “file”.');
    if (!(FILE_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Choose what this paper is.');
    const mime = sniff(file.buffer);
    if (!mime) throw new BadRequestException('Use a photo (JPG, PNG or WebP) or a PDF. Phone photos in HEIC can be saved as JPG first.');
    if (kind === 'PHOTO' && mime === 'application/pdf') throw new BadRequestException('The student’s photo must be an image, not a PDF.');
    if (studentId && !(await this.prisma.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true } }))) {
      throw new NotFoundException('Student not found.');
    }
    // Uploads never attached to a student are dropped after a day.
    await this.prisma.studentFile.deleteMany({ where: { schoolId, studentId: null, createdAt: { lt: new Date(Date.now() - 86400_000) } } });
    const saved = await this.prisma.studentFile.create({
      data: { schoolId, studentId, kind, mime, size: file.size, data: new Uint8Array(file.buffer), uploadedById: user.id },
      select: fileSelect,
    });
    if (studentId) await this.audit.log(user, 'student.file.add', 'student', studentId, { fileId: saved.id, kind });
    return saved;
  }

  /** The files a new student is saved with: uploaded here, not yet attached, and including the required ones. */
  async pending(schoolId: string, ids: string[]) {
    const files = await this.prisma.studentFile.findMany({ where: { id: { in: ids }, schoolId, studentId: null }, select: { id: true, kind: true } });
    if (files.length !== new Set(ids).size) throw new BadRequestException('Some photos weren’t uploaded. Add them again.');
    const missing = REQUIRED_FILES.filter((k) => !files.some((f) => f.kind === k));
    if (missing.length) throw new BadRequestException(`Add the ${missing.map((k) => (k === 'PHOTO' ? 'student’s photo' : 'birth certificate')).join(' and ')}.`);
    return files;
  }

  async read(schoolId: string, studentId: string, fileId: string, role: Role = Role.SCHOOL_ADMIN) {
    const f = await this.prisma.studentFile.findFirst({ where: { id: fileId, studentId, schoolId } });
    if (!f) throw new NotFoundException('File not found.');
    if (!canOpen(role, f.kind)) throw new ForbiddenException('Only the school admin can open this paper.');
    return f;
  }

  async remove(user: AuthUser, schoolId: string, studentId: string, fileId: string) {
    const f = await this.read(schoolId, studentId, fileId);
    if ((REQUIRED_FILES as readonly string[]).includes(f.kind) && (await this.prisma.studentFile.count({ where: { studentId, kind: f.kind } })) <= 1) {
      throw new BadRequestException('This paper is required. Upload a new one before removing this.');
    }
    await this.prisma.studentFile.delete({ where: { id: f.id } });
    await this.audit.log(user, 'student.file.remove', 'student', studentId, { fileId, kind: f.kind });
    return { ok: true };
  }
}

@Controller('students')
export class StudentFilesController {
  constructor(private readonly files: StudentFilesService) {}

  /** For a student being added: upload first, then send the ids with the student. */
  @Roles(Role.SCHOOL_ADMIN)
  @Post('files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  uploadNew(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @UploadedFile() file: Express.Multer.File | undefined, @Body('kind') kind: string) {
    return this.files.upload(user, schoolId, kind, file, null);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  upload(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body('kind') kind: string) {
    return this.files.upload(user, schoolId, kind, file, id);
  }

  @Roles(...SCHOOL_WIDE)
  @Get(':id/files/:fileId')
  async get(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('fileId') fileId: string, @Res() res: Response) {
    const f = await this.files.read(schoolId, id, fileId, user.role);
    res.setHeader('content-type', f.mime);
    res.setHeader('content-length', String(f.size));
    res.setHeader('content-disposition', 'inline');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(Buffer.from(f.data));
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id/files/:fileId')
  remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.files.remove(user, schoolId, id, fileId);
  }
}
