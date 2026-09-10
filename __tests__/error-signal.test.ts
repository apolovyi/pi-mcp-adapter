import { describe, it, expect } from "vitest";
import { toolErrorOverride } from "../error-signal.ts";

describe("toolErrorOverride", () => {
  it("flags tool-execution failures (tool_error, call_failed)", () => {
    expect(toolErrorOverride({ error: "tool_error", server: "x" })).toEqual({ isError: true });
    expect(toolErrorOverride({ mode: "call", error: "call_failed", message: "boom" })).toEqual({ isError: true });
  });

  it.each(["script_error", "timeout", "aborted"])("flags %s without losing details", (error) => {
    expect(toolErrorOverride({mode: "script", error})).toEqual({isError: true});
  });

  it("leaves control feedback without a failed call unchanged", () => {
    for (const code of ["auth_required", "not_connected", "empty_query", "tool_not_found"]) {
      expect(toolErrorOverride({ error: code }), code).toBeUndefined();
    }
    expect(toolErrorOverride({ ok: true })).toBeUndefined();
  });

  it("returns only { isError: true } so pi's field-by-field merge keeps content and details", () => {
    expect(Object.keys(toolErrorOverride({ error: "tool_error" }) ?? {})).toEqual(["isError"]);
  });

  it("ignores malformed details (nullish, non-object, non-string error)", () => {
    expect(toolErrorOverride(undefined)).toBeUndefined();
    expect(toolErrorOverride("tool_error")).toBeUndefined();
    expect(toolErrorOverride({ error: 123 })).toBeUndefined();
  });
});
