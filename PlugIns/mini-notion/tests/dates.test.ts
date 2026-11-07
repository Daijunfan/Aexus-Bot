import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWeeks, moveScheduledRecord, parseDay, planProjection } from '../src/database/dates.ts';
import { makePage } from '../src/model.ts';
import { createWorkspace } from '../src/seed.ts';
import { executeWorkspaceCommand } from '../src/core/commands.ts';
import type { DatabaseView } from '../src/types.ts';

test('calendar ranges split across weeks, occupy non-overlapping slots and query by intersection', () => {
  const database = makePage({
    id: 'db',
    database: {
      view: 'calendar',
      columns: [
        { id: 'start', name: '开始', type: 'date' },
        { id: 'end', name: '结束', type: 'date' },
      ],
    },
  });
  const view: DatabaseView = {
    id: 'cal',
    name: '日历',
    type: 'calendar',
    dateAnchor: '2026-09-11',
    calendarBy: 'start',
    timelineEnd: 'end',
  };
  database.database!.views = [view];
  const a = makePage({
    id: 'a',
    parentId: 'db',
    title: '跨周任务',
    values: { start: '2026-09-10', end: '2026-09-15' },
  });
  const b = makePage({
    id: 'b',
    parentId: 'db',
    title: '重叠任务',
    values: { start: '2026-09-12', end: '2026-09-13' },
  });
  const weeks = calendarWeeks(database, view, [a, b]);
  assert.deepEqual(
    weeks[1].segments.map((segment) => [segment.id, segment.startColumn, segment.span, segment.slot]),
    [
      ['a', 3, 4, 0],
      ['b', 5, 2, 1],
    ],
  );
  assert.equal(weeks[1].segments[0].continuedAfter, true);
  assert.equal(weeks[2].segments[0].continuedBefore, true);
  assert.equal(weeks[2].segments[0].span, 2);
  const workspace = { ...createWorkspace(), pages: [database, a, b] };
  const rendered = executeWorkspaceCommand(workspace, 'view.render', {
    databaseId: 'db',
    viewId: 'cal',
    from: '2026-09-14',
    to: '2026-09-15',
  }).result;
  assert.equal(rendered.count, 1);
  assert.equal(rendered.records[0].id, 'a');
  assert.deepEqual(rendered.days.find((day: any) => day.date === '2026-09-14').records, ['a']);
});

test('crowded calendar preserves first-free lanes and complete hidden-day projection', () => {
  const db = makePage({
    id: 'dense-calendar',
    database: {
      view: 'calendar',
      columns: [
        { id: 'start', name: '开始', type: 'date' },
        { id: 'end', name: '结束', type: 'date' },
      ],
    },
  });
  const view: DatabaseView = {
    id: 'dense-view', name: '密集日历', type: 'calendar',
    calendarBy: 'start', timelineEnd: 'end', dateAnchor: '2026-10-15',
  };
  const rows = Array.from({ length: 1200 }, (_, index) => {
    const start = 12 + index % 7;
    const end = start + index % 4;
    return makePage({
      id: `dense-${index}`, parentId: db.id,
      values: { start: `2026-10-${start}`, end: `2026-10-${end}` },
    });
  });
  const week = calendarWeeks(db, view, rows).find(item => item.dates[0] === '2026-10-12')!;
  assert.equal(week.events.length, 1200);
  const occupied: boolean[][] = [];
  for (const event of week.events) {
    let slot = occupied.findIndex(row => row.slice(event.startColumn, event.startColumn + event.span).every(value => !value));
    if (slot === -1) {
      slot = occupied.length;
      occupied.push(Array(7).fill(false));
    }
    assert.equal(event.slot, slot, `first available slot for ${event.id}`);
    for (let day = event.startColumn; day < event.startColumn + event.span; day++) occupied[slot][day] = true;
  }
  assert.equal(week.totalSlotCount, occupied.length);
  for (const [column, date] of week.dates.entries())
    assert.deepEqual(week.hiddenByDate[date], week.events.filter(event =>
      event.slot >= 4 && event.startColumn <= column && column < event.startColumn + event.span,
    ).map(event => event.id));
});

test('plan projection reuses each range for all lanes without changing visible order or backlog', () => {
  const db = makePage({
    id: 'plan-db',
    database: {
      view: 'plan',
      columns: [
        { id: 'start', name: '开始', type: 'date' },
        { id: 'end', name: '结束', type: 'date' },
        { id: 'done', name: '完成', type: 'checkbox' },
      ],
    },
  });
  const view: DatabaseView = {
    id: 'plan', name: '周计划', type: 'plan', planMode: 'week',
    dateAnchor: '2026-10-15', calendarBy: 'start', timelineEnd: 'end', planDoneBy: 'done',
  };
  const records = [
    makePage({ id: 'span', parentId: db.id, values: { start: '2026-10-11', end: '2026-10-14', done: false } }),
    makePage({ id: 'single', parentId: db.id, values: { start: '2026-10-13', done: false } }),
    makePage({ id: 'overdue', parentId: db.id, values: { start: '2026-10-03', end: '2026-10-04', done: false } }),
    makePage({ id: 'undated', parentId: db.id, values: { start: '', done: false } }),
    makePage({ id: 'complete', parentId: db.id, values: { start: '2026-10-13', done: true } }),
  ];
  const now = new Date('2026-10-15T12:00:00');
  const projection = planProjection(db, view, records, now);
  assert.equal(projection.from, '2026-10-12');
  assert.deepEqual(projection.days.find(day => day.date === '2026-10-12')?.records, ['span']);
  assert.deepEqual(projection.days.find(day => day.date === '2026-10-13')?.records, ['span', 'single', 'complete']);
  assert.deepEqual(projection.days.find(day => day.date === '2026-10-14')?.records, ['span']);
  assert.deepEqual(projection.unscheduled, ['undated']);
  assert.deepEqual(projection.overdue, ['overdue']);
  assert.equal(projection.completed, 1);
  const hidden = planProjection(db, { ...view, planHideCompleted: true }, records, now);
  assert.deepEqual(hidden.days.find(day => day.date === '2026-10-13')?.records, ['span', 'single']);
  assert.equal(hidden.completed, 1);
});

test('dragging a range retains its duration, grabbed-day offset and stored time components', () => {
  const page = makePage({ values: { start: '2026-09-10T09:30', end: '2026-09-15T18:00', status: '进行中' } });
  const moved = moveScheduledRecord(page, 'start', 'end', '2026-09-20', '2026-09-12');
  assert.deepEqual(moved, { start: '2026-09-18T09:30', end: '2026-09-23T18:00', status: '进行中' });
  assert.equal(moveScheduledRecord(page, 'start', 'end', '').end, '');
  assert.equal(parseDay('2026-02-31'), null);
  assert.equal(parseDay('2026-13-01'), null);
  assert.ok(parseDay('2028-02-29'));
});

test('record scheduling and temporary date projections do not alter unrelated data or saved view anchors', () => {
  let workspace = { ...createWorkspace(), pages: [] as ReturnType<typeof makePage>[] };
  const call = (method: string, params: any = {}) => {
    const execution = executeWorkspaceCommand(workspace, method, params);
    workspace = execution.workspace!;
    return execution.result;
  };
  const db = call('database.create', {
    color: 'white',
    view: 'calendar',
    columns: [
      { id: 's', name: '开始', type: 'date' },
      { id: 'e', name: '结束', type: 'date' },
    ],
  });
  const view = db.database.views[0];
  call('view.update', {
    databaseId: db.id,
    viewId: view.id,
    changes: { calendarBy: 's', timelineEnd: 'e', dateAnchor: '2026-09-01' },
  });
  const row = call('record.create', {
    color: 'white',
    databaseId: db.id,
    values: { s: '2026-09-10', e: '2026-09-15' },
  });
  assert.equal(call('record.schedule', { pageId: row.id, date: '2026-09-18' }).values.e, '2026-09-23');
  const before = structuredClone(workspace);
  assert.throws(
    () => call('record.schedule', { pageId: row.id, date: '2026-09-18', end: '2026-09-17' }),
    /不能早于/,
  );
  assert.throws(
    () => call('record.schedule', { pageId: row.id, date: '2026-09-18', startProperty: 'missing' }),
    /日期属性/,
  );
  assert.deepEqual(workspace, before);
  const preview = call('view.render', { databaseId: db.id, viewId: view.id, date: '2026-10-01' });
  assert.equal(preview.period.from, '2026-09-28');
  assert.equal(call('view.list', { databaseId: db.id })[0].dateAnchor, '2026-09-01');
  assert.equal(call('record.schedule', { pageId: row.id, date: 'none' }).values.e, '');
});

test('single-property date ranges preserve local time across DST and expose both endpoints', async () => {
  const { makeDateValue, dateWall, dateEpoch, validateDateValue } =
    await import('../src/database/dateValue.ts');
  const { scheduledRange, resizeScheduledRecord } = await import('../src/database/dates.ts');
  const value = makeDateValue('2026-03-07T09:30', '2026-03-07T11:00', 'America/New_York');
  const page = makePage({ values: { date: value } });
  const moved = moveScheduledRecord(page, 'date', undefined, '2026-03-08');
  assert.equal(dateWall(moved.date), '2026-03-08T09:30');
  assert.equal(dateWall(moved.date, 'end'), '2026-03-08T11:00');
  assert.equal(dateEpoch(moved.date) - dateEpoch(value), 23 * 3600000);
  assert.deepEqual(scheduledRange({ ...page, values: moved }, 'date'), {
    start: '2026-03-08',
    end: '2026-03-08',
  });
  const resized = resizeScheduledRecord({ ...page, values: moved }, 'date', undefined, '2026-03-10');
  assert.equal(dateWall(resized.date, 'end'), '2026-03-10T11:00');
  assert.throws(() => validateDateValue({ start: '2026-02-31' }), /无效/);
  assert.throws(() => makeDateValue('2026-09-11T18:00', '2026-09-11T09:00', 'Asia/Shanghai'), /不能早于/);
  assert.throws(() => makeDateValue('2026-09-11T18:00', undefined, 'Not/A_Zone'), /无效/);
});

test('CLI scheduling accepts times and single-property ranges, preserves duration, and can make them all-day', async () => {
  const { dateWall } = await import('../src/database/dateValue.ts');
  let workspace = { ...createWorkspace(), pages: [] as ReturnType<typeof makePage>[] };
  const call = (method: string, params: any = {}) => {
    const execution = executeWorkspaceCommand(workspace, method, params);
    if (execution.changed) workspace = execution.workspace!;
    return execution.result;
  };
  const db = call('database.create', {
    color: 'white',
    view: 'calendar',
    columns: [{ id: 'date', name: '日期', type: 'date' }],
  });
  const row = call('record.create', { color: 'white', databaseId: db.id });
  const timed = call('record.schedule', {
    pageId: row.id,
    date: '2026-09-11T09:00',
    end: '2026-09-11T10:30',
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(dateWall(timed.values.date, 'end'), '2026-09-11T10:30');
  const moved = call('record.schedule', { pageId: row.id, date: '2026-09-12T14:00' });
  assert.equal(dateWall(moved.values.date, 'end'), '2026-09-12T15:30');
  const allDay = call('record.schedule', {
    pageId: row.id,
    date: '2026-09-14',
    end: '2026-09-18',
    allDay: true,
  });
  assert.deepEqual(allDay.values.date, { start: '2026-09-14', end: '2026-09-18' });
  const rendered = call('view.render', { databaseId: db.id, date: '2026-09-14' });
  assert.equal(rendered.schedule[0].start, '2026-09-14');
  assert.equal(rendered.schedule[0].end, '2026-09-18');
  assert.equal(rendered.days.filter((day: any) => day.records.includes(row.id)).length, 5);
  assert.equal(call('record.schedule', { pageId: row.id, date: 'none' }).values.date, '');
});

test('date ranges feed formulas, date filtering, grouping and chronological time-zone sorting', async () => {
  const { computeProperty } = await import('../src/database/propertiesModel.ts');
  const { makeDateValue } = await import('../src/database/dateValue.ts');
  const { queryRows, matchesRule, groupRows } = await import('../src/database/model.ts');
  const db = makePage({
    id: 'db',
    database: {
      view: 'table',
      columns: [
        { id: 'date', name: '日期', type: 'date' },
        {
          id: 'formula',
          name: '时长',
          type: 'formula',
          formula: 'dateBetween(dateEnd(prop("日期")), dateStart(prop("日期")), "minutes")',
        },
      ],
    },
  });
  const a = makePage({
    id: 'a',
    parentId: db.id,
    values: { date: makeDateValue('2026-09-11T09:00', '2026-09-11T11:00', 'Asia/Shanghai') },
  });
  const b = makePage({
    id: 'b',
    parentId: db.id,
    values: { date: makeDateValue('2026-09-11T02:00', undefined, 'UTC') },
  });
  const pages = [db, a, b];
  assert.deepEqual(computeProperty(a, db.database!.columns[1], pages), { ok: true, value: 120 });
  assert.equal(
    matchesRule(a, { id: 'f', property: 'date', operator: 'is', value: '2026-09-11' }, db.database!, pages),
    true,
  );
  assert.equal(
    groupRows([a, b], 'date', db.database!, pages).find((group) => group.key === '2026-09-11')?.rows.length,
    2,
  );
  assert.deepEqual(
    queryRows(
      db,
      { id: 'v', type: 'table', name: '排序', sorts: [{ id: 's', property: 'date', direction: 'asc' }] },
      pages,
    ).map((row) => row.id),
    ['a', 'b'],
  );
});
