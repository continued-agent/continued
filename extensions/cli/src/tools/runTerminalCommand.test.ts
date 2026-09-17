import { vi } from "vitest";

vi.mock("../services/BackgroundJobService.js", () => ({
  backgroundJobService: {
    canAcceptJob: vi.fn(() => true),
    createJob: vi.fn(),
    createJobWithProcess: vi.fn(),
    startJob: vi.fn(),
  },
}));
vi.mock("../services/index.js", () => ({
  services: { chatHistory: { addToolResult: vi.fn() } },
}));
vi.mock("../telemetry/telemetryService.js", () => ({
  telemetryService: {
    recordCommitCreated: vi.fn(),
    recordPullRequestCreated: vi.fn(),
  },
}));
vi.mock("../util/cli.js", () => ({
  emitBashToolEnded: vi.fn(),
  emitBashToolStarted: vi.fn(),
}));

import { backgroundSignalManager } from "../util/backgroundSignalManager.js";
import { emitBashToolEnded } from "../util/cli.js";

import {
  isRunningInWsl,
  runTerminalCommandTool,
} from "./runTerminalCommand.js";

// These tests spawn a real shell (PowerShell on Windows). Shell startup is slow
// on loaded CI runners and can exceed the default 30s test timeout.
const SHELL_TEST_TIMEOUT_MS = 60_000;

describe("runTerminalCommandTool", () => {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";

  describe("argument validation", () => {
    it("rejects malformed timeout values before starting a process", async () => {
      await expect(
        runTerminalCommandTool.preprocess!({
          command: "echo hello",
          timeout: "soon",
        } as any),
      ).rejects.toThrow("timeout must be a finite, non-negative number");

      await expect(
        runTerminalCommandTool.preprocess!({
          command: "echo hello",
          timeout: -1,
        }),
      ).rejects.toThrow("timeout must be a finite, non-negative number");
    });
  });

  describe("basic platform-specific terminal execution", () => {
    it(
      "should execute a simple echo command",
      async () => {
        let command: string;
        let expectedOutput: string;

        if (isWindows) {
          command = 'Write-Output "hello world"';
          expectedOutput = "hello world";
        } else {
          command = 'echo "hello world"';
          expectedOutput = "hello world";
        }

        const result = await runTerminalCommandTool.run({ command });
        expect(result.trim()).toBe(expectedOutput);
      },
      SHELL_TEST_TIMEOUT_MS,
    );

    it(
      "should get current directory",
      async () => {
        let command: string;

        if (isWindows) {
          command = "Get-Location | Select-Object -ExpandProperty Path";
        } else {
          command = "pwd";
        }

        const result = await runTerminalCommandTool.run({ command });

        if (isWindows) {
          // Windows paths like C:\path\to\dir
          expect(result.trim()).toMatch(/^[A-Za-z]:\\.*/);
        } else {
          // Unix paths like /path/to/dir
          expect(result.trim()).toMatch(/^\/.*$/);
        }
      },
      SHELL_TEST_TIMEOUT_MS,
    );

    it(
      "should list directory contents",
      async () => {
        let command: string;

        if (isWindows) {
          command = "Get-ChildItem | Select-Object -ExpandProperty Name";
        } else {
          command = "ls";
        }

        const result = await runTerminalCommandTool.run({ command });
        // Should return some directory content (not empty)
        expect(result.length).toBeGreaterThan(0);
      },
      SHELL_TEST_TIMEOUT_MS,
    );

    it(
      "should handle command that produces version info",
      async () => {
        // Node.js should be available on all platforms in CI
        const command = "node --version";
        const result = await runTerminalCommandTool.run({ command });

        // Should contain version number (starts with v)
        expect(result.trim()).toMatch(/^v\d+\.\d+\.\d+/);
      },
      SHELL_TEST_TIMEOUT_MS,
    );
  });

  describe("basic error handling", () => {
    it(
      "should handle non-existent commands",
      async () => {
        const command = "definitely-not-a-real-command-xyz123";

        await expect(runTerminalCommandTool.run({ command })).rejects.toMatch(
          /Error \(exit code|not found|not recognized/,
        );
      },
      SHELL_TEST_TIMEOUT_MS,
    );

    it(
      "rejects a non-zero exit code even without stderr",
      async () => {
        await expect(
          runTerminalCommandTool.run({ command: "exit 7" }),
        ).rejects.toContain("exit code 7");
      },
      SHELL_TEST_TIMEOUT_MS,
    );

    it(
      "emits the Bash-ended event when the command fails",
      async () => {
        vi.mocked(emitBashToolEnded).mockClear();

        await expect(
          runTerminalCommandTool.run({ command: "exit 7" }),
        ).rejects.toContain("exit code 7");

        expect(emitBashToolEnded).toHaveBeenCalledOnce();
      },
      SHELL_TEST_TIMEOUT_MS,
    );

    it(
      "removes the background listener when a command times out",
      async () => {
        const listenerCount = backgroundSignalManager.listenerCount(
          "backgroundRequested",
        );

        const result = await runTerminalCommandTool.run({
          command: 'node -e "setTimeout(() => {}, 1000)"',
          timeout: 0.01,
        });

        expect(result).toContain("Command timed out");
        expect(
          backgroundSignalManager.listenerCount("backgroundRequested"),
        ).toBe(listenerCount);
      },
      SHELL_TEST_TIMEOUT_MS,
    );
  });

  describe("platform-specific features", () => {
    if (isWindows) {
      it(
        "should work with Windows commands",
        async () => {
          const result = await runTerminalCommandTool.run({
            command: "Write-Output $env:OS",
          });
          expect(result.trim()).toBe("Windows_NT");
        },
        SHELL_TEST_TIMEOUT_MS,
      );
    }

    if (isMac) {
      it(
        "should work with macOS commands",
        async () => {
          const result = await runTerminalCommandTool.run({
            command: "uname -s",
          });
          expect(result.trim()).toBe("Darwin");
        },
        SHELL_TEST_TIMEOUT_MS,
      );
    }

    if (isLinux) {
      it(
        "should work with Linux commands",
        async () => {
          const result = await runTerminalCommandTool.run({
            command: "uname -s",
          });
          expect(result.trim()).toBe("Linux");
        },
        SHELL_TEST_TIMEOUT_MS,
      );
    }
  });

  describe("WSL detection", () => {
    it("should cache the WSL detection result", () => {
      const firstResult = isRunningInWsl();
      const secondResult = isRunningInWsl();
      expect(firstResult).toBe(secondResult);
    });

    if (!isLinux) {
      it("should return false on non-Linux platforms", () => {
        expect(isRunningInWsl()).toBe(false);
      });
    }
  });
});
