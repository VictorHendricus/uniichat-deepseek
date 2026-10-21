// DeepSeek test
// =============
// `bun test DeepSeek.test.ts`. The deepseek-api wire's request and
// stream (DeepSeek.ts), its web tools against a fake DeepSeek (Web.ts),
// and who is given them (Tools.ts).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

process.env.UNII_DIR = fs.mkdtempSync(os.tmpdir() + "/unii-deepseek-");

// a process reads Config once (maybe for another test): the fake key goes
// in it, not in the environment
const config = await import("./Config.ts");
config.KEYS.deepseek = "test";

const { DeepSeek } = await import("./DeepSeek.ts");
const { Pick } = await import("./Pick.ts");
const { Price } = await import("./Price.ts");
const { Tools } = await import("./Tools.ts");
const { Web } = await import("./Web.ts");

const ASK: any = {
  vendor: "deepseek-api", model: "deepseek-flash", effort: "high", speed: "slow", system: "be brief", searches: 10,
  blocks: [{ text: "hi", mark: true }],
};
const USER: any = { $: "User", parts: [{ text: "hi", mark: true }], imgs: [{ type: "image/png", data: "AA" }] };
const TOOL = { name: "zoom", info: "open", schema: { type: "object" } };

// Request
// =======

test("a request is a Responses one without what DeepSeek lacks", () => {
  const body: any = DeepSeek.body(ASK, [USER], [TOOL], 1000);
  expect(body.model).toBe("deepseek-flash");
  expect(body.instructions).toBe("be brief");
  expect(body.reasoning).toEqual({ effort: "high" });
  expect(body.max_output_tokens).toBe(1000);
  expect(body.tools).toEqual([{ type: "function", name: "zoom", description: "open", parameters: { type: "object" } }]);
  expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hi" }, { type: "input_image", image_url: "data:image/png;base64,AA" }] }]);
  for (const key of ["service_tier", "prompt_cache_options", "max_tool_calls", "store", "context"]) {
    expect(key in body).toBe(false);
  }
  expect(JSON.stringify(body)).not.toContain("prompt_cache_breakpoint");
  expect(JSON.stringify(body)).not.toContain("web_search");
});

test("DeepSeek has one speed", () => {
  expect(() => DeepSeek.body({ ...ASK, speed: "fast" }, [USER], [], 1000)).toThrow("no speed fast");
});

// Stream
// ======

test("a stream reads into its thought, reply and tool calls", () => {
  const st = { res: null as any, error: null, use: Price.usage("slow") };
  const seen: Array<[string, string]> = [];
  const on = (kind: string, text: string) => seen.push([kind, text]);
  const output = [
    { type: "reasoning", content: [{ type: "reasoning_text", text: "think" }] },
    { type: "message", content: [{ type: "output_text", text: "ok" }] },
    { type: "function_call", call_id: "c1", name: "zoom", arguments: '{"id":3}' },
  ];
  const usage = { input_tokens: 100, input_tokens_details: { cached_tokens: 60 }, output_tokens: 20 };
  const events = [
    { type: "response.reasoning_text.delta", delta: "thi" },
    { type: "response.reasoning_text.delta", delta: "nk" },
    { type: "response.output_text.delta", delta: "ok" },
    { type: "response.output_item.added", item: { type: "function_call", name: "zoom" } },
    { type: "response.completed", response: { status: "completed", output, usage } },
  ];
  const last = events.map((ev) => DeepSeek.read(st, ev, on as any));
  expect(last).toEqual([false, false, false, false, true]);
  expect(seen).toEqual([["mind", "thi"], ["mind", "nk"], ["unii", "ok"], ["tool", "zoom "]]);
  const step = DeepSeek.step(st, ASK);
  expect(step.stop).toBe("tools");
  expect(step.uses).toEqual([{ id: "c1", name: "zoom", input: { id: 3 } }]);
  expect(step.entries.map((e) => [e.kind, e.text])).toEqual([["mind", "think"], ["unii", "ok"], ["tool", 'zoom {"id":3}']]);
  expect(step.note).toBe("");
  expect(DeepSeek.wire.usage(st)).toMatchObject({ input: 40, read: 60, write: 0, output: 20, speed: "slow" });
});

test("a failed response fails the step; a server error is busy", () => {
  const fail = (code: string) => DeepSeek.step({ res: { status: "failed", error: { code, message: "no" }, output: [] }, error: null, use: Price.usage("slow") }, ASK);
  expect(fail("invalid_request")).toMatchObject({ stop: "fail", why: "no" });
  expect(fail("server_error")).toMatchObject({ stop: "busy" });
});

// Picks and prices
// ================

test("deepseek-flash is picked at one speed, and priced", () => {
  const offer = { vendors: ["deepseek-api" as const], models: ["deepseek-flash"] };
  const pick = { vendor: "deepseek-api", model: "deepseek-flash", effort: "medium", speed: "slow" };
  expect(Pick.read(pick, offer)).toEqual(pick);
  expect(Pick.read({ ...pick, speed: "fast" }, offer)).toBeNull();
  expect(Pick.read({ ...pick, model: "deepseek-v4-pro" }, offer)).toBeNull();
  expect(Price.cost("deepseek-flash", { ...Price.usage("slow"), input: 1e6, output: 1e6 })).toBe(1.5e6);
  expect(Price.cost("deepseek-flash", { ...Price.usage("slow"), searches: 10 })).toBe(0);
});

// Web tools
// =========

// a fake DeepSeek: the requests it got, the answers it gives
function fake(answer: (api: string, body: any) => Response): { asked: Array<{ api: string; auth: string | null; body: any }>; done: () => void } {
  const real = globalThis.fetch;
  const asked: Array<{ api: string; auth: string | null; body: any }> = [];
  globalThis.fetch = (async (url: string, init: any) => {
    const api = url.replace("https://api.deepseek.com/v1/tools/", "");
    const body = JSON.parse(init.body);
    asked.push({ api, auth: new Headers(init.headers).get("authorization"), body });
    return answer(api, body);
  }) as any;
  return { asked, done: () => (globalThis.fetch = real) };
}

const NEVER = new AbortController().signal;

test("search asks without page content and shows each result", async () => {
  const ds = fake(() => Response.json({ results: [
    { title: "A", url: "https://a.example", summary: "about a", snippet: "a", date: "2026-10-01T00:00:00Z", content: "" },
    { title: "B", url: "https://b.example", summary: "", snippet: "about b", date: null },
  ] }));
  const out = await Web.call("search", { query: "cats", count: 99 }, NEVER);
  ds.done();
  expect(ds.asked).toEqual([{ api: "search", auth: "Bearer test", body: { query: "cats", count: 20, need_content: false } }]);
  expect(out.fail).toBe(false);
  expect(out.text).toBe("1. A\nhttps://a.example\n(2026-10-01T00:00:00Z)\nabout a\n\n2. B\nhttps://b.example\nabout b");
});

test("a search with no results says so", async () => {
  const ds = fake(() => Response.json({ results: [] }));
  expect(await Web.call("search", { query: "zzz" }, NEVER)).toEqual({ text: "No results.", fail: false });
  expect(ds.asked[0].body.count).toBe(10);
  ds.done();
});

test("fetch gives a page in pages from at", async () => {
  const content = ("line of text\n").repeat(5000);
  const ds = fake(() => Response.json({ title: "T", content }));
  const first = await Web.call("fetch", { url: "https://a.example" }, NEVER);
  const at = Number(/go on with at (\d+)\]$/.exec(first.text)?.[1]);
  const next = await Web.call("fetch", { url: "https://a.example", at }, NEVER);
  ds.done();
  expect(ds.asked[0].body).toEqual({ url: "https://a.example" });
  expect(first.fail).toBe(false);
  expect(first.text.startsWith("# T\n\nline of text")).toBe(true);
  expect(first.text).toMatch(/go on with at \d+\]$/);
  expect(at).toBeGreaterThan(29000);
  expect(next.text.startsWith("line of text")).toBe(true);
});

test("a failed call is the tool's failed result, never a throw", async () => {
  let ds = fake(() => Response.json({ error: { message: "rate limited" } }, { status: 429 }));
  expect(await Web.call("search", { query: "x" }, NEVER)).toEqual({ text: "search failed: HTTP 429: rate limited", fail: true });
  ds.done();
  ds = fake(() => {
    throw new Error("no connection");
  });
  expect(await Web.call("fetch", { url: "https://a.example" }, NEVER)).toEqual({ text: "fetch failed: no connection", fail: true });
  ds.done();
});

// Who gets them
// =============

function tools_of(vendor: string): any {
  const pick = { vendor, model: "m", effort: "medium", speed: "slow" };
  return { agents: new Map([["Ann", { role: { $: "sub" } }], ["Bo", { role: { $: "hands" } }]]), hooks: { pick: () => pick } };
}

const names = (tools: any, who: string) => Tools.list(tools, who).map((t: any) => t.name);

test("only deepseek-api callers with a key get the web tools", () => {
  for (const who of ["main", "Ann"]) {
    expect(names(tools_of("deepseek-api"), who)).toEqual(expect.arrayContaining(["search", "fetch"]));
    expect(names(tools_of("claude-api"), who)).not.toContain("search");
    expect(names(tools_of("openai-api"), who)).not.toContain("fetch");
  }
  expect(names(tools_of("deepseek-api"), "Bo")).toEqual(["computer"]);
  config.KEYS.deepseek = "";
  expect(names(tools_of("deepseek-api"), "main")).not.toContain("search");
  config.KEYS.deepseek = "test";
});

test("a web tool is called through the tools", async () => {
  const ds = fake(() => Response.json({ results: [{ title: "A", url: "https://a.example", summary: "s" }] }));
  const out = await Tools.call(tools_of("deepseek-api"), "main", "search", { query: "q" }, NEVER, "id");
  ds.done();
  expect(out).toEqual({ text: "1. A\nhttps://a.example\ns", fail: false });
});
