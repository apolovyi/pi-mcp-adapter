---
name: mcp-scripting
description: Write mcpScript JavaScript for discovering, inspecting, and calling MCP tools.
---

# MCP scripting

For multi-call MCP work, write ordinary JavaScript with loops, filtering, chaining, fan-out, or other logic between calls. Run that source with `mcpScript`; it is the primary MCP orchestration surface. For a single MCP search, describe, status check, auth action, or tool call, use `mcp` instead.

Write the source naturally, then pass it as `mcpScript`'s `code` argument:

```js
const { items } = await tools.search({ query: "search issues", server: "github" });
const candidate = items[0];
if (!candidate) return { error: "No matching tool" };

const details = await tools.describe({ path: candidate.path });
if (details.error) return details;

const result = await tools.call(details.path, { query: "is:open label:bug" });
emit({ tool: details.path, completed: true });
return result.data;
```

## Workflow

1. Find candidate tools with `await tools.search({ query, server?, limit?, offset? })`.
2. Inspect the exact returned path with `await tools.describe({ path })`.
3. Call it with `tools.call(path, args)`.

`tools.call` and direct flat calls resolve to `{ ok: true, data }` and throw on failure, stopping dependent work unless explicitly caught. For expected failures, use `await tools.capture(path, args)`, which resolves to `{ ok: true, data }` or `{ ok: false, error: { code, message, path, details } }`. Inspect the captured failure before deciding whether to continue; capture does not retry. Structured server results remain available as `error.details.mcpResult`. Script-visible results retain their original shape even when large; display limits apply to emitted/returned output, not intermediate data.

`emit(value)` adds user-visible output before the final `return` value. `console` output is captured too. Exceptions, timeouts, and unfinished calls mark the Pi tool result as failed. Completed emissions are retained. Uncaught call failures include bounded `details.failure` evidence, with a full-result artifact when oversized. Await every call: worker termination and local cancellation do not prove remote actions stopped. Inspect uncertain state before retrying; do not replay a whole script.

`tools` is a non-enumerable proxy: `Object.keys(tools)` throws. Always use `tools.search` for discovery. When a known flat path is a valid identifier, direct calls such as `tools.github_search_issues(args)` are supported; use bracket syntax for hyphenated names: `tools["server_tool-name"](args)`. `search`, `call`, `capture`, `describe`, and promise/serialization names (`then`, `catch`, `finally`, `toJSON`, `toString`, `valueOf`) are reserved on the proxy; if a flat path collides with one, call it via `tools.call("exact-path", args)`.

`tools.search` and `tools.describe` are asynchronous and must be awaited. The default script timeout is 30 seconds; the worker is terminated at the deadline, including for infinite loops. Every invocation still uses normal lazy connection, authentication, output guarding, and approval gates. Result details contain a concise `calls` trace with every search, describe, and call operation; each entry includes its query or path, outcome, and duration.

Arguments are validated against the current advertised input schema before approval and tool dispatch. Validation failures report `phase: "validation"` and `execution: "not_started"`; invalid metadata is not silently downgraded. Re-describe or explicitly reconnect when metadata is stale; never guess replacement fields.

The sandbox provides `URL` and `URLSearchParams` for pure URL construction, plus standard JavaScript values and Promise utilities. It does not provide `fetch`, `require`, `process`, or timers. Use an MCP wait tool when waiting on remote state.

For a tool accepting JavaScript source, serialize a self-contained function once rather than nesting escaped source strings. The remote function cannot capture local script variables:

```js
const source = (() => document.querySelector('[aria-label="Primary content"]')?.textContent).toString();
const result = await tools.call("playwright_browser_evaluate", { function: source });
return result.data;
```

Source strings are forwarded unchanged; schema validation is not JavaScript syntax validation or automatic source repair. Keep external values in structured arguments when the remote tool supports them.

Use plain JavaScript loops and Promise utilities for composition. Fluent helpers such as `tools.find(...).one()`, `tools.parallel(...)`, and `tools.retry(...)` are not provided.
