import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONTINUE_ASCII_ART, getDisplayableAsciiArt } from "./asciiArt.js";

describe("asciiArt", () => {
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;
  });

  afterEach(() => {
    if (originalColumns === undefined) {
      delete (process.stdout as any).columns;
    } else {
      process.stdout.columns = originalColumns;
    }

    if (originalRows === undefined) {
      delete (process.stdout as any).rows;
    } else {
      process.stdout.rows = originalRows;
    }
  });

  describe("getDisplayableAsciiArt", () => {
    it("should return full ASCII art when terminal is wide enough", () => {
      // Set process.stdout.columns to simulate wide terminal
      process.stdout.columns = 80;
      process.stdout.rows = 40;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(CONTINUE_ASCII_ART);
    });

    it("should start the artwork on the first row", () => {
      process.stdout.columns = 80;
      process.stdout.rows = 40;

      const firstLine = getDisplayableAsciiArt().split("\n")[0];

      expect(firstLine).toContain("#");
    });

    it("should return the compact brand when terminal is too narrow", () => {
      // Set process.stdout.columns to simulate a terminal narrower than the art
      process.stdout.columns = 41;
      process.stdout.rows = 40;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(CONTINUE_ASCII_ART);
      expect(result).toContain("v");
    });

    it("should return the compact brand when terminal is below threshold", () => {
      // Test the edge case at exactly 41 columns (below our threshold of 42)
      process.stdout.columns = 41;
      process.stdout.rows = 40;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(CONTINUE_ASCII_ART);
      expect(result).toContain("v");
    });

    it("should return full ASCII art when terminal is exactly at threshold", () => {
      // Test the edge case at exactly 42 columns (our threshold)
      process.stdout.columns = 42;
      process.stdout.rows = 40;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(CONTINUE_ASCII_ART);
    });

    it("should default to full ASCII art when columns is undefined", () => {
      // Set process.stdout.columns to undefined (should default to 80)
      delete (process.stdout as any).columns;
      delete (process.stdout as any).rows;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(CONTINUE_ASCII_ART);
    });

    it("uses the compact brand when the terminal is too short", () => {
      process.stdout.columns = 80;
      process.stdout.rows = 24;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(CONTINUE_ASCII_ART);
      expect(result).toContain("Continued CLI");
    });
  });
});
