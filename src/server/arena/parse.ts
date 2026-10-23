export class DecisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionParseError';
  }
}

export interface ParsedDecision {
  move: string;
  reason: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Collect top-level JSON objects from prose, including fenced blocks. */
function collectBalancedObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          objects.push(text.slice(start, index + 1));
          start = -1;
        }
      }
    }
  }

  return objects;
}

function candidates(raw: string): string[] {
  const found = new Set<string>();
  const trimmed = raw.trim();
  if (trimmed) found.add(trimmed);

  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of raw.matchAll(fence)) {
    const body = match[1]?.trim();
    if (body) found.add(body);
  }

  for (const object of collectBalancedObjects(raw)) {
    found.add(object);
  }

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    found.add(raw.slice(first, last + 1));
  }

  return [...found];
}

function findMoveRecord(raw: string): Record<string, unknown> | null {
  for (const candidate of candidates(raw)) {
    const parsed = parseJson(candidate);
    if (parsed === undefined) continue;

    const direct = asRecord(parsed);
    if (direct && direct.move !== undefined) return direct;

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const record = asRecord(item);
        if (record && record.move !== undefined) return record;
      }
    }
  }

  // Last-resort extraction for a nearly-JSON answer with the right intent.
  const match = raw.match(/(?:"move"|move)\s*:\s*"([^"]+)"/i);
  if (match?.[1]) {
    const reasonMatch = raw.match(/(?:"reason"|reason)\s*:\s*"([^"]*)"/i);
    return { move: match[1], reason: reasonMatch?.[1] ?? '' };
  }

  return null;
}

function normalizeMoveString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFKC').trim();
  if (!text) return null;

  const strict = text.match(
    /^([a-i])\s*([0-9])\s*(?:[-–—−→>]\s*)?([a-i])\s*([0-9])$/i,
  );
  const loose = strict
    ? strict
    : text.match(/([a-i])\s*([0-9])\s*(?:[-–—−→>]\s*)?([a-i])\s*([0-9])/i);
  if (!loose) return null;
  return `${loose[1]}${loose[2]}${loose[3]}${loose[4]}`.toLowerCase();
}

function normalizeMove(value: unknown): string | null {
  const direct = normalizeMoveString(value);
  if (direct) return direct;

  const record = asRecord(value);
  if (!record) return null;
  const from = typeof record.from === 'string' ? record.from.trim() : '';
  const to = typeof record.to === 'string' ? record.to.trim() : '';
  if (!from || !to) return null;
  return normalizeMoveString(`${from}${to}`);
}

function sanitizeReason(value: unknown): string {
  if (typeof value !== 'string') return '未提供理由';
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return cleaned || '未提供理由';
}

/**
 * Extract a UCCI move from a model's free-form answer. The move is syntactically
 * normalized here; legality is checked separately against the engine.
 */
export function parseDecision(raw: string): ParsedDecision {
  const record = findMoveRecord(raw);
  if (!record) {
    throw new DecisionParseError('响应中没有找到包含 move 字段的 JSON 对象');
  }

  const move = normalizeMove(record.move);
  if (!move) {
    throw new DecisionParseError('move 字段不是有效的 UCCI 坐标（例如 h2e2）');
  }

  return {
    move,
    reason: sanitizeReason(record.reason),
  };
}
