/**
 * Yield to the event loop between chunks of a long decode, without `setTimeout(0)`'s
 * ~4 ms minimum delay in browsers.
 *
 * Where `setImmediate` exists (Node, Bun) it is used: the same macrotask turn, with no
 * handle to manage. Elsewhere a `MessageChannel` message does it in ~0.1 ms. That channel
 * is held in {@link pendingChannels} until its message arrives, since nothing else
 * references it once `postMessage` returns and a port collected before delivery would
 * never resolve the yield. It is closed once it has fired: in Node every port left open
 * is an active handle, and the channel this used to leave behind on every yield kept any
 * Node process that called `decodeParquetBundle` on a legacy bundle from ever exiting.
 * `setTimeout` is the last resort.
 */
export function fastYield(): Promise<void> {
  const { setImmediate } = globalThis as { setImmediate?: (callback: () => void) => unknown };
  if (typeof setImmediate === 'function') {
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
  if (typeof MessageChannel !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    pendingChannels.add(channel);
    channel.port1.onmessage = () => {
      pendingChannels.delete(channel);
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Every channel {@link fastYield} has posted to and not yet heard back from. */
const pendingChannels = new Set<MessageChannel>();
