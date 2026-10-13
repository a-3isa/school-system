import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '@/lib/i18n';
import { en } from '@/lib/strings';
import { SetupGuide } from './SetupGuide';

// What the school has so far, as the API counts it.
const EMPTY = { years: 0, grades: 0, classes: 0, subjects: 0, gradeSubjects: 0, periods: 0, rooms: 0, teachers: 0, classSubjects: 0, withoutTeacher: 0, lessons: 0, students: 0 };
let counts: typeof EMPTY | null = EMPTY;
vi.mock('@/lib/hooks', () => ({ useApi: () => ({ data: counts, error: null, loading: false, reload: async () => {}, setData: () => {} }) }));

const show = () => render(<LangProvider><SetupGuide /></LangProvider>);
const stepTitles = Object.values(en.guide.steps).map((s) => s.title);
const stepRow = (title: string) => screen.getByText(title).closest('li')!;
const done = `✓ ${en.guide.done}`;

describe('SetupGuide', () => {
  beforeEach(() => {
    counts = { ...EMPTY };
  });

  it('shows nothing until the counts arrive', () => {
    counts = null;
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  it('starts a new school at the first step, with a button that goes there', () => {
    show();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText(en.guide.sub(0, 8))).toBeInTheDocument();
    expect(within(stepRow(stepTitles[0])).getByRole('link', { name: en.guide.start })).toHaveAttribute('href', '/setup#classes');
    // Every later step offers “Open”, not “Start”.
    expect(screen.getAllByRole('link', { name: en.guide.start })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: en.guide.open })).toHaveLength(7);
  });

  it('marks the finished steps and moves “Start” to the next one', () => {
    counts = { ...EMPTY, grades: 3, classes: 6, years: 1 };
    show();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(within(stepRow(stepTitles[0])).getByText(done)).toBeInTheDocument();
    expect(within(stepRow(stepTitles[1])).getByText(done)).toBeInTheDocument();
    expect(within(stepRow(stepTitles[2])).getByRole('link', { name: en.guide.start })).toHaveAttribute('href', '/setup#subjects');
  });

  it('needs both halves of a step: grades without classes is not done', () => {
    counts = { ...EMPTY, grades: 3 };
    show();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('does not count the teachers step done while a class subject has no teacher', () => {
    counts = { ...EMPTY, classSubjects: 10, withoutTeacher: 2 };
    show();
    expect(within(stepRow(en.guide.steps.teachers.title)).queryByText(done)).toBeNull();
  });

  it('counts the teachers step done once every class subject has one', () => {
    counts = { ...EMPTY, classSubjects: 10, withoutTeacher: 0 };
    show();
    expect(within(stepRow(en.guide.steps.teachers.title)).getByText(done)).toBeInTheDocument();
  });

  it('goes away when every step is done', () => {
    counts = { years: 1, grades: 3, classes: 6, subjects: 8, gradeSubjects: 20, periods: 7, rooms: 5, teachers: 9, classSubjects: 30, withoutTeacher: 0, lessons: 120, students: 150 };
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });
});
