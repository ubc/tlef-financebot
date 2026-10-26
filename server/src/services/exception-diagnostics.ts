/** Exception metadata without messages, SQL, payloads, URLs or absolute paths. */
export interface ExceptionDiagnostics {
  name: string;
  category: 'malformed-json' | 'payload-too-large' | 'invalid-path-encoding' | 'exception';
  code?: string;
  frames: string[];
}

export function exceptionDiagnostics(error: unknown): ExceptionDiagnostics {
  const data = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const name = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'URIError', 'MongoServerError', 'MongoNetworkError', 'MongoServerSelectionError'].includes(String(data.name)) ? String(data.name) : 'Error';
  const category = data.type === 'entity.parse.failed' ? 'malformed-json' : data.type === 'entity.too.large' ? 'payload-too-large' : name === 'URIError' ? 'invalid-path-encoding' : 'exception';
  const code = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN', 'ABORT_ERR'].includes(String(data.code)) ? String(data.code) : undefined;
  const frames = typeof data.stack === 'string' ? data.stack.slice(0, 16000).split('\n').slice(1, 20).flatMap(line => {
    // Only local project code locations, never the exception's first/message line.
    const match = line.match(/\b(server\/(?:src|dist)\/[\w./-]+\.(?:ts|js):\d+:\d+)\)?$/);
    return match && !match[1].includes('..') ? [match[1]] : [];
  }).slice(0, 6) : [];
  return { name, category, ...(code ? { code } : {}), frames };
}
