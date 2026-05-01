/**
 * parse_server_log — parses a Workday cloud runtime server log.
 *
 * The server log (server-{eventId}.log) is downloaded from the Workday
 * Integration Events UI. It is 10–15k lines of mixed framework boilerplate,
 * raw XML config dumps (including plaintext credentials), XSLT messages, HTTP
 * errors, and the actual integration trace. This tool strips the noise and
 * returns a focused summary.
 *
 * Output sections:
 *   summary   — integration name, tenant, status, duration, event id, memory
 *   errors    — deduplicated ERROR/WARN entries with per-type counts
 *   timeline  — key integration milestones with elapsed-ms markers
 *   xslt_messages — any cc:log / ssk:createMessage output emitted during the run
 */

import { z } from 'zod';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// ─── Log line parser ──────────────────────────────────────────────────────────
// Format: [dd-Mon-yyyy HH:mm:ss.SSS TZ] LEVEL  [thread] [corrId] [eventId] <class> message
//
// The thread field can contain "[REDACTED]" (with brackets) when the endpoint URL
// is redacted by Workday — this breaks strict bracket matching. We anchor on
// timestamp + level, then locate the 32-char eventId and <ClassName> independently.

const LINE_PREFIX_RE = /^\[(\d{2}-\w{3}-\d{4} \d{2}:\d{2}:\d{2}\.\d{3} \w+)\] (INFO|WARN|ERROR|DEBUG)\s+([\s\S]*)/;

function parseLine(line) {
  const prefix = line.match(LINE_PREFIX_RE);
  if (!prefix) return null;
  const [, timestamp, level, rest] = prefix;

  // Event ID: 32-char lowercase hex in brackets (always present in well-formed lines)
  const eventIdM = rest.match(/\[([a-f0-9]{32})\]/);
  const eventId  = eventIdM ? eventIdM[1] : null;

  // Class name: last <Foo.Bar.ClassName> before the message body
  const classM = rest.match(/<([^>]+)>\s([\s\S]*)$/);
  if (!classM) return null;

  return {
    timestamp,
    level,
    eventId,
    className: classM[1],
    message:   classM[2].trimEnd(),
  };
}

function parseMs(timestamp) {
  // "27-Apr-2026 19:26:04.293 PDT" → Date
  try { return new Date(timestamp.replace(/(\d+)-(\w+)-(\d+) /, '$2 $1 $3 ')).getTime(); }
  catch { return null; }
}

// ─── Noise filters ────────────────────────────────────────────────────────────

// Framework classes that produce only boilerplate — suppress from timeline/errors
const NOISY_CLASSES = new Set([
  'com.workday.authcommon.toggle.ToggleManager',
  'org.springframework.beans.factory.xml.XmlBeanDefinitionReader',
  'org.springframework.context.support.FileSystemXmlApplicationContext',
  'org.springframework.context.support.ClassPathXmlApplicationContext',
  'com.workday.security.common.util.KeystoreOperations',
  'com.workday.mediation.slave.runtime.DeployedCloudCollection',
]);

const NOISY_MESSAGE_PREFIXES = [
  'Toggle ',
  'Refreshing org.springframework',
  'Loading XML bean definitions',
  'Saxon version ',
  'JScape version ',
  'KeystoreType ',
  'Blobitory url was explicitly overriden',
  'On slave, returning integration ESB URL',
  'OMS XO Version set',
];

function isNoise(entry) {
  if (NOISY_CLASSES.has(entry.className)) return true;
  return NOISY_MESSAGE_PREFIXES.some(p => entry.message.startsWith(p));
}

// Detect lines that are raw XML dumps (long single-line XML from config fetches)
function isXmlDump(line) {
  return line.length > 500 && (line.includes('<?xml') || line.includes('<wd:') || line.includes('<ptdf:'));
}

// ─── Sensitive value redaction ────────────────────────────────────────────────
// The config XML dump contains plaintext credentials. We never surface the raw
// dump content — only its presence is noted.

const SENSITIVE_CLASSES = new Set([
  'com.capeclear.mediation.impl.mediators.BlobStepUtils',
]);

// ─── Error deduplication ──────────────────────────────────────────────────────
// Many errors repeat once per record (e.g. BadRequestException for each
// employee). Collapse them: keep first occurrence, count total.

function errorKey(entry) {
  // Strip UUIDs, WIDs, and request IDs to get a stable canonical key
  return entry.message
    .replace(/MSG_SENSITIVE:[a-f0-9-]+/g,        'MSG_SENSITIVE:<id>')
    .replace(/link:[a-f0-9-]+/g,                  'link:<id>')
    .replace(/esbHttpRequestId=[a-f0-9-]+/g,      'esbHttpRequestId=<id>')
    .replace(/cfRay=[a-f0-9]+-\w+/g,              'cfRay=<id>')
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g, '<uuid>')
    .replace(/first attempt \(UTC\): [^\s,]+/g,   'first attempt (UTC): <ts>')
    .replace(/first attempt \(PST\): [^\s,]+/g,   'first attempt (PST): <ts>')
    .replace(/\b\d{4}-\d{2}-\d{2}T[^\s,)]+/g,    '<datetime>');
}

// ─── Timeline milestones ──────────────────────────────────────────────────────

const TIMELINE_PATTERNS = [
  { re: /Starting deployment of /,             label: 'Deploy start' },
  { re: /Starting to deploy /,                 label: 'Collection deploy' },
  { re: /Starting all assemblies/,             label: 'Assemblies starting' },
  { re: /Starting processing of /,             label: 'Integration start' },
  { re: /Fetching clar file/,                  label: 'CLAR fetch start' },
  { re: /Successfully retrieved CLAR/,         label: 'CLAR fetched' },
  { re: /Completed processing of .+ in (\d+)ms/, label: 'Integration complete', captureMs: true },
  { re: /Integration Completed with Errors/,   label: 'Completed with errors' },
  { re: /Peak memory:/,                        label: 'Peak memory' },
];

// ─── XSLT / cc:log message extraction ────────────────────────────────────────
// Messages emitted by xsl:message (cc:log steps and SSK ssk:createMessage)
// appear as INFO lines from a Saxon-related class.

const XSLT_MESSAGE_CLASSES = [
  'net.sf.saxon',
  'com.workday.esb.saxonee',
  'XSLT',
];

function isXsltMessage(entry) {
  return XSLT_MESSAGE_CLASSES.some(c => entry.className.includes(c)) &&
    !entry.message.includes('stylesheet mode is not declared as streamable');
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseLog(content) {
  const lines = content.split('\n');
  const summary = { integration: null, tenant: null, status: null, duration_ms: null, event_id: null, peak_memory_mb: null };
  const errors   = new Map();  // key → { level, message, className, count, first_timestamp }
  const timeline = [];
  const xsltMessages = [];
  let startMs = null;
  let xmlDumpCount = 0;

  for (const rawLine of lines) {
    // Count XML dumps but never surface them (they contain credentials)
    if (isXmlDump(rawLine)) { xmlDumpCount++; continue; }

    const entry = parseLine(rawLine);
    if (!entry) continue;

    // Populate summary from key lines
    if (!summary.event_id && entry.eventId && entry.eventId.length === 32) {
      summary.event_id = entry.eventId;
    }

    const m_start = entry.message.match(/Starting processing of ([^/\s]+)/);
    if (m_start) {
      summary.integration = m_start[1];
      summary.tenant      = entry.className.split('.')[0] ?? null;
      startMs = parseMs(entry.timestamp);
    }

    const m_complete = entry.message.match(/Completed processing of .+ with status (\w+), tenant (\w+) in (\d+)ms/);
    if (m_complete) {
      summary.status      = m_complete[1];
      summary.tenant      = m_complete[2];
      summary.duration_ms = parseInt(m_complete[3], 10);
    }

    const m_memory = entry.message.match(/Peak memory: (\d+)/);
    if (m_memory) summary.peak_memory_mb = parseInt(m_memory[1], 10);

    // Timeline milestones
    for (const pat of TIMELINE_PATTERNS) {
      if (pat.re.test(entry.message)) {
        const elapsedMs = startMs ? (parseMs(entry.timestamp) - startMs) : null;
        const label = pat.captureMs
          ? `${pat.label} (${entry.message.match(pat.re)[1]}ms total)`
          : pat.label;
        timeline.push({ timestamp: entry.timestamp, label, elapsed_ms: elapsedMs });
        break;
      }
    }

    // Errors and warnings (deduplicated)
    if (entry.level === 'ERROR' || entry.level === 'WARN') {
      if (!isNoise(entry)) {
        const key = `${entry.level}|${entry.className}|${errorKey(entry)}`;
        if (errors.has(key)) {
          errors.get(key).count++;
        } else {
          errors.set(key, {
            level:           entry.level,
            className:       entry.className.split('.').pop(),  // short class name
            message:         entry.message.substring(0, 400),   // cap length
            count:           1,
            first_timestamp: entry.timestamp,
          });
        }
      }
    }

    // XSLT messages (cc:log output, ssk:createMessage, xsl:message)
    if (isXsltMessage(entry) && entry.level !== 'WARN') {
      xsltMessages.push({ timestamp: entry.timestamp, message: entry.message.substring(0, 300) });
    }
  }

  // Final tenant extraction from class name pattern (e.g. {tenant}.wcc_DEFAULT)
  if (!summary.tenant) {
    for (const [, v] of errors) {
      const tenantMatch = v.className.match(/^(\w+)\./);
      if (tenantMatch) { summary.tenant = tenantMatch[1]; break; }
    }
  }

  return {
    summary,
    timeline,
    errors: [...errors.values()].sort((a, b) => b.count - a.count),
    xslt_messages: xsltMessages,
    xml_dumps_suppressed: xmlDumpCount,
    total_lines: lines.length,
  };
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server) {
  server.tool(
    'parse_server_log',
    [
      'Parses a Workday server log (server-{eventId}.log) and returns a focused',
      'summary: integration status, duration, deduplicated errors/warnings,',
      'execution timeline, and any XSLT cc:log messages.',
      '',
      'The raw log is 10-15k lines of framework boilerplate and XML config dumps',
      '(which contain plaintext credentials and are never surfaced). This tool',
      'extracts the signal and suppresses the noise.',
      '',
      'If log_path is omitted, searches ~/Downloads for the most recently',
      'modified server-*.log file.',
    ].join('\n'),
    {
      log_path: z.string().optional().describe(
        'Absolute path to the server log file. If omitted, the most recent server-*.log in ~/Downloads is used.'
      ),
      show_warnings: z.boolean().optional().describe(
        'Include WARN entries in the errors section (default: true). Set false to show only ERRORs.'
      ),
    },
    async ({ log_path, show_warnings = true }) => {
      // ── Resolve file path ──────────────────────────────────────────────────
      let resolvedPath = log_path;

      if (!resolvedPath) {
        const downloadsDir = join(homedir(), 'Downloads');
        const files = await readdir(downloadsDir).catch(() => []);
        const logs = files.filter(f => f.startsWith('server-') && f.endsWith('.log'));
        if (logs.length === 0) {
          return errResponse('FILE_NOT_FOUND', 'No server-*.log files found in ~/Downloads.', 'Download the server log from the Workday Integration Events UI, then run this tool again.');
        }
        // Sort by name (eventId is a WID, not a timestamp, but the most recently
        // downloaded file is what the user wants — use fs stat instead)
        const statsWithName = await Promise.all(
          logs.map(async f => {
            const fp = join(downloadsDir, f);
            const { mtimeMs } = await import('fs').then(fs => fs.promises.stat(fp));
            return { name: f, mtimeMs, path: fp };
          })
        );
        statsWithName.sort((a, b) => b.mtimeMs - a.mtimeMs);
        resolvedPath = statsWithName[0].path;
      }

      resolvedPath = resolve(resolvedPath);
      if (!existsSync(resolvedPath)) {
        return errResponse('FILE_NOT_FOUND', `Log file not found: ${resolvedPath}`, 'Check the path and try again.');
      }

      // ── Read and parse ─────────────────────────────────────────────────────
      let content;
      try {
        content = await readFile(resolvedPath, 'utf8');
      } catch (e) {
        return errResponse('READ_FAILED', e.message, null);
      }

      const result = parseLog(content);

      // ── Filter warnings if requested ───────────────────────────────────────
      const filteredErrors = show_warnings
        ? result.errors
        : result.errors.filter(e => e.level === 'ERROR');

      // ── Format response ────────────────────────────────────────────────────
      const response = {
        log_file: resolvedPath.split('/').slice(-1)[0],
        total_lines: result.total_lines,
        xml_dumps_suppressed: result.xml_dumps_suppressed,

        summary: result.summary,

        timeline: result.timeline,

        errors: {
          total_unique: filteredErrors.length,
          note: filteredErrors.some(e => e.count > 1)
            ? 'Repeated errors are collapsed — count shows how many times each occurred.'
            : undefined,
          entries: filteredErrors,
        },

        xslt_messages: result.xslt_messages.length > 0
          ? { count: result.xslt_messages.length, entries: result.xslt_messages }
          : { count: 0 },

        note: result.xml_dumps_suppressed > 0
          ? `${result.xml_dumps_suppressed} raw XML config/payload lines were suppressed (they contain plaintext integration attribute values including credentials).`
          : undefined,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }
  );
}

function errResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
