import { describe, expect, it } from "vitest";

import DocsCrawler from "./DocsCrawler";
import { validateCrawlRedirect } from "./CheerioCrawler";

describe("Docs crawler network boundaries", () => {
  it("rejects direct loopback crawl targets", async () => {
    const docsCrawler = new DocsCrawler({} as any, {} as any);
    const request = docsCrawler.crawl(new URL("http://127.0.0.1:8080/"));

    await expect(request.next()).rejects.toThrow(/private|local network/i);
  });

  it("rejects redirects to metadata targets", async () => {
    await expect(
      validateCrawlRedirect(
        new URL("https://docs.example/"),
        "http://169.254.169.254/latest/meta-data/",
      ),
    ).rejects.toThrow(/private|local network/i);
  });
});
