/**
 * A small fixed-window limiter kept in memory. It slows down password guessing
 * and link-token guessing. One process is enough for this demo; with several
 * processes the counters would move to a shared store behind the same interface.
 */

export interface RateLimiter {
  /** Records one attempt and tells whether it is still within the limit. */
  hit(key: string): boolean;
  reset(key: string): void;
}

interface Window {
  startedAt: number;
  count: number;
}

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, Window>();

  const dropExpired = (): void => {
    const current = now();
    for (const [key, window] of windows) {
      if (current - window.startedAt >= options.windowMs) windows.delete(key);
    }
  };

  return {
    hit(key) {
      const current = now();
      const window = windows.get(key);
      if (!window || current - window.startedAt >= options.windowMs) {
        if (windows.size >= maxKeys) dropExpired();
        windows.set(key, { startedAt: current, count: 1 });
        return true;
      }
      window.count += 1;
      return window.count <= options.limit;
    },
    reset(key) {
      windows.delete(key);
    },
  };
}
