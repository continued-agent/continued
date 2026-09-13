import { ChildProcess, spawn } from "child_process";

import { logger } from "../util/logger.js";
import { killProcessTree } from "../util/processTree.js";
import { getWorkspaceDirectory } from "../util/workspace.js";

export type BackgroundJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface BackgroundJob {
  id: string;
  status: BackgroundJobStatus;
  command: string;
  output: string;
  exitCode: number | null;
  startTime: Date;
  endTime: Date | null;
  error?: string;
}

const MAX_CONCURRENT_JOBS = 5;
const MAX_OUTPUT_LINES = 1000;
// A single very long line can still consume a lot of memory, so cap retained
// output by size as well as by line count.
const MAX_OUTPUT_BYTES = 256 * 1024;
// Completed jobs are kept briefly so `CheckBackgroundJob` can still read their
// result, then pruned so a long-lived process does not accumulate them.
const MAX_COMPLETED_JOBS = 50;
const COMPLETED_JOB_TTL_MS = 30 * 60 * 1000;

/**
 * Service for managing background job execution and lifecycle
 * Handles spawning, tracking, and cleanup of background processes
 */
export class BackgroundJobService {
  private jobs: Map<string, BackgroundJob> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private jobCounter = 0;

  createJob(command: string): BackgroundJob | null {
    const runningCount = this.getRunningJobCount();
    if (runningCount >= MAX_CONCURRENT_JOBS) {
      logger.warn(
        `Cannot create background job: limit of ${MAX_CONCURRENT_JOBS} reached`,
      );
      return null;
    }

    this.pruneCompletedJobs();

    const id = `bg-${++this.jobCounter}-${Date.now()}`;
    const job: BackgroundJob = {
      id,
      status: "pending",
      command,
      output: "",
      exitCode: null,
      startTime: new Date(),
      endTime: null,
    };

    this.jobs.set(id, job);
    return job;
  }

  startJob(
    jobId: string,
    shell: string,
    args: string[],
    cwd: string = getWorkspaceDirectory(),
  ): ChildProcess | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error(`Cannot start job ${jobId}: job not found`);
      return null;
    }

    job.status = "running";

    // Spawn detached so the child leads its own process group and cancels can
    // terminate the entire descendant tree, not just the shell parent.
    const child = spawn(shell, args, {
      stdio: "pipe",
      cwd,
      detached: process.platform !== "win32",
    });
    this.processes.set(jobId, child);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (data: string) => {
      this.appendOutput(jobId, data);
    });

    child.stderr?.on("data", (data: string) => {
      this.appendOutput(jobId, data);
    });

    child.on("close", (code: number | null) => {
      this.completeJob(jobId, code ?? 0);
    });

    child.on("error", (error: Error) => {
      this.failJob(jobId, error.message);
    });

    return child;
  }

  createJobWithProcess(
    command: string,
    child: ChildProcess,
    existingOutput: string = "",
  ): BackgroundJob | null {
    const runningCount = this.getRunningJobCount();
    if (runningCount >= MAX_CONCURRENT_JOBS) {
      logger.warn(
        `Cannot create background job: limit of ${MAX_CONCURRENT_JOBS} reached`,
      );
      return null;
    }

    this.pruneCompletedJobs();

    const id = `bg-${++this.jobCounter}-${Date.now()}`;
    const job: BackgroundJob = {
      id,
      status: "running",
      command,
      output: existingOutput,
      exitCode: null,
      startTime: new Date(),
      endTime: null,
    };

    this.jobs.set(id, job);
    this.processes.set(id, child);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (data: string) => {
      this.appendOutput(id, data);
    });

    child.stderr?.on("data", (data: string) => {
      this.appendOutput(id, data);
    });

    child.on("close", (code: number | null) => {
      this.completeJob(id, code ?? 0);
    });

    child.on("error", (error: Error) => {
      this.failJob(id, error.message);
    });

    return job;
  }

  // todo: improve write efficiency with ring buffer or similar
  appendOutput(jobId: string, data: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.output += data;
      const lines = job.output.split("\n");
      if (lines.length > MAX_OUTPUT_LINES) {
        job.output = lines.slice(-MAX_OUTPUT_LINES).join("\n");
      }
      // A single oversized line must not bypass the line cap.
      if (Buffer.byteLength(job.output, "utf8") > MAX_OUTPUT_BYTES) {
        job.output = job.output.slice(-MAX_OUTPUT_BYTES);
      }
    }
  }

  completeJob(jobId: string, exitCode: number): void {
    const job = this.jobs.get(jobId);
    if (job) {
      if (job.status === "cancelled") {
        return;
      }
      job.status = exitCode === 0 ? "completed" : "failed";
      job.exitCode = exitCode;
      job.endTime = new Date();
      this.processes.delete(jobId);
      this.pruneCompletedJobs();
    }
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = error;
      job.endTime = new Date();
      this.processes.delete(jobId);
      this.pruneCompletedJobs();
    }
  }

  /**
   * Drop finished jobs that are older than the TTL, then enforce a hard cap on
   * retained history. `jobs` otherwise grows for the lifetime of the process.
   */
  private pruneCompletedJobs(): void {
    const now = Date.now();
    const isFinished = (job: BackgroundJob) =>
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled";

    for (const [id, job] of this.jobs) {
      if (
        isFinished(job) &&
        job.endTime !== null &&
        now - job.endTime.getTime() > COMPLETED_JOB_TTL_MS
      ) {
        this.jobs.delete(id);
      }
    }

    const finished = Array.from(this.jobs.values())
      .filter(isFinished)
      .sort((a, b) => {
        const aTime = a.endTime?.getTime() ?? 0;
        const bTime = b.endTime?.getTime() ?? 0;
        return aTime - bTime;
      });

    const excess = finished.length - MAX_COMPLETED_JOBS;
    for (let i = 0; i < excess; i++) {
      this.jobs.delete(finished[i].id);
    }
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    const process = this.processes.get(jobId);

    if (!job) return false;

    if (process) {
      killProcessTree(process);
      this.processes.delete(jobId);
    }

    job.status = "cancelled";
    job.endTime = new Date();
    return true;
  }

  getJob(jobId: string): BackgroundJob | undefined {
    return this.jobs.get(jobId);
  }

  getRunningJobs(): BackgroundJob[] {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === "running" || job.status === "pending",
    );
  }

  getAllJobs(): BackgroundJob[] {
    return Array.from(this.jobs.values());
  }

  getRunningJobCount(): number {
    return this.getRunningJobs().length;
  }

  /**
   * Whether a new job can be registered right now. Callers that would have to
   * detach their own listeners before registering (e.g. moving a foreground
   * command to the background) must check this first so they never leave a
   * process running with no tracking.
   */
  canAcceptJob(): boolean {
    return this.getRunningJobCount() < MAX_CONCURRENT_JOBS;
  }

  killAllJobs(): void {
    for (const [jobId, process] of this.processes) {
      killProcessTree(process);
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = "cancelled";
        job.endTime = new Date();
      }
    }
    this.processes.clear();
  }
}

export const backgroundJobService = new BackgroundJobService();
