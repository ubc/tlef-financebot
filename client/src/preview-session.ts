const STORAGE_KEY = 'financebot-anonymous-preview';

interface StoredPreview {
  courseId: string;
  previewSessionId: string;
}

let active: StoredPreview | undefined;

function newSessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readStored(): StoredPreview | undefined {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '') as Partial<StoredPreview>;
    return typeof parsed.courseId === 'string' && typeof parsed.previewSessionId === 'string'
      ? { courseId: parsed.courseId, previewSessionId: parsed.previewSessionId }
      : undefined;
  } catch {
    return undefined;
  }
}

function persist(value: StoredPreview | undefined): void {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing/storage policy can reject sessionStorage. The
    // in-memory value still keeps this page's Preview isolated and usable.
  }
}

export function startAnonymousPreview(courseId: string): string {
  active = { courseId, previewSessionId: newSessionId() };
  persist(active);
  return active.previewSessionId;
}

export function getAnonymousPreviewSession(courseId: string): string {
  const stored = active ?? readStored();
  if (stored?.courseId === courseId) {
    active = stored;
    return stored.previewSessionId;
  }
  return startAnonymousPreview(courseId);
}

export function endAnonymousPreview(): void {
  active = undefined;
  persist(undefined);
}
