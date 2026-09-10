import { describe, expect, it, vi } from "vitest";
import { executeInstructions, executeList } from "../proxy-modes.ts";
import type { McpExtensionState } from "../state.ts";

const SHORT_INSTRUCTIONS = "Call read_skill with a skill name before answering.";
const LONG_INSTRUCTIONS = `Available skills: ${Array.from({ length: 40 }, (_, i) => `skill-${i}`).join(", ")}. Call read_skill with a skill name to load one.`;

function createState(overrides: { instructions?: string; connected?: boolean; liveInstructions?: string; noTools?: boolean } = {}): McpExtensionState {
  return {
    config: {
      mcpServers: {
        demo: { command: "npx", args: ["demo"] },
      },
    },
    toolMetadata: new Map([
      [
        "demo",
        overrides.noTools
          ? []
          : [
              {
                name: "demo_read_skill",
                originalName: "read_skill",
                description: "Read a skill listed in this server's instructions",
              },
            ],
      ],
    ]),
    serverInstructions: new Map(overrides.instructions ? [["demo", overrides.instructions]] : []),
    manager: {
      getConnection: () => (overrides.connected ? { status: "connected", instructions: overrides.liveInstructions } : undefined),
    },
    failureTracker: new Map(),
  } as unknown as McpExtensionState;
}

describe("proxy instructions", () => {
  it("includes short live instructions in full in the listing", () => {
    const result = executeList(createState({ connected: true, liveInstructions: SHORT_INSTRUCTIONS }), "demo");

    expect(result.content[0].text).toContain(`Server instructions (live connection):\n${SHORT_INSTRUCTIONS}`);
    expect(result.content[0].text).not.toContain("mcp({ instructions:");
    expect(result.details).toMatchObject({ mode: "list", hasInstructions: true, instructionsSource: "live" });
  });

  it("truncates long live instructions and points at the instructions mode", () => {
    const result = executeList(createState({ connected: true, liveInstructions: LONG_INSTRUCTIONS }), "demo");

    expect(result.content[0].text).toContain("Server instructions (live connection):");
    expect(result.content[0].text).not.toContain(LONG_INSTRUCTIONS);
    expect(result.content[0].text).toContain('Use mcp({ instructions: "demo" }) for the full text.');
  });

  it("leaves the listing unchanged when a server has no instructions", () => {
    const result = executeList(createState(), "demo");

    expect(result.content[0].text).not.toContain("Server instructions");
    expect(result.details).toMatchObject({ mode: "list", hasInstructions: false });
  });

  it.each([false, true])("labels cached instruction paths as historical with noTools=%s", (noTools) => {
    const instructions = "Session artifacts: /synthetic/previous-runtime";
    const state = createState({ instructions, noTools });
    const connect = vi.fn();
    Object.assign(state.manager, { connect });
    for (const result of [executeInstructions(state, "demo"), executeList(state, "demo")]) {
      expect(result.content[0].text).toContain("Cached server instructions (not connected; runtime paths are historical, not current ownership evidence):");
      expect(result.content[0].text).toContain(instructions);
      expect(result.details).toMatchObject({ instructionsSource: "cached" });
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it("returns full instructions from the active connection rather than stale metadata", () => {
    const state = createState({ instructions: "stale runtime", connected: true, liveInstructions: LONG_INSTRUCTIONS });
    const result = executeInstructions(state, "demo");

    expect(result.content[0].text).toBe(`demo instructions (live connection):\n\n${LONG_INSTRUCTIONS}`);
    expect(result.details).toMatchObject({ mode: "instructions", server: "demo", length: LONG_INSTRUCTIONS.length, instructionsSource: "live" });
    expect(executeList(state, "demo").content[0].text).not.toContain("stale runtime");
  });

  it("tracks connection, disconnect and reconnection without treating cached paths as live", () => {
    const state = createState({ instructions: "runtime-old" });
    let connection: { status: string; instructions: string } | undefined;
    state.manager.getConnection = vi.fn(() => connection) as typeof state.manager.getConnection;
    for (const live of ["runtime-first", undefined, "runtime-second"]) {
      connection = live ? { status: "connected", instructions: live } : undefined;
      for (const result of [executeInstructions(state, "demo"), executeList(state, "demo")]) {
        expect(result.details).toMatchObject({ instructionsSource: live ? "live" : "cached" });
        expect(result.content[0].text).toContain(live ?? "runtime-old");
        if (live) expect(result.content[0].text).not.toContain("runtime-old");
      }
    }
  });

  it("reports unknown servers", () => {
    const result = executeInstructions(createState(), "missing");

    expect(result.content[0].text).toContain('Server "missing" not found');
    expect(result.details).toMatchObject({ mode: "instructions", error: "not_found" });
  });

  it("does not revive cached instructions when a live server provides none", () => {
    const state = createState({ connected: true, instructions: "stale runtime" });
    const result = executeInstructions(state, "demo");

    expect(result.content[0].text).toBe('Server "demo" does not provide instructions.');
    expect(result.details).toMatchObject({ mode: "instructions", error: "no_instructions" });
    expect(executeList(state, "demo").details).toMatchObject({ hasInstructions: false });
    expect(executeList(state, "demo").content[0].text).not.toContain("stale runtime");
  });

  it("suggests connecting when no instructions are cached", () => {
    const result = executeInstructions(createState(), "demo");

    expect(result.content[0].text).toContain('mcp({ connect: "demo" })');
    expect(result.details).toMatchObject({ mode: "instructions", error: "not_connected" });
  });
});
