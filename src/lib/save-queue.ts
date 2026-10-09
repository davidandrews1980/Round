/**
 * Serialized "last write wins" saver. At most one `save` is in flight; while it
 * runs, newer values replace each other in a single pending slot (older
 * unsent values are superseded, never sent out of order). When the in-flight
 * save settles, the latest pending value is sent next. Every enqueue() promise
 * settles once its value — or a newer one that superseded it — has been saved.
 */
export function createSaveQueue<T>(save: (value: T) => Promise<unknown>) {
  let inFlight = false;
  let pending: { value: T; waiters: { resolve: () => void; reject: (e: unknown) => void }[] } | null = null;
  const idle: (() => void)[] = [];

  async function pump(first: { value: T; waiters: { resolve: () => void; reject: (e: unknown) => void }[] }) {
    inFlight = true;
    let job: typeof first | null = first;
    while (job) {
      const current = job;
      try {
        await save(current.value);
        current.waiters.forEach((w) => w.resolve());
      } catch (err) {
        current.waiters.forEach((w) => w.reject(err));
      }
      job = pending;
      pending = null;
    }
    inFlight = false;
    idle.splice(0).forEach((r) => r());
  }

  return {
    enqueue(value: T): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const waiter = { resolve, reject };
        if (inFlight) {
          // Supersede the previous pending value; its waiters ride along with this one.
          pending = { value, waiters: [...(pending?.waiters ?? []), waiter] };
        } else {
          void pump({ value, waiters: [waiter] });
        }
      });
    },
    /** Resolves when nothing is in flight or pending. */
    flush(): Promise<void> {
      return inFlight ? new Promise<void>((r) => idle.push(r)) : Promise.resolve();
    },
  };
}
