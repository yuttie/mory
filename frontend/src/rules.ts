// Vuetify field rules, as the task editor and the status fields check their fields: each returns
// true for a value that passes, or the message to show.

import dayjs from 'dayjs';

export const required = (msg: string) => (v: unknown) => (v != null && String(v).trim().length > 0) || msg;

export const isDateTime = (msg: string) => (v: unknown) => dayjs(v as dayjs.ConfigType).isValid() || msg;

// A date or datetime that may be left empty.
export const optionalDateTime = (v: string) => v === '' || isDateTime('Invalid format.')(v);

export const range = (min: number, max: number, msg: string) => (v: unknown) =>
    (typeof v === 'number' && v >= min && v <= max) || msg;
