import { BaseContextProvider } from "..";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  FetchFunction,
} from "../..";
import { getHeaders } from "../../continueServer/stubs/headers";
import { readResponseTextWithLimit } from "../../util/readResponse";
const TRIAL_PROXY_URL = "https://proxy-server-blue-l6vsfbzhba-uw.a.run.app";

export const fetchSearchResults = async (
  query: string,
  n: number,
  fetchFn: FetchFunction,
): Promise<ContextItem[]> => {
  const resp = await fetchFn(WebContextProvider.ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getHeaders()),
    },
    body: JSON.stringify({
      query,
      n,
    }),
  });

  if (!resp.ok) {
    const text = await readResponseTextWithLimit(resp);
    throw new Error(`Failed to fetch web context: ${text}`);
  }
  return JSON.parse(await readResponseTextWithLimit(resp));
};

export default class WebContextProvider extends BaseContextProvider {
  public static ENDPOINT = new URL("web", TRIAL_PROXY_URL);
  private static DEFAULT_N = 6;

  static description: ContextProviderDescription = {
    title: "web",
    displayTitle: "Web",
    description: "Search the web",
    type: "normal",
    renderInlineAs: "",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    return await fetchSearchResults(
      extras.fullInput,
      this.options.n ?? WebContextProvider.DEFAULT_N,
      extras.fetch,
    );
  }
}
