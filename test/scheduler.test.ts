// Run: node --experimental-strip-types --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSchedule, validateShifts, toMin } from '../src/lib/scheduler.ts';

const data = JSON.parse(readFileSync(new URL('./fixtures/seed-week.json', import.meta.url), 'utf8'));
const WEEKS = ['2026-11-16', '2026-11-23', '2026-11-30'];

for (const weekStart of WEEKS) {
  test(`schedule for week of ${weekStart} respects hard rules`, () => {
    const input = { weekStart, ...data };
    const r = generateSchedule(input);
    const errors = r.issues.filter(i => i.severity === 'error');
    assert.deepEqual(errors, [], 'no hard-rule violations');
    // no availability violations from the generator either
    assert.equal(r.issues.filter(i => /availability|unavailable|time off/.test(i.message)).length, 0);
    const emp = new Map(data.employees.map((e: any) => [e.id, e]));
    for (const s of r.shifts) {
      const e: any = emp.get(s.employee_id);
      const len = (toMin(s.end_time) - toMin(s.start_time)) / 60;
      assert.ok(len >= e.min_shift_hours && len <= e.max_shift_hours, `shift length ok for ${e.first_name}`);
    }
    // 'never' pairs never overlap
    for (const c of data.conflicts.filter((c: any) => c.severity === 'never')) {
      for (const a of r.shifts.filter(s => s.employee_id === c.employee_a))
        for (const b of r.shifts.filter(s => s.employee_id === c.employee_b))
          if (a.shift_date === b.shift_date)
            assert.ok(toMin(a.end_time) <= toMin(b.start_time) || toMin(b.end_time) <= toMin(a.start_time));
    }
    console.log(weekStart, r.stats, 'gaps:', r.gaps.length, 'warnings:', r.issues.length);
  });
}

test('Thanksgiving is closed and Grace is off Mon–Wed of that week', () => {
  const r = generateSchedule({ weekStart: '2026-11-23', ...data });
  assert.equal(r.shifts.filter(s => s.shift_date === '2026-11-26').length, 0);
  const grace = data.employees.find((e: any) => e.first_name === 'Grace').id;
  assert.equal(r.shifts.filter(s => s.employee_id === grace && s.shift_date <= '2026-11-25').length, 0);
});

test('validator flags a hand-made never-conflict and time off', () => {
  const id = (n: string) => data.employees.find((e: any) => e.first_name === n).id;
  const shifts = [
    { employee_id: id('Owen'), shift_date: '2026-11-23', start_time: '09:00:00', end_time: '15:00:00', role: 'associate' },
    { employee_id: id('Ben'), shift_date: '2026-11-23', start_time: '12:00:00', end_time: '17:00:00', role: 'associate' },
    { employee_id: id('Grace'), shift_date: '2026-11-24', start_time: '09:00:00', end_time: '15:00:00', role: 'associate' },
  ];
  const issues = validateShifts({ weekStart: '2026-11-23', ...data }, shifts);
  assert.ok(issues.some(i => i.severity === 'error' && /must not work together/.test(i.message)));
  assert.ok(issues.some(i => i.severity === 'error' && /time off/.test(i.message)));
});

test('analyzeSchedule reports gaps for an empty week and none for a generated one', async () => {
  const { analyzeSchedule } = await import('../src/lib/scheduler.ts');
  const input = { weekStart: '2026-11-30', ...data };
  const empty = analyzeSchedule(input, []);
  assert.ok(empty.gaps.length > 0);
  assert.equal(empty.stats.coveragePct, 0);
  const gen = generateSchedule(input);
  const again = analyzeSchedule(input, gen.shifts);
  assert.equal(again.gaps.length, 0);
  assert.equal(again.stats.coveragePct, 100);
});
