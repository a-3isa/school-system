import { BadRequestException, Controller, Get, Injectable, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GuardianRelation, Role } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId } from '../auth/auth.decorators';
import { normaliseMac } from '../devices/rules';
import { StudentsService } from './students';

// Columns of the import sheet. Header names are matched ignoring case and spaces.
const COLUMNS = [
  { key: 'code', header: 'Student code', required: true },
  { key: 'firstName', header: 'First name', required: true },
  { key: 'lastName', header: 'Last name', required: true },
  { key: 'nameAr', header: 'Arabic name' },
  { key: 'class', header: 'Class' },
  { key: 'motherName', header: 'Mother name' },
  { key: 'motherEmail', header: 'Mother email' },
  { key: 'motherPhone', header: 'Mother mobile' },
  { key: 'fatherName', header: 'Father name' },
  { key: 'fatherEmail', header: 'Father email' },
  { key: 'fatherPhone', header: 'Father mobile' },
  // Another responsible adult, for a child without a mother or father at the school.
  { key: 'guardianName', header: 'Guardian name' },
  { key: 'guardianEmail', header: 'Guardian email' },
  { key: 'guardianPhone', header: 'Guardian mobile' },
  { key: 'strap', header: 'Strap' },
] as const;

type Row = Partial<Record<(typeof COLUMNS)[number]['key'], string>> & { line: number };

const PHONE = /^\+\d{8,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export interface ImportReport {
  rows: number;
  create: number;
  update: number;
  parents: number;
  straps: number;
  errors: { row: number; message: string }[];
  imported: boolean;
}

@Injectable()
export class StudentImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
    private readonly audit: AuditService,
  ) {}

  /** Does the school's subscription include straps? Only then does the sheet have a Strap column. */
  async hasStraps(schoolId: string): Promise<boolean> {
    const mod = await this.prisma.schoolModule.findUnique({ where: { schoolId_key: { schoolId, key: 'attendance' } } });
    return !!mod?.enabled && !!(mod.features as Record<string, boolean> | null)?.automatic;
  }

  async template(straps: boolean): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Students');
    ws.columns = COLUMNS.filter((c) => straps || c.key !== 'strap').map((c) => ({ header: c.header, key: c.key, width: 18 }));
    ws.getRow(1).font = { bold: true };
    ws.addRow({ code: '2026-0001', firstName: 'Layla', lastName: 'Hussein', nameAr: 'ليلى حسين', class: '4-A', motherName: 'Nadia Hussein', motherEmail: 'nadia.hussein@example.com', motherPhone: '+201001234567', fatherName: 'Ibrahim Hussein', fatherEmail: 'ibrahim.hussein@example.com', fatherPhone: '+201101234567', ...(straps ? { strap: 'DC:0D:30:AA:4A:11' } : {}) });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async read(buffer: Buffer): Promise<Row[]> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('That file isn’t an Excel workbook (.xlsx).');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The workbook has no sheets.');
    const header = (ws.getRow(1).values as unknown[]).map((v) => norm(String(v ?? '')));
    const index = new Map<string, number>();
    for (const c of COLUMNS) {
      const i = header.indexOf(norm(c.header));
      if (i >= 0) index.set(c.key, i);
      else if ('required' in c && c.required) throw new BadRequestException(`The first row needs a “${c.header}” column. Download the template to see the layout.`);
    }
    const rows: Row[] = [];
    ws.eachRow((r, line) => {
      if (line === 1) return;
      const values = r.values as unknown[];
      const row: Row = { line };
      for (const [key, i] of index) {
        const v = values[i];
        const text = v == null ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v);
        if (text.trim()) (row as Record<string, unknown>)[key] = text.trim();
      }
      if (Object.keys(row).length > 1) rows.push(row);
    });
    if (rows.length > 5000) throw new BadRequestException('Import at most 5,000 students at a time.');
    return rows;
  }

  /**
   * Checks every row, then — only if nothing is wrong and this isn't a
   * preview — creates or updates the students, their parents and straps.
   */
  async run(user: AuthUser, schoolId: string, buffer: Buffer, preview: boolean): Promise<ImportReport> {
    const rows = await this.read(buffer);
    const errors: ImportReport['errors'] = [];
    const strapsAllowed = await this.hasStraps(schoolId);
    const classes = new Map((await this.prisma.class.findMany({ where: { schoolId } })).map((c) => [c.name.toLowerCase(), c.id]));
    const existing = new Map((await this.prisma.student.findMany({ where: { schoolId }, include: { guardians: true, strap: true } })).map((s) => [s.code, s]));
    const straps = new Map((await this.prisma.strap.findMany({ where: { schoolId } })).map((s) => [s.mac, s]));
    // Emails already used by someone who isn't a parent at this school can't be linked.
    const emails = rows.flatMap((r) => [r.motherEmail, r.fatherEmail, r.guardianEmail]).filter((e): e is string => !!e).map((e) => e.trim().toLowerCase());
    const taken = new Set(
      (await this.prisma.user.findMany({ where: { email: { in: emails }, NOT: { role: Role.PARENT, schoolId } }, select: { email: true } })).map((u) => u.email),
    );
    const seenCodes = new Set<string>();
    const seenMacs = new Set<string>();

    for (const r of rows) {
      const err = (message: string) => errors.push({ row: r.line, message });
      for (const c of COLUMNS) if ('required' in c && c.required && !r[c.key]) err(`${c.header} is missing.`);
      if (r.code) {
        if (seenCodes.has(r.code)) err(`Student code ${r.code} appears twice in the sheet.`);
        seenCodes.add(r.code);
      }
      if (r.class && !classes.has(r.class.toLowerCase())) err(`There is no class called “${r.class}”. Add it first or fix the name.`);
      // A parent needs a name and an email (they sign up in the app with it); the mobile is optional.
      for (const [name, email, phone, who] of [[r.motherName, r.motherEmail, r.motherPhone, 'Mother'], [r.fatherName, r.fatherEmail, r.fatherPhone, 'Father'], [r.guardianName, r.guardianEmail, r.guardianPhone, 'Guardian']] as const) {
        if (!name && !email && !phone) continue;
        if (!name) err(`${who} name is missing.`);
        if (!email) err(`${who} email is missing: parents sign up in the app with it.`);
        else if (!EMAIL.test(email.trim())) err(`${who} email “${email}” isn’t a valid email address.`);
        else if (taken.has(email.trim().toLowerCase())) err(`${who} email “${email}” belongs to another account.`);
        if (phone && !PHONE.test(phone.replace(/\s/g, ''))) err(`${who} mobile “${phone}” needs the country code, like +201001234567.`);
      }
      // Every student has at least one parent or guardian.
      const before = r.code ? existing.get(r.code) : undefined;
      if (!before?.guardians.length && !(r.motherEmail || r.fatherEmail || r.guardianEmail)) {
        err('Each student needs at least one parent or guardian: fill the mother, father or guardian columns.');
      }
      if (r.strap && !strapsAllowed) {
        err('Smart bands aren’t part of this school’s subscription, so leave the Strap column empty.');
      } else if (r.strap) {
        const mac = normaliseMac(r.strap);
        if (!mac) err(`Strap “${r.strap}” isn’t a valid address.`);
        else {
          if (seenMacs.has(mac)) err(`Strap ${mac} appears twice in the sheet.`);
          seenMacs.add(mac);
          const owner = straps.get(mac)?.studentId;
          const me = r.code ? existing.get(r.code)?.id : undefined;
          if (owner && owner !== me) err(`Strap ${mac} already belongs to another student.`);
        }
      }
    }

    const report: ImportReport = {
      rows: rows.length,
      create: rows.filter((r) => r.code && !existing.has(r.code)).length,
      update: rows.filter((r) => r.code && existing.has(r.code)).length,
      parents: rows.reduce((n, r) => n + (r.motherEmail ? 1 : 0) + (r.fatherEmail ? 1 : 0) + (r.guardianEmail ? 1 : 0), 0),
      straps: rows.filter((r) => r.strap).length,
      errors,
      imported: false,
    };
    if (preview || errors.length) return report;

    for (const r of rows) {
      const classId = r.class ? classes.get(r.class.toLowerCase()) : undefined;
      const data = { firstName: r.firstName!, lastName: r.lastName!, nameAr: r.nameAr, classId };
      const before = existing.get(r.code!);
      const student = before
        ? await this.prisma.student.update({ where: { id: before.id }, data })
        : await this.prisma.student.create({ data: { ...data, code: r.code!, schoolId } });
      const has = new Set(before?.guardians.map((g) => g.relation) ?? []);
      for (const [relation, name, email, phone] of [
        [GuardianRelation.MOTHER, r.motherName, r.motherEmail, r.motherPhone],
        [GuardianRelation.FATHER, r.fatherName, r.fatherEmail, r.fatherPhone],
        [GuardianRelation.GUARDIAN, r.guardianName, r.guardianEmail, r.guardianPhone],
      ] as const) {
        if (name && email && !has.has(relation)) {
          await this.students.addGuardian(user, schoolId, student.id, { relation, name, email: email.trim(), phone: phone ? phone.replace(/\s/g, '') : undefined });
        }
      }
      if (r.strap) {
        const mac = normaliseMac(r.strap)!;
        if (before?.strap && before.strap.mac !== mac) await this.prisma.strap.update({ where: { id: before.strap.id }, data: { studentId: null } });
        await this.prisma.strap.upsert({
          where: { schoolId_mac: { schoolId, mac } },
          create: { schoolId, mac, studentId: student.id },
          update: { studentId: student.id },
        });
      }
    }
    await this.audit.log(user, 'student.import', 'student', undefined, { rows: report.rows, create: report.create, update: report.update });
    return { ...report, imported: true };
  }
}

@Roles(Role.SCHOOL_ADMIN)
@RequiresModule('core')
@Controller('students/import')
export class StudentImportController {
  constructor(private readonly importer: StudentImportService) {}

  @Get('template')
  async template(@SchoolId() schoolId: string, @Res() res: Response) {
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', 'attachment; filename="students-template.xlsx"');
    res.send(await this.importer.template(await this.importer.hasStraps(schoolId)));
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  run(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @UploadedFile() file: Express.Multer.File | undefined, @Query('preview') preview?: string) {
    if (!file) throw new BadRequestException('Attach the Excel file as “file”.');
    return this.importer.run(user, schoolId, file.buffer, preview === 'true');
  }
}
