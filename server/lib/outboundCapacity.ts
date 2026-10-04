let active = 0;
const waiters: Array<{
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];
export async function withOutboundSlot<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const limit = Number(process.env.OUTBOUND_CONCURRENCY || 8);
  if (!Number.isInteger(limit) || limit < 1 || limit > 64)
    throw new Error("Invalid outbound concurrency limit");
  if (active >= limit) {
    if (waiters.length >= 64) throw new Error("Outbound capacity unavailable");
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Outbound capacity deadline exceeded"));
        }, 3000),
      };
      waiters.push(waiter);
    });
  } else active++;
  try {
    return await operation();
  } finally {
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    } else active--;
  }
}
