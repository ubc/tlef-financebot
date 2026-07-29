const CHANNEL_NAME = 'tlef-flags-changed';

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

/** Cross-tab invalidation only; the receiving tab always refetches server
 * truth with its own authenticated session. */
export function broadcastFlagsChanged(): void {
  getChannel()?.postMessage({ type: 'flags-changed' });
}

export function subscribeFlagsChanged(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  return () => listeners.delete(listener);
}
