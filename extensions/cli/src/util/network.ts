import {
  assertPublicUrl,
  fetchPublicUrl,
  isPrivateNetworkAddress,
} from "@continuedev/fetch";
import type { FetchFunction } from "core/index.js";

const MAX_REDIRECTS = 5;

export { assertPublicUrl as assertSafeFetchUrl, isPrivateNetworkAddress };

/**
 * Fetch a public URL while revalidating every redirect destination. The CLI
 * uses this instead of native fetch for the model-facing Fetch tool.
 */
export const safeFetch: FetchFunction = async (input, init = {}) => {
  let url = await assertPublicUrl(input);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchPublicUrl(url, init);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects while fetching ${url}`);
    }

    url = await assertPublicUrl(new URL(location, url));
  }
};
