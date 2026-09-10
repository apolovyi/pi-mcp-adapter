import { expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createDirectToolExecutor } from "../direct-tools.ts";
import { executeCall } from "../proxy-modes.ts";
import { runMcpScript } from "../mcp-code.ts";
import { McpServerManager } from "../server-manager.ts";
import type { McpExtensionState } from "../state.ts";
import type { DirectToolSpec } from "../types.ts";

it.each(["proxy", "direct", "script"])("validates %s arguments before approval or dispatch", async (path) => {
  const definition = {
    command: process.execPath,
    args: [fileURLToPath(new URL("./fixtures/mcp-code-server.mjs", import.meta.url))],
  };
  const manager = new McpServerManager();
  try {
    const connection = await manager.connect("fixture", definition);
    const dispatch = vi.spyOn(connection.client, "callTool");
    const approval = vi.fn();
    const schema = {
      type: "object",
      properties: { value: { type: "string", minLength: 1 } },
      required: ["value"],
      additionalProperties: false,
    };
    const state = {
      manager,
      config: { settings: {}, mcpServers: { fixture: definition } },
      toolMetadata: new Map([["fixture", [{ name: "fixture_echo", originalName: "echo", inputSchema: schema }]]]),
      failureTracker: new Map(),
      completedUiSessions: [],
      approvalEvents: { emit: approval },
    } as unknown as McpExtensionState;
    const spec: DirectToolSpec = {
      serverName: "fixture",
      originalName: "echo",
      prefixedName: "fixture_echo",
      description: "Synthetic validation",
      inputSchema: schema,
    };
    for (const args of [{}, { ref: "synthetic" }, { value: 42 }, { value: null }, { value: "" }, { value: "ok", extra: true }, { value: ["invalid"] }]) {
      const result = path === "proxy" ? await executeCall(state, "fixture_echo", args)
        : path === "direct" ? await createDirectToolExecutor(() => state, () => null, spec)("test", args)
        : await runMcpScript(state, `return await tools.capture("fixture_echo",${JSON.stringify(args)});`);
      const details = path === "script" ? JSON.parse(result.content[0].text).error.details : result.details;
      expect(details).toMatchObject({ error: "invalid_arguments", phase: "validation", execution: "not_started" });
      expect(dispatch).not.toHaveBeenCalled();
      expect(approval).not.toHaveBeenCalled();
    }
    const valid = await executeCall(state, "fixture_echo", { value: "valid" });
    expect(valid.details).not.toHaveProperty("error");
    expect(dispatch).toHaveBeenCalledTimes(1);
    state.toolMetadata.get("fixture")![0]!.inputSchema = { $schema: "https://example.com/unsupported", type: "object" };
    const invalidSchema = await executeCall(state, "fixture_echo", { value: "valid" });
    expect(invalidSchema.details).toMatchObject({ error: "invalid_tool_schema", execution: "not_started" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  } finally {
    await manager.closeAll();
  }
});
