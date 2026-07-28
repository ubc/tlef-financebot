const CHANNEL_NAME = 'tlef-notifications-changed';

type Listener = () => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof BroadcastChannel === 'undefined') {
    channel = null;
    return channel;
  }
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', () => {
    for (const listener of listeners) listener();
  });
  return channel;
}

/**
 * Sends only an invalidation signal. Notifications remain server-owned and
 * every receiving tab refetches them with its own authenticated session.
 */
export function broadcastNotificationsChanged(): void {
  getChannel()?.postMessage({ type: 'notifications-changed' });
}

export function subscribeNotificationsChanged(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  return () => listeners.delete(listener);
}
