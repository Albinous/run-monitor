export const METRICS = ['loss', 'lr', 'grad_norm'] as const;
export type Metric = (typeof METRICS)[number];

/** Raw data exactly as the "server" logged it: may be unsorted, duplicated, non-finite. */
export interface RawRun {
  step: Float64Array;
  loss: Float64Array;
  lr: Float64Array;
  grad_norm: Float64Array;
}

export type RunStatus = 'running' | 'finished' | 'failed';

export interface RunMeta {
  id: string;
  name: string;
  status: RunStatus;
  /** ISO-8601 in UTC. Never a locale-formatted string. */
  startedAt: string;
  points: number;
  lastStep: number | null;
  lastLoss: number | null;
  minLoss: number | null;
  defects: string[];
}

export type ScaleKind = 'linear' | 'log';
