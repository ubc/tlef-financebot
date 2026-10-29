export type RequestTrigger = 'api-call' | 'notification-initial' | 'notification-timer' | 'notification-visible' | 'notification-focus' | 'notification-sync' | 'diagnostic-report';
const pageWords = new Set('admin instructor student ta preview restricted course courses operations requests runs materials structure generate review bank users questions settings people notifications canvas analytics assessments exam-builder flags help coverage-map'.split(' '));

/** No route IDs, query strings, form values or raw stack traces leave this helper. */
export function requestPageHint(): string {
  return '/' + location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).slice(0, 16)
    .map(part => pageWords.has(part) ? part : ':redacted').join('/');
}

export function nativeRequestSource(path: string, channel: 'embedded-preview' | 'source-link' | 'event-stream'): string {
  return `${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams({ _fbSource: channel, _fbPage: requestPageHint() })}`;
}

export function addRequestSource(headers: Headers, trigger: RequestTrigger = 'api-call'): void {
  headers.set('X-Financebot-Page', requestPageHint());
  headers.set('X-Financebot-Trigger', trigger);
  // Native Chrome/Firefox stacks provide static compiled call locations. Omit
  // when unavailable; never transmit the whole stack or arbitrary URL values.
  const frames = new Error().stack?.split('\n') ?? [];
  for (const frame of frames) {
    const match = /\/js\/((?:[a-z\d_-]+\/)*[a-z\d_-]+\.js:\d{1,6}:\d{1,6})/i.exec(frame);
    if (!match || /^(?:api|request-source|diagnostics)\.js:/.test(match[1])) continue;
    headers.set('X-Financebot-Callsite', match[1]);
    break;
  }
}
