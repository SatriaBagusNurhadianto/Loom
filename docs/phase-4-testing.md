# Phase 4 testing

Loom connects installed agent harnesses rather than implementing another model/tool execution loop. OpenCode and Codex run their own authentication, model access, execution, permissions and native history. Linux x86_64 is the exercised desktop target. Use synthetic or explicitly authorized papers for provider checks: requests, attachments and files the agent reads can leave the machine through the configured model.

## Try a revision

1. Run `npm run dev` and open a paper folder, or use the editable sample paper described in [Phase 3 testing](phase-3-testing.md). Ordinary editing needs no agent account.
2. In the bottom-center composer choose **Connect an agent**. Select OpenCode or Codex. **Setup guide** opens official instructions. Install/sign in through that harness first if necessary, then Connect. Supported native protocols are OpenCode **2.2.x, minimum 2.2.1**, and Codex **0.159.x**; incompatible versions are rejected with guidance. Loom does not install or update them automatically.
3. Choose a configured model in the composer. The catalog reflects harness configuration; a listed model may still lack access. In this development setup the user confirmed **Big Pickle** is the working OpenCode model. The UI does not hardcode or force it for other installations. An empty catalog explains setup and disables sending while preserving the draft.
4. Optionally attach a project text file or source selection. Ask, for example, “Make the first sentence clearer without changing its scientific meaning.” Native permission prompts offer Deny or Allow once; native questions retain typed answers while status updates arrive. Read the actual requested permissions before responding.
5. Watch the public response in the conversation above the composer. The agent may change the real project directly. **Review changes** shows what the filesystem observation found, including file creation/deletion, text differences and binary summaries. This is post-write review; other external writes during the turn can also be included.
6. Choose Keep to mark a file reviewed, or Revert and confirm to restore its pre-turn content safely. Newer compatible text is retained; overlaps refuse automatic revert and preserve the ordinary conflict versions. Choose **Update PDF** to compile the revised paper with the existing snapshot build scheduler.
7. Use **Chats** to continue a project conversation. Each chat records its harness; Loom never sends a Codex session to OpenCode or vice versa. A prompt draft survives reload in this Electron profile, independently of the manuscript.

## Connections and recovery

Loom-managed OpenCode starts on an ephemeral private loopback endpoint with a random in-memory password. Codex uses its native stdio app-server. Disconnect stops an owned process and waits for exit before final filesystem review. The local HTTP MCP endpoint is authenticated and exists only for the managed process lifetime. Managed harnesses receive paper structure, PDF status and build tools. Build responses distinguish a scheduled request from an actually completed PDF.

**Connection details → Use an existing local OpenCode server** accepts a root `http://127.0.0.1:PORT` or IPv6 loopback endpoint and its credentials. Passwords are masked, not saved to project/preferences/history and cleared from the form on close. Redirects and non-loopback URLs are rejected. Loom detaches rather than killing an external server and does not register or change its tools/permissions. Only managed instances receive Loom's automatic MCP configuration.

**Stop** sends the native cancellation request, then waits for confirmed idle/terminal state. Partial multi-file work remains reviewable. A transport failure is not reported as success. If an external server's stop cannot be confirmed, Loom retains the unresolved turn and explains how to stop it in OpenCode and reconnect. Reconnect resumes the same native session, confirms interruption and scans the final files before allowing another turn.

Before a turn, Loom flushes current author work, checks the project revision and durably checkpoints existing project bytes. The recovery record survives utility/Electron restart independently of native history. After a crash, an old owned supervisor must be positively known to have exited before recovery proceeds; an inaccessible or reused PID is not assumed dead. With external servers, reconnect and native stop confirmation are required. Do not remove application data while it contains wanted recovery checkpoints.

Practical checks:

- Start a request that modifies two synthetic files, Stop midway and inspect both changes after cancellation/reload.
- Type a compatible note while a request is running; verify safe review/revert retains it. For an overlapping sentence change, verify the conflict retains baseline, author text and disk text without silent replacement.
- Interrupt the local utility process during a partial external-server request. The UI must say local service unavailable/interrupted, preserve the prompt, reconnect before another request and retain file review.
- Disconnect and reconnect both harnesses. Continue a chat and verify history, model choice and correct project association.
- At 720×540, use keyboard Tab/Shift Tab, Escape, Source/PDF focus modes and native model selection. Source and the bottom composer remain reachable; questions retain focus; notifications must not obscure Send.

Pilot limits follow existing project limits plus 128 MiB of pre-turn recovery bytes and 100 retained turn/chat references per project. Text excerpts/differences are bounded. Computationally complex differences fall back to explicit before/after review; the original checkpoint bytes remain available. These bounds are explained rather than silently dropping recovery data. Cross-platform distribution and exhaustive performance/IME remain Phase 8.

## Deterministic and Electron checks

```bash
npm run check
npm run test:e2e
```

`check` runs formatting, TypeScript, deterministic tests and production bundles. Default tests make no paid model calls. `tests/opencode-adapter.test.ts` and `tests/codex-adapter.test.ts` exercise native protocol fixtures, empty catalogs, permission/question decisions, terminal events, resume, redirect/endpoint rejection and owned process termination. Change/service/project tests exercise real temporary filesystem/SQLite recovery, admission failure, compatible/overlapping edits, rename/delete/binary changes, large comparisons and interrupted operation guards. The MCP fixture uses actual authenticated local HTTP.

`tests/e2e/agent.spec.ts` launches real sandboxed Electron/main/preload/utility/SQLite/IndexedDB/Yjs, with a **synthetic OpenCode HTTP server** and synthetic manuscript. Its model responses are simulated; it is not evidence of provider inference. Six default cases cover attachment/permission/question/streaming/revert, partial cancellation and chat/draft reload, 720×540 keyboard use, utility SIGKILL/reconnect, overlapping edits, and empty-model setup. Only native picker results and the harness server boundary are substituted. A seventh, opt-in live desktop case uses the actual managed OpenCode service and Big Pickle, checks the native file revision in the editor, compiles the revised PDF, inspects the diff and safely reverts it. It is skipped by default. Existing desktop/LaTeX suites retain their independent workflows. Run Electron suites sequentially to avoid shared artifact collisions. The manual nested-paper recovery fixture removes copied local `loom.build.json` preferences from its temporary sample so a developer’s automatic-build setting cannot turn its explicit Create action into Stop; the source sample is untouched.

## Optional authorized native checks

These commands use existing local agent setup. Only run with an available authorized account; inference tests send a synthetic paper to the configured model and can consume account usage.

```bash
LOOM_AGENT_LIVE=1 npx vitest run tests/agent-live.test.ts
LOOM_AGENT_INFERENCE=1 LOOM_OPENCODE_MODEL=big-pickle npx vitest run tests/agent-live.test.ts
LOOM_CODEX_INFERENCE=1 npx vitest run tests/agent-live.test.ts
LOOM_LATEX_LIVE=1 npx vitest run tests/agent-tools.test.ts
LOOM_AGENT_DESKTOP_LIVE=1 npx playwright test tests/e2e/agent.spec.ts -g 'authorized live Big Pickle'
```

The first command actually starts both installed harnesses, reads their model catalogs, creates/resumes native project sessions and confirms authenticated OpenCode MCP registration, without requesting model inference. The second revises a synthetic manuscript through actual OpenCode (Big Pickle is the default test choice) and safely reverts its real file write. The third exercises actual Codex revision, public messages, native history reconnect and safe revert. The MCP check uses installed latexmk/TeX to compile through the actual authenticated Loom MCP build tool. The live desktop check also requires these local build tools. The temporary Phase 3 toolchain, if still available, needs its bin and compatibility-library paths as described in that guide.

To exercise the built package through the same native desktop boundaries:

```bash
npm run package
LOOM_AGENT_PACKAGED=1 npx playwright test tests/e2e/agent.spec.ts -g 'real Electron agent flow'
```

This uses `release/linux-unpacked/loom`, sandbox enabled, with the explicitly synthetic harness fixture. It proves bundled transport/UI/recovery operation, not packaged provider entitlement. Observed counts, live versions, review findings and remaining limits belong in [project status](../project_status.md) and [Phase 4 review](phase-4-review.md).
