import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Email {
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface MailResult {
  emails: Email[];
  error?: string;
}

const F = '@@F@@';
const R = '@@ROW@@';

/**
 * Reads recent Apple Mail inbox messages via AppleScript. Scans the most recent
 * `scan` messages and, if `query` is given, keeps those whose sender/subject match.
 */
export async function searchEmails(
  query: string,
  limit = 10,
  scan = 40
): Promise<MailResult> {
  const script = `
    tell application "Mail"
      set output to ""
      set n to ${scan}
      set msgCount to count of messages of inbox
      if msgCount < n then set n to msgCount
      repeat with i from 1 to n
        set m to message i of inbox
        set theSubject to subject of m
        set theSender to sender of m
        set theDate to (date received of m) as string
        set theContent to ""
        try
          set theContent to (content of m)
        end try
        if (length of theContent) > 200 then set theContent to (text 1 thru 200 of theContent)
        set output to output & theSender & "${F}" & theSubject & "${F}" & theDate & "${F}" & theContent & "${R}"
      end repeat
      return output
    end tell
  `;

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const q = query.trim().toLowerCase();
    const emails: Email[] = stdout
      .split(R)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => {
        const [from = '', subject = '', date = '', snippet = ''] = row.split(F);
        return {
          from: from.trim(),
          subject: subject.trim(),
          date: date.trim(),
          snippet: snippet.replace(/\s+/g, ' ').trim(),
        };
      })
      .filter((e) =>
        q ? (e.from + ' ' + e.subject + ' ' + e.snippet).toLowerCase().includes(q) : true
      )
      .slice(0, limit);

    return { emails };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('-1743') || message.toLowerCase().includes('not allowed')) {
      return {
        emails: [],
        error: 'Mail access not granted. Enable Automation access for Mail in System Settings > Privacy.',
      };
    }
    return { emails: [], error: `Could not read mail: ${message}` };
  }
}
