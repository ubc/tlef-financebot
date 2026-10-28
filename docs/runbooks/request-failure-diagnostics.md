# Investigating API request failures

## Start with the deployed code

Confirm the staging deployment includes the diagnostics commit, then hard-refresh
the browser to load its compiled client. A Git push alone does not establish that
the running process was replaced. Historical records cannot gain a missing path,
exception location or browser request association retroactively.

## Investigate an Operations & Issues record

### Why a request has no user

Publicly reachable URLs receive requests before anyone signs in to CWL. A request
to a nonexistent API is not a user operation just because it appears in this
table. `Not signed in` means Passport evaluated an unauthenticated request;
`Identity not evaluated` means it stopped earlier (for example, a known probe
rejected before sessions). `Identity not recorded` discloses a historical gap.
None of these identifies a person or proves an intrusion. Do not assign the
currently viewing Admin or a PUID from an untrusted header to those requests.

The browser's central API client sends a public Financebot marker. Its presence
helps distinguish updated browser calls from older/other clients, but it is
forgeable and is never authentication. An expired session's first protected 401
remains audited. Updated browsers stop reporting after that 401 rather than
creating another rejected client-error POST; sign-in resumes reporting.

### Known probes and grouping

Use **Filters → Traffic classification → Known probe paths** for fixed Git,
environment-file, PHPUnit, WordPress, phpMyAdmin and Laravel-debug signatures.
These paths return generic 404 before body parsing or session reads and remain
recorded failures. **Exclude known probe paths** leaves unknown paths and normal
application errors visible. Both filters default to all traffic, and compose with
Routing. Historical known public digests can be recognized on read without
rewriting their records. Unknown digests are never labelled malicious by default.

New records may show a UTC day, connection peer group and user-agent group.
Search an exact group to compare activity within that day. Groups use a keyed
daily digest and never expose raw addresses or headers. A connection peer may be
the shared reverse proxy; user agents can be shared/forged. Matching either group
does not prove the same sender, and groups cannot identify an attacker. Forwarded
IP headers are not trusted. These fields require an existing non-default session
secret of at least 32 characters and are not added retroactively.

Known probe traffic, first-party session failures and business failures must be
investigated according to their evidence. A red failed row means that request did
not complete successfully; a successful HTTP response alone does not prove an
exploit either. Confirm sensitive response content or unauthorized effects through
the appropriate protected logs. Application logs do not clear host compromise.

### Investigation steps

1. Open **User operations → Filters → Routing → Unmatched routes (404)** for
   the unknown-route failures. **Exclude unmatched 404s** isolates other outcomes,
   including a known resource endpoint returning 404. The default keeps both.
2. Open a row. Retain its exact timestamp, Request ID, HTTP status and sanitized
   path. Check **Input & response** for `failureCategory`, `exception`, or a
   browser-reported request's `reportedRequest`, `reportedStatusCode` and
   `relatedRequestId`. A browser-reported link does not verify that server record.
3. Search the path hash to find repeated paths, even when unknown segments display
   as `:redacted`. The hash excludes query strings; paths longer than 4,096
   characters hash only their prefix and disclose truncation. A fixed common
   public path can be identified by comparing digests, but arbitrary masked paths
   cannot generally be recovered. Search server logs for the Request ID.
4. For an unmatched path, correlate reverse-proxy access records by timestamp,
   status and request path. Use the request ID if the proxy records the upstream
   `X-Request-ID` response header. Default access-log formats may not include it.
   The application does not modify proxy access-log configuration.
5. Fix the identified caller or configuration, then reproduce the original
   action. Verify the intended endpoint's response and any linked background
   task. A healthy API acceptance (202) does not establish that its worker finished.

| Evidence | Next check |
| --- | --- |
| Unmatched 404 from a real page action | Browser Network request and deployed client version; compare the API path with the mounted server route |
| Repeated unmatched check endpoint | Load balancer, uptime probe or deployment health-check configuration |
| Requests for known scanning paths | Proxy access records and traffic controls; anonymous identity or a client category alone does not prove an attack |
| 400/413 before route matching | `malformed-json`/`payload-too-large`, content type and payload size; avoid copying the payload into logs |
| 401/403 | Session expiry or the endpoint's authorization guard; diagnostics never bypass the guard |
| 422/400 from a matched endpoint | Recorded validation paths and current client inputs |
| Matched 404 | Missing/stale resource ID or the endpoint's scoped lookup; it is not an unmatched route |
| 429 | Request frequency, polling and retry behavior |
| 500/503 or an exception | Request ID, safe exception code locations and backing-service health |
| Pending/slow warning | Work/DB/provider still in progress; check linked jobs and upstream timeout settings before retrying |
| Interrupted/499 | Connection closed before completion; check persisted resources/jobs before repeating a mutation |
| Browser-reported 502/504 without a server record | Proxy routing/timeout and process health; the error may have been generated before Express |
| Browser-reported response failure with HTTP 200 | Proxy/login HTML or invalid response JSON; inspect response content locally without adding it to telemetry |
| `audit.record_dropped` | Audit database failure or the 100-write pending limit; use server logs and process-local Audit health counters |

## Server log tags

- `http.route_not_found`: completed unknown API route returning 404.
- `http.operation_failed`: failed, partial or interrupted application request.
- `http.exception`: exception received by the central Express error handler;
  contains bounded exception categories and project code locations, not raw stacks.
- `http.operation_pending`: one warning at 30 seconds for an unfinished non-SSE
  request. This does not cancel work or prove failure.
- `http.operation_slow`: an observed slow completion that was not excluded as
  a routine successful poll/stream.
- `audit.record_dropped`: the database telemetry record was lost; safe correlation
  metadata remains in the server's log stream if that stream is available.

## Boundaries

Requests rejected by DNS, TLS, the load balancer/proxy, Node's HTTP parser or an
unreachable process never reach this middleware. They require infrastructure logs.
Non-API static/auth requests and background workers keep their existing logging;
this change does not claim universal instrumentation. A hard kill before response
completion can lose its audit record; before 30 seconds there may be no pending
warning. Process crashes or loss of both MongoDB and the log collector cannot be
made complete by application logging alone.

Normal SSE navigation is excluded. Protocol-specific SSE payload failures and
durable background task outcomes must be checked in their existing run evidence;
a successful HTTP stream handshake does not prove that its work succeeded.
Browser reports require connectivity, authentication, executing client code and
available report budget. Client/fetch-site headers and browser reports are
unverified hints and never authorize access. New logs omit raw URLs, query strings,
raw headers, IP addresses, bodies, answers and uploaded documents. Error-message
redaction in the existing database evidence remains bounded best effort.
