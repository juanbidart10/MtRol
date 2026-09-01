import { performance } from "node:perf_hooks";

export const monotonicNow = () => performance.now();

export function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)];
}

export async function profileTasks(name, tasks, { concurrent = true } = {}) {
  const durations = [];
  const errors = [];
  const startedAt = monotonicNow();
  const run = async task => {
    const taskStartedAt = monotonicNow();
    try {
      return await task();
    } catch (error) {
      errors.push(error);
      throw error;
    } finally {
      durations.push(monotonicNow() - taskStartedAt);
    }
  };
  const settled = concurrent
    ? await Promise.allSettled(tasks.map(task => run(task)))
    : await (async () => {
      const results = [];
      for (const task of tasks) results.push(...await Promise.allSettled([run(task)]));
      return results;
    })();
  const totalMs = monotonicNow() - startedAt;
  return {
    name,
    count: tasks.length,
    totalMs,
    averageMs: durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: Math.max(0, ...durations),
    throughputPerSecond: totalMs > 0 ? (tasks.length * 1000) / totalMs : 0,
    errors: errors.length,
    settled
  };
}

export function metricView(metric, extra = {}) {
  const round = value => Number(Number(value ?? 0).toFixed(3));
  return {
    operation: metric.name,
    count: metric.count,
    totalMs: round(metric.totalMs),
    averageMs: round(metric.averageMs),
    p50Ms: round(metric.p50Ms),
    p95Ms: round(metric.p95Ms),
    p99Ms: round(metric.p99Ms),
    maxMs: round(metric.maxMs),
    throughputPerSecond: round(metric.throughputPerSecond),
    errors: metric.errors,
    ...extra
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function waitUntil(predicate, { attempts = 200 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return true;
    await new Promise(resolve => setImmediate(resolve));
  }
  return false;
}
