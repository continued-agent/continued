import { beforeEach, describe, expect, it, vi } from "vitest";

const { throwIfFileIsSecurityConcern } = vi.hoisted(() => ({
  throwIfFileIsSecurityConcern: vi.fn(),
}));

vi.mock("core/indexing/ignore.js", () => ({
  throwIfFileIsSecurityConcern,
}));
vi.mock("../util/workspace.js", () => ({
  resolvePathInWorkspace: (filePath: string) => `/workspace/${filePath}`,
}));
vi.mock("../telemetry/telemetryService.js", () => ({
  telemetryService: {
    recordLinesOfCodeModified: vi.fn(),
  },
}));

import { writeFileTool } from "./writeFile.js";

describe("writeFileTool security checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks the resolved path before reading a preview", async () => {
    throwIfFileIsSecurityConcern.mockImplementation(() => {
      throw new Error("sensitive file");
    });

    await expect(
      writeFileTool.preprocess!({ filepath: ".env", content: "KEY=value" }),
    ).rejects.toThrow("sensitive file");

    expect(throwIfFileIsSecurityConcern).toHaveBeenCalledWith(
      "/workspace/.env",
    );
  });
});
