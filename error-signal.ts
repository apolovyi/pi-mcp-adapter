export function toolErrorOverride(details: unknown): { isError: true } | undefined {
  if (details && typeof details === "object" && "error" in details) {
    const { error, mode } = details as { error?: unknown; mode?: unknown };
    if (typeof error === "string" && (mode === "script" || mode === "call" || error === "tool_error" || error === "call_failed")) {
      return { isError: true };
    }
  }
  return undefined;
}
