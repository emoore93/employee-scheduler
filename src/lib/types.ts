// Row types mirroring supabase/migrations/*_schema.sql
// Times come back from Postgres as "HH:MM:SS"; dates as "YYYY-MM-DD".

export type Preference = 'available' | 'preferred' | 'unavailable';
export type TimeOffStatus = 'pending' | 'approved' | 'denied';
export type ConflictSeverity = 'never' | 'avoid';

export interface Store {
  id: string;
  name: string;
  timezone: string;
}

export interface StoreHours {
  id?: string;
  store_id: string;
  day_of_week: number; // 0 = Sunday
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

export interface StoreHourException {
  id?: string;
  store_id: string;
  date: string;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
  reason: string | null;
}

export interface StaffingRequirement {
  id?: string;
  store_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  min_staff: number;
  role: string | null;
}

export interface Employee {
  id: string;
  store_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  hourly_rate: number | null;
  min_hours_week: number;
  max_hours_week: number;
  min_shift_hours: number;
  max_shift_hours: number;
  max_days_week: number;
  is_minor: boolean;
  active: boolean;
  color: string | null;
  notes: string | null;
}

export interface Availability {
  id?: string;
  employee_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  preference: Preference;
  note?: string | null;
}

export interface TimeOff {
  id?: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  status: TimeOffStatus;
  reason: string | null;
}

export interface Conflict {
  id?: string;
  employee_a: string;
  employee_b: string;
  severity: ConflictSeverity;
  reason: string | null;
}

export interface Schedule {
  id: string;
  store_id: string;
  week_start: string;
  status: 'draft' | 'published';
  generated_at: string | null;
  published_at: string | null;
  notes: string | null;
}

export interface Shift {
  id?: string;
  schedule_id?: string;
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role: string | null;
  break_minutes?: number;
  notes?: string | null;
}
