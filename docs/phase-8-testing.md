# Phase 8 first-release hardening and Linux pilot

Phase 8 is the release gate for the first Linux x86_64 build. Keep evidence split into deterministic checks, synthetic Electron integration, local toolchain checks, and authorized live-provider checks. A passing mock does not establish a live provider workflow. Do not push to the configured remote or publish release artifacts during local acceptance.

## Acceptance coverage

| PRD Section 12 scenario                                | Primary evidence                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1. Multi-file import and local build                   | [Phase 3 testing](phase-3-testing.md), [Phase 7 testing](phase-7-testing.md) extracted-source compile |
| 2. Missing dependencies and recovery                   | [Phase 3 testing](phase-3-testing.md) missing-tool and setup flows                                    |
| 3. Source, structure, references and PDF navigation    | [Phase 3 testing](phase-3-testing.md)                                                                 |
| 4. Agent context and focused revision                  | [Phase 4 testing](phase-4-testing.md); synthetic harness and live-provider evidence are distinct      |
| 5. Overlapping human and agent edits                   | [Phase 2 testing](phase-2-testing.md), [Phase 4 testing](phase-4-testing.md)                          |
| 6. Cancel multi-file work and recover                  | [Phase 4 testing](phase-4-testing.md); inspect the partial-change/restart cases                       |
| 7. Literature evidence, citation, repeated import      | [Phase 5 testing](phase-5-testing.md)                                                                 |
| 8. Read-only Zotero import                             | [Phase 5 testing](phase-5-testing.md); a synthetic local fixture is not a live Zotero installation    |
| 9. Image conversion and unsupported-model guidance     | [Phase 6 testing](phase-6-testing.md); distinguish model capability checks from live inference        |
| 10. Git exchange and conflict recovery                 | [Phase 7 testing](phase-7-testing.md) local two-author/bare-remote walkthrough                        |
| 11. Export and stale-PDF disclosure                    | [Phase 3 testing](phase-3-testing.md), [Phase 7 testing](phase-7-testing.md)                          |
| 12. Restart after interruption                         | [Phase 2 testing](phase-2-testing.md), [Phase 4 testing](phase-4-testing.md)                          |
| 13. Large-project responsiveness and resource behavior | Run the documented workload below against the packaged app; capture measurements and machine details  |
| 14. Credential/private-state boundaries                | [Phase 7 testing](phase-7-testing.md); use synthetic sentinels only                                   |

The focused guides include commands and synthetic fixture details. The broad regression commands are `npm run check` and `npm run test:e2e`; prefer the focused suite for investigation, then run the broad suite once for release evidence. Run `npm run package` before packaged smoke. For the actual installation path, build and install the AppImage on the target Linux x86_64 machine and record its hash and install method; an unpacked `release/linux-unpacked/loom` launch is packaged-app evidence, not AppImage installation evidence.

### Current run — 5 November 2026

A focused integrated Electron sweep passed **27 tests**: agent interruption/permission/overlap and image cases (13), research/citation/Zotero cases (4), Git/export (7), and desktop recovery (3). It used synthetic harnesses, a local Zotero fixture, and local Git repositories; no provider inference, credential-dependent call, or remote push occurred. The previously recorded full-suite-order References Escape/focus assertion failure was not included in this focused sweep; its isolated rerun passed. See [project status](../project_status.md) for the current Phase 8 limits and pending reviews.

Additional focused persistence review passed 33 deterministic cases, 6 desktop recovery/IME-adjacent cases, 3 agent recovery cases, and 11 build-path cases. A new real-Electron restart case for a project root containing spaces and non-ASCII characters passed 1/1. Packaging checks built both the unpacked app and AppImage; two focused scenarios passed from each in extract-and-run mode. Normal AppImage launch and installation remain unverified because the host lacks `libfuse.so.2`. No large-project performance measurements or physical IME check were completed.

## Performance workload and reporting

Use the PRD Section 10.1 workload: 100,000 source lines across 1,000 files, a 200-page PDF, and 5,000 bibliography entries. Record CPU model/core count, RAM, storage, display resolution, OS, package hash, harness/tool versions, and whether the machine was otherwise idle. Measure cold startup to usable editor, opening a 10,000-line file, mapped source/PDF navigation, 5,000-entry local bibliography search, p95 typing-to-paint while a build and agent stream are active, idle CPU after work settles, and memory across repeated edits/builds. Keep external model latency and compiler duration separate from Loom interaction measurements. Report sample count, measurement method, p50/p95 where applicable, and any workload fixture limits. The PRD figures are proposed targets; do not report them as established requirements or passes without measurements.

## Manual compatibility and security review

- Enter Unicode using a physical IME (including composition and candidate confirmation), then save, close, reopen, search, and compile the source. Browser-dispatched composition events are not physical IME verification.
- Open, create, rename, move, search, build, and export from a project path containing spaces and non-ASCII characters.
- Exercise first-run missing-tool guidance and representative empty, loading, error, cancellation/interruption, and reconnect states.
- Compare default and expanded application states to [DESIGN.md](../DESIGN.md) and the supplied Prism reference. Check keyboard-only operation, visible focus, labels, reduced motion, and a 720x540 window.
- Use synthetic credential/chat sentinels to inspect logs, application exports, source ZIPs, and default Git safeguards. Never place real credentials in fixtures.
- Inspect dependency audit findings individually. Distinguish production dependency vulnerabilities from development and packaging toolchain advisories.

## Release evidence record

Record each check in `project_status.md` with command or procedure, exact result, artifact/version, limitation, and next action. Do not mark Phase 8 complete until every phase checkbox and exit criterion has evidence, Phase 6's computation-input provenance prerequisite is closed, critical recovery defects are resolved, and the installed package completes the end-to-end research workflow. State unavailable physical devices, external tools, provider access, or platform checks as open evidence gaps.
