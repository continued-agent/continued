import { URL } from "node:url";

import { getHeaders } from "../../../continueServer/stubs/headers";
import { assertPublicUrl, fetchPublicUrl } from "@continuedev/fetch";
const TRIAL_PROXY_URL = "https://proxy-server-blue-l6vsfbzhba-uw.a.run.app";
import { PageData } from "./DocsCrawler";
import { readResponseTextLimited } from "./readResponseTextLimited";

export class DefaultCrawler {
  constructor(
    private readonly startUrl: URL,
    private readonly maxRequestsPerCrawl: number,
    private readonly maxDepth: number,
  ) {}

  async crawl(): Promise<PageData[]> {
    await assertPublicUrl(this.startUrl);
    const requestUrl = new URL("crawl", TRIAL_PROXY_URL).toString();
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getHeaders()),
      },
      body: JSON.stringify({
        startUrl: this.startUrl.toString(),
        maxDepth: this.maxDepth,
        limit: this.maxRequestsPerCrawl,
      }),
    };
    let resp: Awaited<ReturnType<typeof fetchPublicUrl>> | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        resp = await fetchPublicUrl(requestUrl, {
          ...init,
          signal: AbortSignal.timeout(30_000),
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 250 * 2 ** attempt),
          );
        }
      }
    }
    if (!resp) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Crawl request failed");
    }
    if (!resp.ok) {
      const text = await readResponseTextLimited(resp, 64 * 1024);
      throw new Error(`Failed to crawl site (${resp.status}): ${text}`);
    }
    const json = JSON.parse(await readResponseTextLimited(resp)) as PageData[];
    if (!Array.isArray(json) || json.length > this.maxRequestsPerCrawl) {
      throw new Error("Crawl response contains too many pages");
    }
    if (json.some((page) => typeof page.content !== "string")) {
      throw new Error("Crawl response contains invalid page data");
    }
    return json;
  }
}
