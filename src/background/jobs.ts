import type { CaptureType } from '../shared/types';

export interface CaptureJob {
  id: string;
  mode: CaptureType;
  phase: 'selecting' | 'processing';
  startedAt: number;
}

const JOBS_KEY = 'captureJobs';
const JOB_MAX_AGE_MS = 5 * 60 * 1000;
type CaptureJobs = Record<string, CaptureJob>;
let pendingMutation: Promise<unknown> = Promise.resolve();

// Chrome storage has no compare-and-swap: serialize the entire read/modify/write.
function updateJobs<T>(update: (jobs: CaptureJobs) => T): Promise<T> {
  const operation = pendingMutation.then(async () => {
    const stored = await chrome.storage.session.get(JOBS_KEY);
    const jobs = Object.fromEntries(Object.entries((stored[JOBS_KEY] ?? {}) as CaptureJobs)
      .filter(([, job]) => job.id && Date.now() - job.startedAt < JOB_MAX_AGE_MS));
    const result = update(jobs);
    await chrome.storage.session.set({ [JOBS_KEY]: jobs });
    return result;
  });
  pendingMutation = operation.catch(() => undefined);
  return operation;
}

export function acquireJob(tabId: number, mode: CaptureType): Promise<CaptureJob> {
  return updateJobs((jobs) => {
    if (jobs[tabId]) throw new Error('A Screenboard capture is already active in this tab.');
    const job: CaptureJob = {
      id: crypto.randomUUID(), mode, startedAt: Date.now(),
      phase: mode === 'area' || mode === 'element' ? 'selecting' : 'processing',
    };
    jobs[tabId] = job;
    return job;
  });
}

export function claimSelection(tabId: number, id: string, mode: CaptureType): Promise<boolean> {
  return updateJobs((jobs) => {
    const job = jobs[tabId];
    if (!job || job.id !== id || job.mode !== mode || job.phase !== 'selecting') return false;
    job.phase = 'processing';
    return true;
  });
}

export function releaseJob(tabId: number, id: string): Promise<void> {
  return updateJobs((jobs) => {
    if (jobs[tabId]?.id === id) delete jobs[tabId];
  });
}

export function cancelSelection(tabId: number, id?: string): Promise<void> {
  return updateJobs((jobs) => {
    const job = jobs[tabId];
    if (job?.phase === 'selecting' && (id === undefined || id === job.id)) delete jobs[tabId];
  });
}

export function removeTabJobs(tabId: number): Promise<void> {
  return updateJobs((jobs) => { delete jobs[tabId]; });
}
