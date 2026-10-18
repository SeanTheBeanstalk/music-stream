// Server-only request coalescing. Each subscriber can cancel independently;
// the upstream operation stops when its last subscriber leaves.
export function createRequestCache<T>(maximum = 100, ttl = 300_000) {
  const cache = new Map<string, { value: T; expires: number }>();
  const pending = new Map<
    string,
    { controller: AbortController; promise: Promise<T>; users: number }
  >();
  return async function get(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    signal.throwIfAborted();
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    cache.delete(key);
    let job = pending.get(key);
    if (!job) {
      const controller = new AbortController();
      const promise = Promise.resolve()
        .then(() => load(controller.signal))
        .then((value) => {
          if (!controller.signal.aborted) {
            if (cache.size >= maximum) cache.delete(cache.keys().next().value!);
            cache.set(key, { value, expires: Date.now() + ttl });
          }
          return value;
        })
        .finally(() => {
          if (pending.get(key)?.controller === controller) pending.delete(key);
        });
      job = { controller, promise, users: 0 };
      pending.set(key, job);
    }
    const shared = job;
    shared.users++;
    let cancel: () => void;
    return new Promise<T>((resolve, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
      shared.promise.then(resolve, reject);
      if (signal.aborted) cancel();
    }).finally(() => {
      signal.removeEventListener("abort", cancel);
      if (--shared.users === 0) {
        shared.controller.abort();
        if (pending.get(key) === shared) pending.delete(key);
      }
    });
  };
}
