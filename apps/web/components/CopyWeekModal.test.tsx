import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '@/lib/i18n';
import { en } from '@/lib/strings';
import { CopyWeekModal } from './CopyWeekModal';

const post = vi.fn();
vi.mock('@/lib/api', () => ({ post: (...a: unknown[]) => post(...a), api: vi.fn(), getToken: () => null, setToken: () => {} }));

const classes = [
  { id: 'c1', name: '4-A', gradeId: 'g4' },
  { id: 'c2', name: '4-B', gradeId: 'g4' },
  { id: 'c9', name: '5-A', gradeId: 'g5' },
];
const lab = { id: 'r-lab', kind: 'LAB', name: 'Science lab' };
const rooms = [lab];
// 4-A has one lesson, in a lab (so the copy needs no classroom of its own).
const lessons = [{ id: 'l1', class: { id: 'c1' }, room: lab }];

const open = (over: Record<string, unknown> = {}) =>
  render(
    <LangProvider>
      <CopyWeekModal open onClose={vi.fn()} from={classes[0]} classes={classes} rooms={rooms} everyLesson={lessons} lessons={lessons} onCopied={async () => {}} onOpenClass={vi.fn()} {...over} />
    </LangProvider>,
  );

const copyTo4B = async () => {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole('combobox'), 'c2');
  await user.click(screen.getByRole('button', { name: en.tt.copy }));
};

const skipped = (dayOfWeek: number, period: number, subject: string, reason: string, detail: string | null = null) => ({ dayOfWeek, period, subject, subjectAr: null, reason, detail });

describe('CopyWeekModal', () => {
  beforeEach(() => post.mockReset());

  it('offers only the other classes of the same year group', () => {
    open();
    const options = within(screen.getByRole('combobox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([en.tt.copyToPh, `4-B · ${en.tt.copyLessonsN(0)}`]);
  });

  it('says so when the year group has no other class', () => {
    open({ classes: [classes[0], classes[2]] });
    expect(screen.getByText(en.tt.noOtherClass)).toBeInTheDocument();
  });

  it('shows the periods that were already filled as one line, and lists only the clashes', async () => {
    post.mockResolvedValue({
      copied: 2,
      skipped: [
        skipped(0, 1, 'Math', 'FILLED'),
        skipped(0, 2, 'Art', 'FILLED'),
        skipped(1, 3, 'Science', 'ROOM_BUSY', 'Science lab'),
        skipped(2, 4, 'English', 'TEACHER_BUSY', 'Ms. Hana Nabil'),
      ],
      withoutTeacher: [],
    });
    open();
    await copyTo4B();

    expect(post).toHaveBeenCalledWith('/timetable/copy', { fromClassId: 'c1', toClassId: 'c2', replace: false });
    expect(await screen.findByText(en.tt.filledN(2))).toBeInTheDocument();
    const clashes = within(screen.getByText(en.tt.notCopied).parentElement!).getAllByRole('listitem');
    expect(clashes).toHaveLength(2);
    expect(clashes[0]).toHaveTextContent('Science');
    expect(clashes[0]).toHaveTextContent(en.tt.skip.ROOM_BUSY('Science lab'));
    expect(clashes[1]).toHaveTextContent(en.tt.skip.TEACHER_BUSY('Ms. Hana Nabil'));
    // The filled periods are not in the list.
    expect(screen.queryByText(/Math/)).toBeNull();
    expect(screen.queryByText(/Art/)).toBeNull();
  });

  it('lists no clashes and has no “not copied” heading when only filled periods were skipped', async () => {
    post.mockResolvedValue({ copied: 0, skipped: [skipped(0, 1, 'Math', 'FILLED')], withoutTeacher: [] });
    open();
    await copyTo4B();
    expect(await screen.findByText(en.tt.filledN(1))).toBeInTheDocument();
    expect(screen.queryByText(en.tt.notCopied)).toBeNull();
    expect(screen.getByText(en.tt.nothingCopied('4-B'))).toBeInTheDocument();
  });

  it('warns about subjects that came over without a teacher', async () => {
    post.mockResolvedValue({ copied: 3, skipped: [], withoutTeacher: [{ subject: 'Art', subjectAr: null }] });
    open();
    await copyTo4B();
    expect(await screen.findByText(en.tt.noTeacherIn('4-B'))).toBeInTheDocument();
  });
});
