const browser = globalThis as any;

const state = ((globalThis as any)[Symbol.for('lumiana.perf')] ??= {
  constants: Object.create(null),
});

export function initializePerformance(snapshot: { constants: Record<string, number> }): void {
  for (const name of Object.keys(state.constants)) delete state.constants[name];
  Object.assign(state.constants, snapshot.constants);
}

export const performance: Performance = browser.performance;
export const Performance = browser.Performance;
export const PerformanceObserver = browser.PerformanceObserver;
export const PerformanceEntry = browser.PerformanceEntry;
export const PerformanceMark = browser.PerformanceMark;
export const PerformanceMeasure = browser.PerformanceMeasure;
export const PerformanceObserverEntryList = browser.PerformanceObserverEntryList;
export const PerformanceResourceTiming = browser.PerformanceResourceTiming;
export const constants = state.constants;

export function timerify<T extends Function>(fn: T): T {
  return function (this: any, ...args: any[]) {
    return Reflect.apply(fn, this, args);
  } as unknown as T;
}

export default {
  constants,
  performance,
  Performance,
  PerformanceEntry,
  PerformanceMark,
  PerformanceMeasure,
  PerformanceObserver,
  PerformanceObserverEntryList,
  PerformanceResourceTiming,
  timerify,
};
