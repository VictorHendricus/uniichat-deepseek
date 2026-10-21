Roadmap
=======

Billing for the DeepSeek `search` and `fetch` tools
---------------------------------------------------

The tools call DeepSeek's `/v1/tools/search` and `/v1/tools/fetch`, at
$0.75 per 1,000 successful calls (free until 2026-11-01). They are not
billed to the user: a tool call has no payer, and the model requests'
usage never counts them. Doing so takes:

- a price for each in `Price.ts` (0 until 2026-11-01);
- a `"tool"` kind in `Served` (AskAI.ts), so `Pay` gives a tool call a
  `Bill`; `Tools.call` books it before the request (a refusal is the
  tool's failed result) and settles it after, only for a call that
  answered 200 with results;
- a `Used` that a tool call can fill (it has no model `Pick`), and the
  hosted `Billing` to read it.

Worth doing once a hosted server plugs in a real payer (Billing.ts is
free here, so it would do nothing in this repo).

Spend and context in the page
-----------------------------

A self-hosted server (free Billing.ts) shows no credit, and no server
shows how much context a call used. Both could come from what is already
told: each response's `Usage` (Agent.ts `used`, Price.ts `cost`).

- a spend counter: the running total in USD of the chat's calls (turns,
  summaries, agents; plus the web tools once they are billed, above),
  shown where `.credits` is when the server doesn't bill;
- the context length: the last turn's input tokens (input + cache read +
  cache write), against the model's window, next to the model knob.
  Needs each model's window in Pick.ts's `Model`.
