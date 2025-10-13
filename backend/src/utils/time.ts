import { config } from "../config";

export function nowIso(): string {
  return new Date().toISOString();
}

export function addHours(isoString: string, hours: number): string {
  const base = new Date(isoString);
  base.setHours(base.getHours() + hours);
  return base.toISOString();
}

export function nowWithTimezone(): Date {
  const now = new Date();
  const tz = config.timezone;
  try {
    return new Date(now.toLocaleString("en-US", { timeZone: tz }));
  } catch (err) {
    return now;
  }
}

export function nowIsoWithTimezone(): string {
  return nowWithTimezone().toISOString();
}
