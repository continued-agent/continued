import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { NodeHtmlMarkdown } from "node-html-markdown";

import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  FetchFunction,
} from "../../index.js";
import { fetchFavicon } from "../../util/fetchFavicon";
import { isBlockedUrl } from "../../util/urlSecurity";

const MAX_REDIRECTS = 5;

async function fetchPublicUrl(
  fetchFn: FetchFunction,
  input: string | URL,
  init: Record<string, unknown> = {},
): Promise<Response> {
  let url = new URL(input);

  for (let redirectCount = 0; ; redirectCount += 1) {
    if (isBlockedUrl(url)) {
      throw new Error(
        "Requests to private, local, or non-HTTP URLs are not allowed",
      );
    }

    const response = await fetchFn(url, {
      ...init,
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers?.get("location");
    if (!location) {
      return response;
    }
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects while fetching ${url}`);
    }
    url = new URL(location, url);
  }
}

class URLContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "url",
    displayTitle: "URL",
    description: "Reference a webpage at a given URL",
    type: "query",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    return await getUrlContextItems(query, extras.fetch);
  }
}

export default URLContextProvider;

export async function getUrlContextItems(
  query: string,
  fetchFn: FetchFunction,
): Promise<ContextItem[]> {
  const url = new URL(query);
  if (isBlockedUrl(url)) {
    throw new Error(
      "Requests to private, local, or non-HTTP URLs are not allowed",
    );
  }

  const safeFetchFn: FetchFunction = (input, init) =>
    fetchPublicUrl(fetchFn, input, init);
  const icon = await fetchFavicon(url, safeFetchFn);
  const resp = await fetchPublicUrl(fetchFn, url);

  // Check if the response is not OK
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();

  const dom = new JSDOM(html);
  let reader = new Readability(dom.window.document);
  let article = reader.parse();
  const content = article?.content || "";
  const markdown = NodeHtmlMarkdown.translate(
    content,
    {},
    undefined,
    undefined,
  );

  const title = article?.title || url.pathname;

  return [
    {
      icon,
      description: url.toString(),
      content: markdown,
      name: title,
      uri: {
        type: "url",
        value: url.toString(),
      },
    },
  ];
}
