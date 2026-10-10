import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { Client, login, ownerClient, startApp } from './helpers';

async function sheet(rows: (string | undefined)[][], header = ['Student code', 'First name', 'Last name', 'Arabic name', 'Class', 'Mother name', 'Mother email', 'Mother mobile', 'Father name', 'Father email', 'Father mobile', 'Strap']) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Excel import (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let admin: Client;
  const upload = async (file: Buffer, preview: boolean, expect = 201) =>
    admin.post(`/api/students/import${preview ? '?preview=true' : ''}`).attach('file', file, 'students.xlsx').expect(expect);

  beforeAll(async () => {
    app = await startApp();
    const owner = await ownerClient(app, prisma, 'imp');
    const school = await owner.post('/api/owner/schools', { name: 'Import School', plan: 'ESSENTIALS', admin: { name: 'A', email: 'admin@imp.eg', password: 'admin-pass' } }).expect(201);
    // The Strap column is part of the smart-bands subscription.
    await owner.patch(`/api/owner/schools/${school.body.id}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
    admin = await login(app, 'admin@imp.eg', 'admin-pass');
    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    await admin.post('/api/classes', { name: '4-A', gradeId: grade.id }).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('serves a template', async () => {
    const res = await admin.get('/api/students/import/template').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe('Student code');
  });

  it('previews and reports every problem without writing anything', async () => {
    const file = await sheet([
      ['1001', 'Layla', 'Hussein', 'ليلى', '4-A', 'Nadia', 'nadia@example.com', '01001234567', undefined, undefined, undefined, 'DC0D30AA4A11'],
      ['1001', 'Twin', 'Row', undefined, '9-Z', 'Mona', undefined, '+201001234500'],
      ['1002', undefined, 'Nobody'],
    ]);
    const res = await upload(file, true);
    expect(res.body.imported).toBe(false);
    const messages = res.body.errors.map((e: any) => `${e.row}: ${e.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      '2: Mother mobile “01001234567” needs the country code, like +201001234567.',
      '3: Student code 1001 appears twice in the sheet.',
      '3: There is no class called “9-Z”. Add it first or fix the name.',
      '3: Mother email is missing: parents sign up in the app with it.',
      '4: First name is missing.',
      '4: Each student needs at least one parent or guardian: fill the mother, father or guardian columns.',
    ]));
    // Not imported even without preview, because of the errors.
    expect((await upload(file, false)).body.imported).toBe(false);
    expect(await prisma.student.count({ where: { code: '1001' } })).toBe(0);
  });

  it('imports students, parents and straps, and updates on a second run', async () => {
    const file = await sheet([
      ['1001', 'Layla', 'Hussein', 'ليلى', '4-A', 'Nadia', 'Nadia@Example.com', '+201001234567', 'Ibrahim', 'ibrahim@example.com', '+201101234567', 'DC0D30AA4A11'],
      ['1002', 'Karim', 'Hussein', undefined, '4-a', 'Nadia', 'nadia@example.com', '+201001234567'],
    ]);
    const preview = await upload(file, true);
    expect(preview.body).toEqual(expect.objectContaining({ rows: 2, create: 2, update: 0, parents: 3, straps: 1, errors: [] }));
    expect((await upload(file, false)).body.imported).toBe(true);

    const list = (await admin.get('/api/students').expect(200)).body;
    const layla = list.find((s: any) => s.code === '1001');
    expect(layla.class.name).toBe('4-A');
    expect(layla.guardians).toHaveLength(2);
    const karim = list.find((s: any) => s.code === '1002');
    expect(karim.guardians[0].userId).toBe(layla.guardians.find((g: any) => g.relation === 'MOTHER').userId); // same mother account
    expect((await admin.get('/api/devices/straps')).body[0]).toEqual(expect.objectContaining({ mac: 'DC:0D:30:AA:4A:11', studentId: layla.id }));

    const again = await upload(await sheet([['1001', 'Layla', 'Hussein-Adel', undefined, '4-A']]), false);
    expect(again.body).toEqual(expect.objectContaining({ create: 0, update: 1, imported: true }));
    expect((await admin.get(`/api/students/${layla.id}`)).body.lastName).toBe('Hussein-Adel');
  });

  it('takes a guardian when a child has no mother or father at the school', async () => {
    const header = ['Student code', 'First name', 'Last name', 'Class', 'Guardian name', 'Guardian email', 'Guardian mobile'];
    const bad = await upload(await sheet([['1003', 'Ziad', 'Omar', '4-A', 'Samira', 'admin@imp.eg']], header), true);
    expect(bad.body.errors.map((e: any) => e.message)).toEqual(['Guardian email “admin@imp.eg” belongs to another account.']);
    const ok = await upload(await sheet([['1003', 'Ziad', 'Omar', '4-A', 'Samira Omar', 'samira@example.com', '+201201234567']], header), false);
    expect(ok.body).toEqual(expect.objectContaining({ create: 1, parents: 1, imported: true }));
    const ziad = (await admin.get('/api/students?q=Ziad').expect(200)).body[0];
    expect(ziad.guardians).toEqual([expect.objectContaining({ relation: 'GUARDIAN', user: expect.objectContaining({ name: 'Samira Omar' }) })]);
  });

  it('rejects files that aren’t spreadsheets or lack the columns', async () => {
    await upload(Buffer.from('hello'), true, 400);
    await upload(await sheet([['x']], ['Name']), true, 400);
  });
});
