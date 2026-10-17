// Entity definitions: the single description of every stored record type.
// The same definitions validate form input, stored records and imported backups.
import { S } from './validate.js';
import { clock } from './clock.js';
import { diffDays, isYmd, todayStr } from './util.js';

const now = () => clock.now();
const createdAt = () => S.ts({ def: now });
const nid = (o = {}) => S.id({ req: true, ...o });

export const PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];

/* ---------- tasks ---------- */
const subtask = S.obj({
  id: nid(),
  title: S.str({ max: 300, req: true, def: 'Untitled step', label: 'Subtask title' }),
  done: S.bool(false),
});

const recurrence = S.obj({
  freq: S.enum(FREQS, 'daily'),
  interval: S.num({ min: 1, max: 365, int: true, def: 1 }),
  byWeekday: S.arr(S.num({ min: 0, max: 6, int: true }), { max: 7, unique: true }),
  endDate: S.ymd(),
  count: S.num({ min: 1, max: 1000, int: true, nullable: true }),
  anchor: S.ymd(),
}, { nullable: true });

export const taskEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    title: S.str({ max: 300, req: true, def: 'Untitled task', label: 'Title' }),
    description: S.str({ max: 20000, multiline: true, label: 'Description' }),
    priority: S.enum(PRIORITIES, 'medium'),
    status: S.enum(['todo', 'done'], 'todo'),
    archived: S.bool(false),
    categoryId: S.id({ nullable: true }),
    tagIds: S.arr(S.id(), { max: 50, unique: true }),
    startDate: S.ymd({ label: 'Start date' }),
    deadline: S.ymd({ label: 'Deadline' }),
    deadlineTime: S.hm({ label: 'Deadline time' }),
    scheduledDate: S.ymd({ label: 'Scheduled date' }),
    scheduledTime: S.hm({ label: 'Scheduled time' }),
    estimateMin: S.num({ min: 0, max: 100000, int: true, nullable: true, label: 'Estimated duration' }),
    actualMs: S.num({ min: 0, def: 0 }),
    focus: S.obj({
      enabled: S.bool(false),
      durationMin: S.num({ min: 1, max: 720, int: true, def: 25, label: 'Focus duration' }),
    }),
    subtasks: S.arr(subtask, { max: 200 }),
    recurrence,
    seriesId: S.id({ nullable: true }),
    occurrence: S.num({ min: 0, int: true, def: 0 }),
    projectId: S.id({ nullable: true }),
    columnId: S.id({ nullable: true }),
    subjectId: S.id({ nullable: true }),
    chapterId: S.id({ nullable: true }),
    order: S.num({ def: 0 }),
    completedAt: S.ts({ nullable: true }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  cross(v, ctx) {
    if (v.scheduledTime && !v.scheduledDate) ctx.errors.push({ path: 'scheduledTime', message: 'Pick a scheduled date for the time' });
    if (v.deadlineTime && !v.deadline) ctx.errors.push({ path: 'deadlineTime', message: 'Pick a deadline date for the time' });
    if (v.startDate && v.deadline && isYmd(v.startDate) && isYmd(v.deadline) && diffDays(v.startDate, v.deadline) < 0) {
      ctx.errors.push({ path: 'deadline', message: 'Deadline cannot be before the start date' });
    }
    if (v.recurrence && !(v.deadline || v.scheduledDate || v.startDate)) {
      ctx.errors.push({ path: 'recurrence', message: 'Recurring tasks need a start date, deadline or scheduled date' });
    }
    if (v.recurrence && v.recurrence.freq === 'weekly' && v.recurrence.byWeekday.length === 0) {
      // not an error: weekly with no weekday repeats on the anchor's weekday
    }
    if (v.status === 'done' && !v.completedAt) v.completedAt = now();
    if (v.status === 'todo') v.completedAt = null;
  },
};

export const taskHistoryEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    taskId: nid(),
    at: S.ts({ def: now }),
    type: S.enum(['created', 'edited', 'completed', 'reopened', 'deleted', 'restored', 'duplicated', 'archived', 'unarchived', 'focus-start', 'focus-end', 'focus-interrupted', 'moved', 'scheduled', 'recurred'], 'edited'),
    detail: S.str({ max: 1000, def: '' }),
    title: S.str({ max: 300, def: '' }),
  },
};

/* ---------- labels ---------- */
const labelFields = () => ({
  id: nid(),
  name: S.str({ max: 60, req: true, def: 'Untitled', label: 'Name' }),
  color: S.hex('#7c9cff'),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});
export const categoryEntity = { keyPath: 'id', fields: labelFields() };
export const tagEntity = { keyPath: 'id', fields: labelFields() };

/* ---------- timer sessions ---------- */
export const SESSION_KINDS = ['focus', 'countdown', 'stopwatch', 'pomodoro'];
export const sessionEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    kind: S.enum(SESSION_KINDS, 'countdown'),
    phase: S.enum(['work', 'short', 'long', 'free'], 'free'),
    status: S.enum(['running', 'paused', 'completed', 'interrupted', 'stopped'], 'completed'),
    taskId: S.id({ nullable: true }),
    subjectId: S.id({ nullable: true }),
    chapterId: S.id({ nullable: true }),
    label: S.str({ max: 200, def: '' }),
    plannedMs: S.num({ min: 0, def: 0 }),
    startedAt: S.ts({ def: now }),
    targetAt: S.ts({ nullable: true }),
    pausedAt: S.ts({ nullable: true }),
    remainingAtPause: S.num({ min: 0, nullable: true }),
    pausedTotalMs: S.num({ min: 0, def: 0 }),
    endedAt: S.ts({ nullable: true }),
    activeMs: S.num({ min: 0, def: 0 }),
    unobservedMs: S.num({ min: 0, def: 0 }),
    lastSeenAt: S.ts({ nullable: true }),
    locked: S.bool(false),
    interruptReason: S.str({ max: 500, def: '' }),
    recovered: S.bool(false),
    cycleIndex: S.num({ min: 0, int: true, def: 0 }),
    autoNext: S.bool(false),
    cfg: S.obj({
      workMin: S.num({ min: 1, max: 600, int: true, def: 25 }),
      shortMin: S.num({ min: 1, max: 120, int: true, def: 5 }),
      longMin: S.num({ min: 1, max: 240, int: true, def: 15 }),
      longEvery: S.num({ min: 2, max: 12, int: true, def: 4 }),
    }, { nullable: true }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
};

/* ---------- notes ---------- */
export const noteEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    title: S.str({ max: 300, def: '', label: 'Title' }),
    body: S.str({ max: 500000, multiline: true, trim: false, label: 'Note' }),
    categoryId: S.id({ nullable: true }),
    tagIds: S.arr(S.id(), { max: 50, unique: true }),
    pinned: S.bool(false),
    taskId: S.id({ nullable: true }),
    subjectId: S.id({ nullable: true }),
    projectId: S.id({ nullable: true }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
};

/* ---------- habits ---------- */
const habitSchedule = S.obj({
  type: S.enum(['daily', 'days', 'weekly'], 'daily'),
  days: S.arr(S.num({ min: 0, max: 6, int: true }), { max: 7, unique: true }),
  perWeek: S.num({ min: 1, max: 7, int: true, def: 3 }),
});

export const habitEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    name: S.str({ max: 100, req: true, def: 'Untitled habit', label: 'Name' }),
    description: S.str({ max: 1000, multiline: true }),
    color: S.hex('#34d399'),
    schedule: habitSchedule,
    // Every schedule change is appended, so history is evaluated with the schedule that applied at the time.
    scheduleHistory: S.arr(S.obj({ from: S.ymd({ nullable: false, def: '2000-01-01' }), schedule: habitSchedule }), { max: 200 }),
    startDate: S.ymd({ nullable: false, def: () => todayStr(now()) }),
    archived: S.bool(false),
    notes: S.str({ max: 20000, multiline: true }),
    reminderTime: S.hm(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  cross(v, ctx) {
    if (v.schedule.type === 'days' && v.schedule.days.length === 0) ctx.errors.push({ path: 'schedule.days', message: 'Choose at least one day' });
  },
};

export const habitLogEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    habitId: nid(),
    date: S.ymd({ nullable: false, req: true, def: '2000-01-01' }),
    note: S.str({ max: 2000, multiline: true }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
};

/* ---------- projects ---------- */
export const projectEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    name: S.str({ max: 120, req: true, def: 'Untitled project', label: 'Name' }),
    description: S.str({ max: 5000, multiline: true }),
    notes: S.str({ max: 100000, multiline: true, trim: false }),
    deadline: S.ymd({ label: 'Deadline' }),
    color: S.hex('#7c9cff'),
    status: S.enum(['active', 'archived'], 'active'),
    archivedAt: S.ts({ nullable: true }),
    columns: S.arr(S.obj({
      id: nid(),
      name: S.str({ max: 40, req: true, def: 'Column', label: 'Column name' }),
      done: S.bool(false),
    }), { max: 12 }),
    milestones: S.arr(S.obj({
      id: nid(),
      title: S.str({ max: 200, req: true, def: 'Milestone', label: 'Milestone' }),
      date: S.ymd(),
      done: S.bool(false),
    }), { max: 100 }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
};

/* ---------- study ---------- */
export const subjectEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    name: S.str({ max: 100, req: true, def: 'Untitled subject', label: 'Name' }),
    color: S.hex('#f59e0b'),
    examDate: S.ymd({ label: 'Exam date' }),
    examTime: S.hm(),
    archived: S.bool(false),
    chapters: S.arr(S.obj({
      id: nid(),
      title: S.str({ max: 200, req: true, def: 'Chapter', label: 'Chapter title' }),
      done: S.bool(false),
      completedAt: S.ts({ nullable: true }),
      plannedMin: S.num({ min: 0, max: 100000, int: true, def: 0 }),
      topics: S.arr(S.obj({
        id: nid(),
        title: S.str({ max: 200, req: true, def: 'Topic', label: 'Topic title' }),
        done: S.bool(false),
      }), { max: 100 }),
      revisions: S.arr(S.obj({
        id: nid(),
        date: S.ymd({ nullable: false, def: '2000-01-01' }),
        done: S.bool(false),
        doneAt: S.ts({ nullable: true }),
      }), { max: 50 }),
    }), { max: 300 }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
};

/* ---------- appearance / wallpapers ---------- */
const palette = S.obj({
  bg: S.hex('#0b1020'), bg2: S.hex('#1a1f3a'), glass: S.hex('#1b2340'),
  border: S.hex('#8da2ff'), primary: S.hex('#7c9cff'), accent: S.hex('#b794ff'),
});

export const themeEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    name: S.str({ max: 40, req: true, def: 'Custom theme', label: 'Theme name' }),
    light: palette,
    dark: palette,
    glass: S.json({ maxBytes: 2000 }),
    radius: S.num({ min: 0, max: 40, def: 14 }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
};

export const visualPresetEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    name: S.str({ max: 60, req: true, def: 'My preset', label: 'Preset name' }),
    config: S.json({ maxBytes: 60000 }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
};

export const assetEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    name: S.str({ max: 200, def: 'Wallpaper' }),
    type: S.enum(['image/png', 'image/jpeg', 'image/webp'], 'image/webp'),
    size: S.num({ min: 0, def: 0 }),
    width: S.num({ min: 0, int: true, def: 0 }),
    height: S.num({ min: 0, int: true, def: 0 }),
    blob: S.blob({ req: true }),
    thumb: S.blob(),
    stats: S.json({ maxBytes: 1000 }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
};

/* ---------- misc ---------- */
export const kvEntity = {
  keyPath: 'key',
  fields: {
    key: S.id({ req: true }),
    value: S.json({ maxBytes: 2_000_000 }),
    updatedAt: createdAt(),
  },
};

export const notificationEntity = {
  keyPath: 'id',
  fields: {
    id: nid(),
    at: S.ts({ def: now }),
    type: S.enum(['deadline', 'focus', 'habit', 'scheduled', 'system'], 'system'),
    title: S.str({ max: 200, def: '' }),
    body: S.str({ max: 1000, def: '' }),
    link: S.str({ max: 200, def: '' }),
    read: S.bool(false),
  },
};

export const backupEntity = {
  keyPath: 'id',
  skipLoadNormalize: true,
  fields: {
    id: nid(),
    at: S.ts({ def: now }),
    label: S.str({ max: 200, def: 'Backup' }),
    size: S.num({ min: 0, def: 0 }),
    data: S.str({ max: 60_000_000, trim: false, multiline: true }),
  },
};

export const quarantineEntity = {
  keyPath: 'id',
  skipLoadNormalize: true,
  fields: {
    id: nid(),
    store: S.str({ max: 40 }),
    at: S.ts({ def: now }),
    reason: S.str({ max: 1000 }),
    raw: S.str({ max: 2_000_000, trim: false, multiline: true }),
  },
};

export const ENTITIES = {
  tasks: taskEntity,
  taskHistory: taskHistoryEntity,
  categories: categoryEntity,
  tags: tagEntity,
  sessions: sessionEntity,
  notes: noteEntity,
  habits: habitEntity,
  habitLogs: habitLogEntity,
  projects: projectEntity,
  subjects: subjectEntity,
  themes: themeEntity,
  visualPresets: visualPresetEntity,
  assets: assetEntity,
  kv: kvEntity,
  notifications: notificationEntity,
  backups: backupEntity,
  quarantine: quarantineEntity,
};

export const ID_PREFIX = {
  tasks: 'task', taskHistory: 'hist', categories: 'cat', tags: 'tag', sessions: 'sess', notes: 'note',
  habits: 'habit', habitLogs: 'log', projects: 'proj', subjects: 'subj', themes: 'theme',
  visualPresets: 'vpre', assets: 'asset', notifications: 'notif', backups: 'bak', quarantine: 'quar',
};
