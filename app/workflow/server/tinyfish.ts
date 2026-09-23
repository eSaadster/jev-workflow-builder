import "server-only";

// TinyFish Search and Fetch are free on every plan and share one API key.
// https://docs.tinyfish.ai/search-api
const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";

// Fetched pages go into feed messages and every downstream node's input, so
// each page is capped. Feeds have no documented per-message limit.
const MAX_PAGE_CHARS = 4_000;
const MAX_ERROR_CHARS = 300;

export type TinyFishResult = { text: string; mock: boolean };

type SearchResponse = {
  results?: { title?: string; url: string; snippet?: string }[];
};

type FetchResponse = {
  results?: {
    url: string;
    final_url?: string;
    title?: string | null;
    text?: unknown;
  }[];
  errors?: { url: string; error: string }[];
};

function getApiKey(): string | null {
  return process.env.TINYFISH_API_KEY || null;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_ERROR_CHARS);
    throw new Error(`TinyFish ${response.status}: ${body || response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function webSearch(options: {
  query: string;
  maxResults: number;
  signal?: AbortSignal;
}): Promise<TinyFishResult> {
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      text: [
        `1. Mock result for "${options.query}"`,
        "   https://example.com",
        "   Set TINYFISH_API_KEY to run a real web search through this node.",
      ].join("\n"),
      mock: true,
    };
  }

  const params = new URLSearchParams({ query: options.query });
  const data = await request<SearchResponse>(`${SEARCH_URL}?${params}`, {
    headers: { "X-API-Key": apiKey },
    signal: options.signal,
  });
  const results = (data.results ?? []).slice(0, options.maxResults);

  if (results.length === 0) {
    return { text: `No results for "${options.query}".`, mock: false };
  }

  const text = results
    .map((result, index) =>
      [
        `${index + 1}. ${result.title ?? result.url}`,
        `   ${result.url}`,
        result.snippet ? `   ${result.snippet}` : null,
      ]
        .filter((line) => line !== null)
        .join("\n")
    )
    .join("\n\n");

  return { text, mock: false };
}

export async function fetchPages(options: {
  urls: string[];
  signal?: AbortSignal;
}): Promise<TinyFishResult> {
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      text: options.urls
        .map(
          (url) =>
            `## Mock page\n${url}\n\nSet TINYFISH_API_KEY to fetch real page content through this node.`
        )
        .join("\n\n"),
      mock: true,
    };
  }

  const data = await request<FetchResponse>(FETCH_URL, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ urls: options.urls, format: "markdown" }),
    signal: options.signal,
  });
  const results = data.results ?? [];
  const errors = data.errors ?? [];

  // Per-URL failures come back in `errors` with a 200. Only fail the node when
  // nothing could be fetched.
  if (results.length === 0) {
    const reason = errors.map((error) => `${error.url}: ${error.error}`);
    throw new Error(
      reason.length > 0 ? reason.join("; ") : "TinyFish returned no pages."
    );
  }

  const pages = results.map((result) => {
    const body =
      typeof result.text === "string"
        ? result.text
        : JSON.stringify(result.text ?? "");
    const content =
      body.length > MAX_PAGE_CHARS
        ? `${body.slice(0, MAX_PAGE_CHARS)}\n\n…(truncated)`
        : body;

    return `## ${result.title || result.url}\n${result.final_url ?? result.url}\n\n${content}`;
  });

  for (const error of errors) {
    pages.push(`## Failed to fetch\n${error.url}\n\n${error.error}`);
  }

  return { text: pages.join("\n\n"), mock: false };
}
