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
