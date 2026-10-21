// DeepSeek
// ========
// The wire of deepseek-api (Agent.ts): DeepSeek's Responses API, which
// is OpenAI's (OpenAI.ts) less a few things: no service tier (one
// speed), no cache markers (it caches by itself), no tool-call cap, no
// reasoning summary (the thought is streamed and returned in full), and
// the developer role reads as a user's. Web search is DeepSeek's own,
// only on SEARCHER; images are only for the others.

import type { Ask } from "./AskAI.ts";
import { type Emit, type Entry, type Item, type Step, type Tool, type Wire } from "./Agent.ts";
import { Price, type Usage } from "./Price.ts";
import { OpenAI } from "./OpenAI.ts";

// Types
// =====

// a stream read so far: the final response, or an error event; usage
type State = { res: any; error: any; use: Usage };

// Constants
// =========

// the one model that searches the web
const SEARCHER = "deepseek-v4-pro";

// DeepSeek
// ========

export namespace DeepSeek {

  export function body(ask: Ask, items: Item[], tools: Tool[], max: number): unknown {
    if (ask.speed !== "slow") {
      throw new Error("DeepSeek has no speed " + ask.speed);
    }
    const defs: object[] = tools.map((t) => ({ type: "function", name: t.name, description: t.info, parameters: t.schema }));
    if (ask.searches > 0 && ask.model === SEARCHER) {
      defs.push({ type: "web_search" });
    }
    return {
      model             : ask.model,
      stream            : true,
      tools             : defs,
      reasoning         : { effort: ask.effort },
      max_output_tokens : max,
      instructions      : ask.system,
      input             : items.flatMap(DeepSeek.input),
    };
  }

  export function input(item: Item): unknown[] {
    if (item.$ === "User") {
      const texts = item.parts.map((p) => ({ type: "input_text", text: p.text }));
      return [{ role: "user", content: [...texts, ...item.imgs.map(OpenAI.image)] }];
    }
    return OpenAI.input(item);
  }

  // one stream event; whether it is the last
  export function read(st: State, ev: any, on: Emit): boolean {
    if (ev.type === "response.reasoning_text.delta") {
      on("mind", ev.delta);
      return false;
    }
    return OpenAI.read(st, ev, on);
  }

  // the messages of an output item: OpenAI's, but a thought is its text
  export function entries(o: any): Entry[] {
    if (o.type === "reasoning") {
      const parts = [...(o.content ?? []), ...(o.summary ?? [])];
      const text = parts.map((p: any) => p.text ?? "").join("\n\n").trim();
      return text ? [{ kind: "mind", text }] : [];
    }
    return OpenAI.entries(o);
  }

  // the step a stream gave
  export function step(st: State, ask: Ask): Step {
    const step = OpenAI.step(st, ask);
    const out: any[] = (st.res ?? { output: [] }).output;
    return { ...step, entries: out.flatMap(DeepSeek.entries) };
  }

  export const wire: Wire<State> = {
    key     : "deepseek",
    idle    : 1200e3,
    url     : "https://api.deepseek.com/responses",
    headers : (key) => ({ authorization: "Bearer " + key, "content-type": "application/json" }),
    body    : DeepSeek.body,
    count   : async () => null,
    start   : (ask) => ({ res: null, error: null, use: Price.usage(ask.speed) }),
    read    : DeepSeek.read,
    begun   : (ev) => ev.type === "response.output_item.added",
    step    : DeepSeek.step,
    usage   : (st) => st.use,
  };

}
