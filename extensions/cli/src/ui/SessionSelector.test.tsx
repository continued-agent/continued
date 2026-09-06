import { addHours, startOfDay, subDays, subMonths, subYears } from "date-fns";
import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BaseSessionMetadata } from "../session.js";

import { SessionSelector } from "./SessionSelector.js";

vi.mock("../session.js", () => ({
  loadSessionById: vi.fn(),
}));

vi.mock("./hooks/useTerminalSize.js", () => ({
  useTerminalSize: vi.fn(() => ({ rows: 24, columns: 120 })),
}));

describe("SessionSelector", () => {
  const mockOnSelect = vi.fn();
  const mockOnExit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats timestamps correctly for different time periods", () => {
    const now = new Date();
    const today = addHours(startOfDay(now), 14).toISOString(); // 2 PM today
    const yesterday = subDays(new Date(today), 1).toISOString();
    const thisWeek = subDays(new Date(today), 3).toISOString(); // 3 days ago (this week)
    const thisYear = subMonths(new Date(today), 2).toISOString(); // 2 months ago (this year)
    const lastYear = subYears(new Date(today), 1).toISOString(); // 1 year ago

    const sessions: BaseSessionMetadata[] = [
      {
        sessionId: "session-1",
        title: "Today's session",
        dateCreated: today,
        workspaceDirectory: "/test",
      },
      {
        sessionId: "session-2",
        workspaceDirectory: "/test",
        dateCreated: yesterday,
        title: "Yesterday's session",
      },
      {
        sessionId: "session-3",
        workspaceDirectory: "/test",
        dateCreated: thisWeek,
        title: "This week's session",
      },
      {
        sessionId: "session-4",
        workspaceDirectory: "/test",
        dateCreated: thisYear,
        title: "This year's session",
      },
      {
        sessionId: "session-5",
        workspaceDirectory: "/test",
        dateCreated: lastYear,
        title: "Last year's session",
      },
    ];

    const { lastFrame } = render(
      <SessionSelector
        sessions={sessions}
        onSelect={mockOnSelect}
        onExit={mockOnExit}
      />,
    );

    // Check that the output contains expected date formats
    expect(lastFrame()).toContain("2:00 PM"); // Today should show time
    expect(lastFrame()).toContain("yesterday"); // Yesterday should show "yesterday"

    // This week should show day name (we can't predict exact day without knowing when test runs)
    // but we can check it doesn't contain "ago" which was the old format
    expect(lastFrame()).not.toContain("days ago");

    // This year should show month/day format like "Oct 18" (no "ago")
    expect(lastFrame()).toMatch(/[A-Z][a-z]{2} \d{1,2}/); // MMM d format

    // Last year should include the year
    expect(lastFrame()).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}/); // MMM d, yyyy format
  });

  it("handles empty sessions gracefully", () => {
    const { lastFrame } = render(
      <SessionSelector
        sessions={[]}
        onSelect={mockOnSelect}
        onExit={mockOnExit}
      />,
    );

    expect(lastFrame()).toContain("No previous sessions found");
    expect(lastFrame()).toContain("Start a new conversation with: cn");
  });

  it("handles sessions without first user message", () => {
    const sessions: BaseSessionMetadata[] = [
      {
        sessionId: "session-1",
        workspaceDirectory: "/test",
        dateCreated: new Date().toISOString(),
        title: "Empty session",
      },
    ];

    const { lastFrame } = render(
      <SessionSelector
        sessions={sessions}
        onSelect={mockOnSelect}
        onExit={mockOnExit}
      />,
    );

    expect(lastFrame()).toContain("Empty session");
  });

  it("keeps the preview panel within the terminal width", () => {
    const sessions = [
      {
        sessionId: "remote-session",
        workspaceDirectory: "/test",
        dateCreated: new Date().toISOString(),
        title: "Remote session",
        isRemote: true,
      },
    ];

    const { lastFrame } = render(
      <SessionSelector
        sessions={sessions}
        onSelect={mockOnSelect}
        onExit={mockOnExit}
      />,
    );

    const frame = lastFrame() ?? "";
    const widestRow = Math.max(...frame.split("\n").map((line) => line.length));

    expect(frame).toContain("Preview");
    expect(widestRow).toBeLessThanOrEqual(120);
  });

  it("does not crash when a session has an invalid date", () => {
    const sessions: BaseSessionMetadata[] = [
      {
        sessionId: "invalid-date",
        workspaceDirectory: "/test",
        dateCreated: "not-a-date",
        title: "Broken metadata",
      },
    ];

    const { lastFrame } = render(
      <SessionSelector
        sessions={sessions}
        onSelect={mockOnSelect}
        onExit={mockOnExit}
      />,
    );

    expect(lastFrame()).toContain("unknown date");
  });
});
