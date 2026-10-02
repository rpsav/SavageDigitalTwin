import { getCalendarEvents } from './connectors/appleCalendar';
import { searchEmails } from './connectors/appleMail';
import { createLogger, preview, since } from './log';

const log = createLogger('tools');

export interface Provenance {
  calendarEvents: number;
  emails: number;
}

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_calendar_events',
      description:
        "Read Richard's Apple Calendar events within a date range. Use for any question about his schedule, meetings, or availability.",
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Start date, YYYY-MM-DD (inclusive)' },
          end_date: { type: 'string', description: 'End date, YYYY-MM-DD (exclusive)' },
        },
        required: ['start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_emails',
      description:
        "Search Richard's recent Apple Mail inbox. Use for questions about emails, messages, or who has contacted him.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Text to match against sender/subject/body. Empty for most recent.',
          },
          limit: { type: 'number', description: 'Max emails to return (default 10)' },
        },
        required: ['query'],
      },
    },
  },
];

type ToolArgs = Record<string, unknown>;

export async function runTool(
  name: string,
  args: ToolArgs,
  provenance: Provenance
): Promise<string> {
  const started = Date.now();
  log.info(`running tool ${name} with args ${JSON.stringify(args)}`);

  if (name === 'get_calendar_events') {
    const start = String(args.start_date ?? '');
    const end = String(args.end_date ?? '');
    const { events, error } = await getCalendarEvents(start, end);
    if (error) {
      log.error(`${name} returned an error in ${since(started)}: ${error}`);
      return `Error: ${error}`;
    }
    provenance.calendarEvents += events.length;
    log.info(`${name} returned ${events.length} events in ${since(started)}`);
    if (events.length === 0) return 'No events found in that range.';
    return events.map((e, i) => `Event ${i + 1}:\n${e}`).join('\n\n');
  }

  if (name === 'search_emails') {
    const query = String(args.query ?? '');
    const limit = typeof args.limit === 'number' ? args.limit : 10;
    const { emails, error } = await searchEmails(query, limit);
    if (error) {
      log.error(`${name} returned an error in ${since(started)}: ${error}`);
      return `Error: ${error}`;
    }
    provenance.emails += emails.length;
    log.info(`${name} returned ${emails.length} emails in ${since(started)}`);
    emails.forEach((e, i) => log.debug(`  email ${i + 1}: "${preview(e.subject, 60)}"`));
    if (emails.length === 0) return 'No matching emails found.';
    return emails
      .map(
        (e, i) =>
          `Email ${i + 1}:\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nPreview: ${e.snippet}`
      )
      .join('\n\n');
  }

  log.warn(`unknown tool requested: ${name}`);
  return `Unknown tool: ${name}`;
}
