// Web
// ===
// The web tools of deepseek-api (DeepSeek.ts), whose model has none of
// its own: `search` and `fetch`, on DeepSeek's Search and Fetch APIs
// (model agnostic; one key, DEEPSEEK_API_KEY). Search gives each result's
// title, address and summary, never its page (`need_content` off): the
// model fetches the page it wants, in pages of CAP characters from `at`.
// A call answers its failure as the tool's result, never throws. Not
// billed to the user yet (ROADMAP.md).

import type { Out } from "./Agent.ts";
import { clip_page } from "./Clip.ts";
import * as config from "./Config.ts";
import { INT, STR, spec, type Spec } from "./Machine.ts";

// Constants
// =========

const URL_ROOT = "https://api.deepseek.com/v1/tools/";

// the most results a search gives (the API's is 50)
const MOST = 20;

export const WEB: Spec[] = [
  spec("search", "Search the web. Answers up to count results (default 10), each with its title, address, date and a summary of its page. Use fetch for a whole page.", { query: { type: "string", description: "1 to 128 characters; site:, -site: and \"quoted phrases\" work." }, count: INT }, ["query"]),
  spec("fetch", "Fetch a web page by its address, as Markdown. A long page comes in pages from character at, saying where to go on.", { url: STR, at: INT }, ["url"]),
];

// Web
// ===

export namespace Web {

  // whether the web tools can run here
  export function on(): boolean {
    return config.KEYS.deepseek !== "";
  }

  export async function call(name: string, args: any, signal: AbortSignal): Promise<Out> {
    try {
      return name === "search" ? await Web.search(args, signal) : await Web.page(args, signal);
    } catch (err: any) {
      return { text: name + " failed: " + String(err?.message ?? err), fail: true };
    }
  }

  export async function search(args: any, signal: AbortSignal): Promise<Out> {
    const query = String(args.query ?? "");
    const count = Math.min(Math.max(Math.floor(Number(args.count ?? 10)) || 10, 1), MOST);
    const out = await Web.post("search", { query, count, need_content: false }, signal);
    if (typeof out === "string") {
      return { text: out, fail: true };
    }
    const results: any[] = out.results ?? [];
    if (results.length === 0) {
      return { text: "No results.", fail: false };
    }
    const show = (r: any, k: number) => [k + 1 + ". " + r.title, r.url, r.date ? "(" + r.date + ")" : "", r.summary || r.snippet || ""].filter((s) => s !== "").join("\n");
    return { text: results.map(show).join("\n\n"), fail: false };
  }

  export async function page(args: any, signal: AbortSignal): Promise<Out> {
    const out = await Web.post("fetch", { url: String(args.url ?? "") }, signal);
    if (typeof out === "string") {
      return { text: out, fail: true };
    }
    const text = (out.title ? "# " + out.title + "\n\n" : "") + (out.content ?? "");
    return { text: clip_page(text, Math.max(0, Number(args.at ?? 0) || 0)), fail: false };
  }

  // an API's answer; or, failed, why
  export async function post(api: string, body: object, signal: AbortSignal): Promise<any> {
    const res = await fetch(URL_ROOT + api, {
      method  : "POST",
      headers : { authorization: "Bearer " + config.KEYS.deepseek, "content-type": "application/json" },
      body    : JSON.stringify(body),
      signal,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      return api + " failed: HTTP " + res.status + (out.error?.message ? ": " + out.error.message : "");
    }
    return out;
  }

}
