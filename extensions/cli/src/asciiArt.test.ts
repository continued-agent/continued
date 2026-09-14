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
      process.stdout.columns = 120;
      process.stdout.rows = 60;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(CONTINUE_ASCII_ART);
      expect(result).not.toContain("0.0.0-dev");
    });

    it("should preserve the artwork's top spacing", () => {
      process.stdout.columns = 120;
      process.stdout.rows = 60;

      const firstArtworkLine = getDisplayableAsciiArt()
        .split("\n")
        .find((line) => line.length > 0);

      expect(firstArtworkLine).toContain("-=-=");
    });

    it("should return the compact brand when terminal is too narrow", () => {
      // Set process.stdout.columns to simulate a terminal narrower than the art
      process.stdout.columns = 41;
      process.stdout.rows = 40;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(CONTINUE_ASCII_ART);
      expect(result).toBe("  ✦ Continued CLI");
      expect(result).not.toContain("v0.0.0-dev");
    });

    it("should return the compact brand when terminal is below threshold", () => {
      // Test a terminal just below the new artwork's width threshold.
      process.stdout.columns = 77;
      process.stdout.rows = 40;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(CONTINUE_ASCII_ART);
      expect(result).toBe("  ✦ Continued CLI");
    });

    it("should return full ASCII art at the width threshold", () => {
      process.stdout.columns = 78;
      process.stdout.rows = 60;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(CONTINUE_ASCII_ART);
    });

    it("should keep the full artwork when the terminal is short", () => {
      process.stdout.columns = 120;
      process.stdout.rows = 24;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(CONTINUE_ASCII_ART);
    });

    it("should default to 80 columns when columns is undefined", () => {
      delete (process.stdout as any).columns;
      process.stdout.rows = 60;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(CONTINUE_ASCII_ART);
    });
  });
});
