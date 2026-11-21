import { supabase, must } from './supabase';
import type {
  AppRole, AppUser, Availability, Conflict, Employee, Schedule, Shift, StaffingRequirement,
  Store, StoreHourException, StoreHours, TimeOff,
} from './types';
import { addDays, type SchedulerInput } from './scheduler';

export async function listStores(): Promise<Store[]> {
  return must(await supabase.from('stores').select('*').order('name'));
}

export interface StoreData {
  storeHours: StoreHours[];
  exceptions: StoreHourException[];
  requirements: StaffingRequirement[];
  employees: Employee[];
  availability: Availability[];
  timeOff: TimeOff[];
  conflicts: Conflict[];
}

/** Everything the scheduler needs for one store. */
export async function loadStoreData(storeId: string): Promise<StoreData> {
  const employees: Employee[] = must(
    await supabase.from('employees').select('*').eq('store_id', storeId).order('last_name'),
  );
  const ids = employees.map(e => e.id);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const [storeHours, exceptions, requirements, availability, timeOff, conflicts] = await Promise.all([
    supabase.from('store_hours').select('*').eq('store_id', storeId).order('day_of_week'),
    supabase.from('store_hour_exceptions').select('*').eq('store_id', storeId).order('date'),
    supabase.from('staffing_requirements').select('*').eq('store_id', storeId).order('day_of_week').order('start_time'),
    supabase.from('employee_availability').select('*').in('employee_id', ids.length ? ids : none),
    supabase.from('time_off').select('*').in('employee_id', ids.length ? ids : none).order('start_date'),
    supabase.from('employee_conflicts').select('*').in('employee_a', ids.length ? ids : none),
  ]);
  return {
    storeHours: must(storeHours), exceptions: must(exceptions), requirements: must(requirements),
    employees, availability: must(availability), timeOff: must(timeOff), conflicts: must(conflicts),
  };
}

export function toSchedulerInput(data: StoreData, weekStart: string): SchedulerInput {
  return { weekStart, ...data };
}

// ---- schedules & shifts -----------------------------------------------------
export async function getSchedule(storeId: string, weekStart: string): Promise<Schedule | null> {
  return must(await supabase.from('schedules').select('*')
    .eq('store_id', storeId).eq('week_start', weekStart).maybeSingle());
}

export async function ensureSchedule(storeId: string, weekStart: string): Promise<Schedule> {
  const existing = await getSchedule(storeId, weekStart);
  if (existing) return existing;
  return must(await supabase.from('schedules')
    .insert({ store_id: storeId, week_start: weekStart, status: 'draft' }).select().single());
}

export async function loadShifts(scheduleId: string): Promise<Shift[]> {
  return must(await supabase.from('shifts').select('*').eq('schedule_id', scheduleId)
    .order('shift_date').order('start_time'));
}

export async function replaceShifts(scheduleId: string, shifts: Shift[]) {
  must(await supabase.from('shifts').delete().eq('schedule_id', scheduleId));
  if (shifts.length) {
    must(await supabase.from('shifts').insert(shifts.map(s => ({
      schedule_id: scheduleId, employee_id: s.employee_id, shift_date: s.shift_date,
      start_time: s.start_time, end_time: s.end_time, role: s.role,
      break_minutes: s.break_minutes ?? 0, notes: s.notes ?? null,
    }))));
  }
  must(await supabase.from('schedules').update({ generated_at: new Date().toISOString() }).eq('id', scheduleId));
}

export async function saveShift(shift: Shift & { schedule_id: string }) {
  const row = {
    schedule_id: shift.schedule_id, employee_id: shift.employee_id, shift_date: shift.shift_date,
    start_time: shift.start_time, end_time: shift.end_time, role: shift.role,
    break_minutes: shift.break_minutes ?? 0, notes: shift.notes ?? null,
  };
  if (shift.id) must(await supabase.from('shifts').update(row).eq('id', shift.id));
  else must(await supabase.from('shifts').insert(row));
}

export async function deleteShift(id: string) {
  must(await supabase.from('shifts').delete().eq('id', id));
}

export async function setScheduleStatus(id: string, status: 'draft' | 'published') {
  must(await supabase.from('schedules').update({
    status, published_at: status === 'published' ? new Date().toISOString() : null,
  }).eq('id', id));
}

// ---- generic CRUD for the setup screens --------------------------------------
type Table =
  | 'employees' | 'employee_availability' | 'employee_conflicts' | 'time_off'
  | 'store_hours' | 'store_hour_exceptions' | 'staffing_requirements';

export async function upsertRow<T extends { id?: string }>(table: Table, row: T) {
  const { id, ...rest } = row;
  if (id) must(await supabase.from(table).update(rest).eq('id', id));
  else must(await supabase.from(table).insert(rest));
}

export async function deleteRow(table: Table, id: string) {
  must(await supabase.from(table).delete().eq('id', id));
}

export const weekDates = (weekStart: string) => [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekStart, i));

// ---- roles & users ---------------------------------------------------------------
/** The signed-in user's role, or null if they have no access. */
export async function getMyRole(): Promise<AppRole | null> {
  const role = must(await supabase.rpc('app_role')) as AppRole | null;
  return role ?? null;
}

export async function listAppUsers(): Promise<AppUser[]> {
  return must(await supabase.from('app_users').select('*').order('email'));
}

export async function setUserRole(userId: string, role: AppRole) {
  must(await supabase.from('app_users').update({ role }).eq('user_id', userId));
}

/** Removes app access. Their login still exists but sees nothing (delete it in Supabase if needed). */
export async function removeAppUser(userId: string) {
  must(await supabase.from('app_users').delete().eq('user_id', userId));
}

/** Sends an invite email via the invite-user Edge Function (admins only). */
export async function inviteUser(email: string, role: AppRole) {
  const { data, error } = await supabase.functions.invoke('invite-user', { body: { email, role } });
  if (error) {
    // Surface the function's own error message when there is one
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) msg = ((await ctx.json()) as { error?: string }).error ?? msg;
    } catch { /* keep generic message */ }
    throw new Error(msg);
  }
  return data as { ok: boolean; user_id: string };
}
