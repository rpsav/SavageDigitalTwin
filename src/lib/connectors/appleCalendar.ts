import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ICALBUDDY = '/opt/homebrew/bin/icalBuddy';
const EVENT_MARKER = '@@EVENT@@';

export interface CalendarResult {
  events: string[];
  error?: string;
}

/**
 * Reads Apple Calendar events between two YYYY-MM-DD dates (inclusive of start,
 * exclusive of end) via icalBuddy. Returns one text block per event.
 */
export async function getCalendarEvents(
  startDate: string,
  endDate: string
): Promise<CalendarResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      ICALBUDDY,
      [
        '-nc',
        '-npn',
        '-nrd',
        '-b',
        `${EVENT_MARKER} `,
        '-df',
        '%Y-%m-%d',
        '-tf',
        '%H:%M',
        '-iep',
        'title,datetime,location,notes',
        '-po',
        'title,datetime,location,notes',
        `eventsFrom:${startDate}`,
        `to:${endDate}`,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 }
    );

    // icalBuddy exits 0 even on permission failure, printing to stdout/stderr
    if (/no calendars|error:/i.test(stdout + stderr)) {
      return {
        events: [],
        error:
          'Calendar access not granted. Grant Calendar access to your terminal/Node in System Settings > Privacy & Security > Calendars, then retry.',
      };
    }

    const events = stdout
      .split(EVENT_MARKER)
      .map((e) => e.trim())
      .filter(Boolean);

    return { events };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT')) {
      return { events: [], error: 'icalBuddy is not installed.' };
    }
    return { events: [], error: `Could not read calendar: ${message}` };
  }
}
