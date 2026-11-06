# Bounded completion transport after the October 16 quality experiments

## Observed fault

The held-out experiment scheduled 60 cells and reached terminal execution state.
Thirty observed SDK invocations failed with connection errors: 20 generator
calls and 10 reviewer calls. A failed review is unavailable quality evidence,
not a negative semantic judgment. The separate public-HTTP acceptance then
stalled on a streaming CAPM generation call for more than four hours.

The installed SDK clears its fetch timeout when response headers arrive
(`node_modules/openai/client.mjs`, `fetchWithTimeout`). Its subsequent SSE iterator
can keep waiting for another chunk. FinanceBot previously awaited that iterator
without a total deadline. This explains the unbounded application wait; it does
not establish the upstream cause of the connection outage.

The official [retry guidance](https://developers.openai.com/api/docs/guides/rate-limits#retrying-with-exponential-backoff)
distinguishes per-attempt timeout from a whole-operation deadline and recommends
bounding total retry time. The implementation was checked against the installed
SDK, rather than assuming that its request timeout covers the response body.

## Implementation

- `request-deadline.ts` owns one deadline and AbortController per completion.
- The adapter passes the signal in SDK request options, never the JSON body.
- Header waits and each iterator step share the same deadline; chunks do not
  renew it. A stalled iterator or its cleanup cannot indefinitely delay failure.
- Timeout rejects as `ModelCallTimeoutError` with code `model-call-timeout`.
  JSON repair is not attempted for this transport failure.
- Late responses are consumed without callbacks, usage capture, or task writes.
- Already received usage is retained. Missing usage remains unknown and retains
  its conservative reservation. Timeout does not prove that no tokens were billed.
- `LLM_REQUEST_TIMEOUT_MS` defaults to 180,000 milliseconds and can be increased
  deliberately for long reasoning tasks. No additional retries were introduced.
  The installed SDK's physical retry visibility remains unknown.

This change applies to OpenAI and the compatible UBC adapter used by the tested
generation/review flows. It does not claim a whole-run deadline, a health-probe
deadline, distributed provider limits, or cancellation of other provider adapters.

## Preserved interrupted experiment

`audit-results/quality-lab-public-http-2026-10-16-bootstrap-live/operator-stop-result.json`
records the explicit SIGTERM/exit 143, a subsequent absent-process check, and
the owned local run transition from revision 24/running to revision 25/failed.
Only its Agenda job was disabled. The original result and ledger hashes were
preserved; the interrupted native call retains unknown usage and an unobserved
provider outcome. No provider call was made during reconciliation.

The first case saved 1/3 requested Drafts. The second case was interrupted; the
third case and all three regeneration intents were not executed. One observed
saved Draft out of six declared slots is not a completed six-slot acceptance.

## Validation

`audit-results/quality-lab-transport-deadline-tests-final-2026-10-17.json` records
five suites and 85 passing tests across the deadline, provider adapter, JSON
completion, model observation, and budget paths. New fault cases cover no
headers, a stalled stream, non-renewing total deadline, late resolution/rejection,
ignored cancellation, stuck iterator cleanup, reported versus unknown usage,
budget reservation retention, success cleanup, and invalid timeout settings.
An installed-SDK test uses an intercepted synthetic fetch stream and confirms
that the real transport signal aborts. Both JSON paths confirm no correction send
on timeout. These tests make no paid requests.

The final two cases advance the clock beyond the deadline before its timer
callback runs. Both synchronous and asynchronous failures still report the
expired deadline, rather than an incidental upstream error. The earlier
83-test receipt remains unchanged as historical evidence.

Paid quality acceptance after this change remains outstanding. The timeout fix
proves bounded waiting under tested faults, not better question content or a
resolved provider outage. Model ranking must exclude unavailable semantic
judgments and preserve the failed-call cost/latency denominator.
