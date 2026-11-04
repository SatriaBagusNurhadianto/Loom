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

A focused integrated Electron sweep passed **27 tests**: agent interruption/permission/overlap and image cases (13), research/citation/Zotero cases (4), Git/export (7), and desktop recovery (3). It used synthetic harnesses, a local Zotero fixture, and local Git repositories; no provider inference, credential-dependent call, or remote push occurred. Subsequent packaged full-suite runs exposed a test synchronization issue around stale-source recovery; the test now waits for the operation to finish before asserting Escape closes the dialog and restores focus. The final independent packaged run passed as recorded below. See [project status](../project_status.md) for the current Phase 8 limits.

Additional focused persistence review passed 33 deterministic cases, 6 desktop recovery/IME-adjacent cases, 3 agent recovery cases, and 11 build-path cases. A new real-Electron restart case for a project root containing spaces and non-ASCII characters passed 1/1. Packaging checks built both the unpacked app and AppImage; two focused scenarios passed from each in extract-and-run mode. Normal AppImage launch and installation remain unverified because the host lacks `libfuse.so.2`. The large-project performance rerun is recorded below; browser-generated composition checks do not verify a physical IME.

### Final packaged Electron and local TeX suites — 5 November 2026

Independent Luna High verification passed the full suite against `release/linux-unpacked/loom`:

```bash
LOOM_E2E_EXECUTABLE="$PWD/release/linux-unpacked/loom" \
LOOM_AGENT_PACKAGED=1 \
npx playwright test
```

Result: **62 passed, 13 skipped, 0 failed** (75 total, 2.2 minutes). The agent suite uses its own `LOOM_AGENT_PACKAGED` selector; both selectors were set so all Electron suites exercised the packaged app. The skips were the opt-in Phase 8 workload, local TeX cases, and live/authorized provider checks. No failure traces were produced. The synchronized References Escape regression also passed 20 consecutive packaged repetitions.

The authorized local TeX toolchain was available (`~/.TinyTeX`, latexmk 4.88, Tex Live 2026, TexLab 5.26.0). Against the same packaged app:

```bash
LOOM_TEST_TEX=1 \
LOOM_E2E_EXECUTABLE="$PWD/release/linux-unpacked/loom" \
npx playwright test tests/e2e/latex.spec.ts
```

Result: **9 passed, 2 skipped** in 52.3 seconds. The passing cases exercised sample edits and rebuilds, PDF navigation/export, failed/stale output recovery, TexLab completion/definition/diagnostics, real process cancellation, save acknowledgment, polling and keyboard behavior. The skips were the intentionally unavailable-tool scenario and a second local-paper scenario gated to a different authorization path. This verifies local compilation, not live-provider research or the Phase 8 workload's build/stream concurrency.

## Performance workload and reporting

Use the PRD Section 10.1 workload: 100,000 source lines across 1,000 files, a 200-page PDF, and 5,000 bibliography entries. Record CPU model/core count, RAM, storage, display resolution, OS, package hash, harness/tool versions, and whether the machine was otherwise idle. Measure cold startup to usable editor, opening a 10,000-line file, mapped source/PDF navigation, 5,000-entry local bibliography search, p95 typing-to-paint while a build and agent stream are active, idle CPU after work settles, and memory across repeated edits/builds. Keep external model latency and compiler duration separate from Loom interaction measurements. Report sample count, measurement method, p50/p95 where applicable, and any workload fixture limits. The PRD figures are proposed targets; do not report them as established requirements or passes without measurements.

Generate a synthetic project that exceeds the input sizes without overwriting an existing directory:

```bash
npm run workload:phase8 -- .cache/phase-8-large-project
```

This creates 1,002 `.tex` files with 111,012 lines, including one 10,000-line file, 5,000 bibliography records, and a valid 200-page synthetic PDF. To collect the packaged-app smoke metrics:

```bash
LOOM_PHASE8_PROJECT="$PWD/.cache/phase-8-large-project" \
LOOM_E2E_EXECUTABLE="$PWD/release/linux-unpacked/loom" \
npm run bench:phase8
```

The opt-in bench writes its measurements to `artifacts/phase-8-workload-metrics.json`. It samples package launch-to-service-ready, project-open-to-editor, project search, 10,000-line navigation, end-to-end bibliography UI search, 50 keydown-to-animation-frame delays, per-process PSS/RSS snapshots before/after interaction, and five-second CPU after save acknowledgment and a three-second settling interval. The one-second project refresh stays active during CPU sampling. Bibliography latency includes the UI action, IPC, project refresh, parsing, filtering and rendering; it does not isolate parsing or indexed-search performance. Memory uses `/proc/<pid>/smaps_rollup` PSS when readable for every sampled process; otherwise the fallback is a process-tree RSS sum, which can double-count shared memory. Two snapshots do not establish memory growth, bounded caches or leaks. The animation-frame delay is a browser-side proxy rather than display presentation latency. This smoke does not model simultaneous TeX compilation and live agent streaming. It does not substitute for the full PRD measurements or hardware/physical IME checks.

Each benchmark run validates the generated `large-file line 9999` target, then copies the supplied folder into a private temporary project before launching Electron. Its typing step replaces the selected search match and saves that copy; the original generated workload remains untouched. The copy and isolated userData are removed after Electron closes, including on failure. Fixture copying is outside the launch/open timings and warms filesystem caches; these are not cold-I/O measurements. A missing target fails before launch with a fixture diagnostic rather than timing out in project search.

### Focused packaged workload rerun — 5 November 2026

`npm run workload:phase8 -- .cache/phase-8-focused-benchmark` generated the stated 1,002-file/111,012-line fixture. The documented environment variables with that folder and `release/linux-unpacked/loom`, followed by `npm run bench:phase8`, passed **1/1** in 22.3 seconds. The initial focused rerun timed out because the default narrow viewport hid the sidebar and the Project button opened a dialog; the passing test sets and records a 1440×900 renderer viewport and searches directly in the Project sidebar.

Single-run measurements (not p95 estimates except the 50-key typing sample):

- Launch to service ready: **286.8 ms**; separate project chooser/open to editor: **1,648.6 ms**. This is not cold launch into a recent project; OS caches were not cleared.
- Project text search: **1,439.5 ms**; navigation to the search hit in the 10,000-line file: **1,291.6 ms**.
- Bibliography end-to-end UI search: **1,379.1 ms**.
- Keydown to next animation frame, 50 samples: p50 **3.1 ms**, p95 **4.6 ms**, maximum **16.2 ms**.
- Process-tree PSS: **641.97 MiB** after open and **1,128.70 MiB** after interactions/settling. PSS was readable for every process; per-process PID/PPID/PSS/RSS are in `artifacts/phase-8-workload-metrics.json`. Corresponding RSS sums were **1,183.04 / 1,750.96 MiB** and can double-count shared pages.
- CPU after save acknowledgment and three seconds of settling: **145.71% of one core** over **5,003.1 ms**, including the one-second project refresh and all sampled Electron descendants. Near-idle CPU is not established; this high sample needs profiling in the broader Phase 8 work.

Host: Linux `7.2.3-arch1-3`, AMD Ryzen 9 9955HX (16 cores/32 threads), 30 GiB RAM, Samsung NVMe `MZAL81T0HFLB-00BL2`. Machine activity was uncontrolled; physical display resolution was not confirmed. Existing packaged Electron 45.2.1 artifact was used without rebuilding app code: executable SHA-256 `870b5982c855df1405399efa0d51d83e6e048b3308a84cce4040bc3b052ce9f3`, `resources/app.asar` SHA-256 `32e4611dacde73bb15724a7608927bef23d0cf041de1b6a5d1ce8afb6e5f25a7`. Local TinyTeX is available (`~/.TinyTeX/bin/x86_64-linux/latexmk -v`: 4.88); this benchmark did not compile or stream an agent. Its 200-page PDF remains a source-folder asset, not an exercised PDF.js build snapshot. These measurements do not satisfy mapped PDF navigation, repeated edit/build memory behavior, compilation/stream concurrency, normal AppImage installation, or the full Phase 8 gate.

Focused checks passed: `npm run typecheck`; `npx prettier --check tests/e2e/phase8-workload.spec.ts scripts/phase-8-workload.mjs docs/phase-8-testing.md package.json project_status.md`; `npx playwright test tests/e2e/phase8-workload.spec.ts --list` (1 test); `git diff --check`. No broad suite, new package build, physical IME or live-provider run was performed for this unit.

Independent Luna High verification then ran the same packaged benchmark three times against `.cache/phase-8-focused-benchmark`; all three passed. Launch-to-ready measured 279.7/284.4/293.1 ms, project open 1,698.9/1,730.1/1,680.6 ms, project search 399.2/908.1/949.3 ms, 10,000-line open 985.3/449.0/378.8 ms, bibliography search 1,753.9/1,256.8/1,947.5 ms, and typing p95 5.4/4.7/4.9 ms. The supplied fixture's `large-file.tex` had the same SHA-256 before and after (`ec24f8d3fcadc4ee7489ecb330444b01c6e0ce01f2474d9adf78c9be118e153c`), 10,000 lines, and 538,883 bytes. [`phase-8-workload-metrics.json`](../artifacts/phase-8-workload-metrics.json) contains the final run's detailed process and memory metrics; all three test results are summarized above and in `project_status.md`. These runs validate repeatable fixture isolation and successful searches; they do not establish controlled cold-start latency, CPU improvement, or memory growth.

### Post-fix warmed CPU profile — 5 November 2026

Independent Luna High rebuilt the current package and measured the same 1,002-file project after a 60-second editor warm-up with TexLab absent from `PATH`. Two 15-second samples with normal project refreshes measured **22.26%** and **21.13% of one core**. The first sample used 1.91 CPU seconds in the utility service, 1.28 in the renderer, 0.11 in main, and 0.04 in the network utility; the second used 1.93, 1.11, 0.10, and 0.03 seconds. The executable SHA-256 was `870b5982c855df1405399efa0d51d83e6e048b3308a84cce4040bc3b052ce9f3`; `app.asar` SHA-256 was `f3b1f9f5212392792239d4c851fcb65411caa804fdb26938fab54ecbe50cc91e`.

These normal-observer readings are below the supplied pre-fix 34.93% sample, but the test was uncontrolled and does not prove a causal reduction or near-idle behavior. The attempted refresh interception failed (the preload bridge was non-writable; a main-process hook attempt later closed before producing metrics), so there is no valid post-fix intercepted comparison with the earlier 9.80% sample. Other desktop processes were active outside the sampled Loom process tree. No application files changed during this profile.

## Manual compatibility and security review

- Enter Unicode using a physical IME (including composition and candidate confirmation), then save, close, reopen, search, and compile the source. Browser-dispatched composition events are not physical IME verification.
- Open, create, rename, move, search, build, and export from a project path containing spaces and non-ASCII characters.
- Exercise first-run missing-tool guidance and representative empty, loading, error, cancellation/interruption, and reconnect states.
- Compare default and expanded application states to [DESIGN.md](../DESIGN.md) and the supplied Prism reference. Check keyboard-only operation, visible focus, labels, reduced motion, and a 720x540 window.
- Use synthetic credential/chat sentinels to inspect logs, application exports, source ZIPs, and default Git safeguards. Never place real credentials in fixtures.
- Inspect dependency audit findings individually. Distinguish production dependency vulnerabilities from development and packaging toolchain advisories.

## Release evidence record

Record each check in `project_status.md` with command or procedure, exact result, artifact/version, limitation, and next action. Do not mark Phase 8 complete until every phase checkbox and exit criterion has evidence, Phase 6's computation-input provenance prerequisite is closed, critical recovery defects are resolved, and the installed package completes the end-to-end research workflow. State unavailable physical devices, external tools, provider access, or platform checks as open evidence gaps.
