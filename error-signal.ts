import { INPUT_REQUIRED_NEEDS_UI } from "./errors.ts";

export function toolErrorOverride(details: unknown): { isError: true } | undefined {
  if (details && typeof details === "object" && "error" in details) {
    const { error, mode } = details as { error?: unknown; mode?: unknown };
    if (typeof error === "string" && (mode === "script" || mode === "call" || error === "tool_error" || error === "call_failed" || error === INPUT_REQUIRED_NEEDS_UI)) {
      return { isError: true };
    }
  }
  return undefined;
}
