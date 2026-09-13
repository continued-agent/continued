import { describe, expect, it } from "vitest";

import { BackgroundJobService } from "./BackgroundJobService.js";

describe("BackgroundJobService", () => {
  it("reports capacity until the concurrent job limit is reached", () => {
    const service = new BackgroundJobService();

    expect(service.canAcceptJob()).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(service.createJob(`echo ${i}`)).not.toBeNull();
    }
    expect(service.canAcceptJob()).toBe(false);
    expect(service.createJob("echo overflow")).toBeNull();
  });

  it("prunes completed jobs so history cannot grow unbounded", () => {
    const service = new BackgroundJobService();

    for (let i = 0; i < 60; i++) {
      const job = service.createJob(`echo ${i}`);
      expect(job).not.toBeNull();
      service.completeJob(job!.id, 0);
    }

    const finished = service
      .getAllJobs()
      .filter((job) => job.status === "completed" || job.status === "failed");
    expect(finished.length).toBeLessThanOrEqual(50);
  });

  it("caps retained output by size, not only line count", () => {
    const service = new BackgroundJobService();
    const job = service.createJob("cat bigfile");
    expect(job).not.toBeNull();

    // A single oversized line must not bypass the line-based cap.
    service.appendOutput(job!.id, "x".repeat(1024 * 1024));

    const stored = service.getJob(job!.id);
    expect(stored).toBeDefined();
    expect(Buffer.byteLength(stored!.output, "utf8")).toBeLessThanOrEqual(
      256 * 1024,
    );
  });
});
