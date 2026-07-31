/**
 * A throttled queue for the backend's machine-translation jobs.
 *
 * The backend has no queue of its own: `POST /auto-translate` hands the work to
 * FastAPI's in-process `BackgroundTasks`, with a 180s DeepSeek timeout per call
 * and no concurrency cap. Firing a hundred of those at once would sit on the
 * API worker for the rest of the afternoon, so the throttle has to live here.
 *
 * A batch is a list of entities to translate plus a small-integer concurrency.
 * `translate_everything` starts the first slots; each `translate_everything_status`
 * poll drains the queue as slots free up. State is on disk so a poll still works
 * after the MCP server restarts.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ProjectId } from "../config/projects.js";

export type BatchItemStatus = "queued" | "running" | "done" | "failed";

export interface BatchItem {
  type: string;
  /** The API segment the auto-translate endpoints hang off. */
  entity: "posts" | "services" | "pages";
  id: number;
  label: string;
  status: BatchItemStatus;
  job_id?: number;
  progress?: string;
  error?: string;
  /** Per-language outcome, copied from the job status once it finishes. */
  languages?: Record<string, { status: string; error?: string | null }>;
}

export interface Batch {
  id: string;
  project: ProjectId;
  created_at: string;
  source_language_code: string;
  target_language_codes: string[];
  overwrite: boolean;
  concurrency: number;
  items: BatchItem[];
}

interface BatchFile {
  version: 1;
  batches: Batch[];
}

/** Keep the file from growing without bound across months of sweeps. */
const MAX_BATCHES = 25;

function statePath(): string {
  const dir = process.env.ICMCP_STATE_DIR ?? join(homedir(), ".ic-content-mcp");
  return join(dir, "translate-batches.json");
}

function readFile(): BatchFile {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as BatchFile;
    if (parsed.version === 1 && Array.isArray(parsed.batches)) return parsed;
  } catch {
    // No state yet, or it was corrupted by a half-written save — either way the
    // right move is to start clean rather than to fail the tool call.
  }
  return { version: 1, batches: [] };
}

function writeFileAtomic(file: BatchFile): void {
  const target = statePath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(file, null, 2), "utf8");
}

export function saveBatch(batch: Batch): void {
  const file = readFile();
  const others = file.batches.filter((candidate) => candidate.id !== batch.id);
  writeFileAtomic({ version: 1, batches: [batch, ...others].slice(0, MAX_BATCHES) });
}

export function getBatch(project: ProjectId, batchId?: string): Batch | undefined {
  const batches = readFile().batches.filter((batch) => batch.project === project);
  if (!batchId) return batches[0];
  return batches.find((batch) => batch.id === batchId);
}

export function listBatches(project: ProjectId): Batch[] {
  return readFile().batches.filter((batch) => batch.project === project);
}

let counter = 0;

export function newBatchId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function countByStatus(batch: Batch): Record<BatchItemStatus, number> {
  const counts: Record<BatchItemStatus, number> = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
  };
  for (const item of batch.items) counts[item.status] += 1;
  return counts;
}

export function isFinished(batch: Batch): boolean {
  return batch.items.every((item) => item.status === "done" || item.status === "failed");
}
