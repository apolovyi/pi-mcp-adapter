# Pi MCP Adapter: reliable tool execution

A fork of [Pi MCP Adapter](https://github.com/nicobailon/pi-mcp-adapter) maintained by [Artem Polovyi](https://github.com/apolovyi). The adapter connects coding agents to external tools through MCP. My work makes the execution boundary explicit: what may run, what happens after failure, and who owns process cleanup.

## Stop dependent work when a call fails

Returning a failure as an ordinary value allowed a script to continue into dependent operations. I changed tool calls to throw by default and made continuation an explicit choice through captured failures. Structured server errors and already-emitted checkpoints remain available for diagnosis. The regression tests verify that a failed call stops the chain before the next operation runs.

[Execution contract and tests](https://github.com/apolovyi/pi-mcp-adapter/commit/0c0aa18cd119a4e5a2c540adb84149c6e9afcde3).

## Validate before approval or dispatch

Invalid arguments should not reach a remote tool or prompt a user to approve an operation that cannot run. I applied schema validation across proxy, direct-tool and script entry points. Validation failures explicitly report that execution has not started, distinguishing a rejected request from an uncertain remote outcome.

[Boundary validation and tests](https://github.com/apolovyi/pi-mcp-adapter/commit/78d0398c10a7badd1522d69fbae14bac72c35d0b).

## Keep diagnostics from blocking cleanup

HTTP request-header commands can spawn helper processes. Synchronous descendant discovery could block command cleanup; stopping too early could lose buffered output. I made discovery asynchronous, stopped it when the command exited, and retained output handling through stream closure. Cleanup failures remain errors rather than silently allowing the HTTP request to proceed.

[Process lifecycle implementation and tests](https://github.com/apolovyi/pi-mcp-adapter/commit/cfaf05fa6522748ac51836706fe1022b1c7b3b24).

## Project documentation

The implementation uses TypeScript, Node.js worker threads and the MCP SDK. The linked changes include regression tests for call ordering, validation before dispatch and helper-process exit handling.

- [Installation, configuration and complete usage guide](https://github.com/apolovyi/pi-mcp-adapter/blob/main/PROJECT.md).
- [MCP scripting workflow](skills/mcp-scripting/SKILL.md).
- [Upstream Pi MCP Adapter](https://github.com/nicobailon/pi-mcp-adapter).
