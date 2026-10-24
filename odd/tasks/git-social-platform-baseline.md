# Git baseline for Instagram and TikTok

## Objective and authorization
Prepare a recoverable Git starting point before implementing the approved social-platform plan. The user explicitly asked to update the branch first, warned that recent releases went directly to Railway, authorized fetching origin using the configured Git credential, and asked to update Git before continuing. No Railway access, deployment, main-branch replacement, force push, or remote upload is authorized by the fetch-only consent.

## Evidence and decision
- Original checkout: `codex/la-cochera-v11`, HEAD `694cff6`; nine tracked files already modified and many unrelated untracked operational artifacts. Preserve all existing work.
- Fresh `git fetch origin` succeeded. `origin/main` is `0ee2f73`; original HEAD contains all of it (447 ahead, zero behind).
- Latest locally documented deployed source: `codex/reminder-recipient-key-current`, `4e9ca1d`, containing `origin/main` (463 ahead, zero behind) and `codex/new-bot-multivertical` `938af67` (four ahead, zero behind).
- Its release document records Railway deployment `187d7928` as successful on 2026-10-24 at 11:14 Argentina. This is local recorded provenance, not a fresh Railway inspection.
- That source already reintegrates the published cash, agenda and completed-service corrections (`e4aea07`), plus the current La Cochera/booking recovery (`0aae498`) and recipient-key correction (`1b95a37`). Merging the older root branch wholesale would duplicate integrations and risk regressions.
- Start an isolated managed checkout from `4e9ca1d`; retain the original branch and all dirty/untracked files. New branch: `codex/social-platforms` if available.

## Scope and constraints
No product/source changes in this baseline task. Preserve the nine tracked dirty files with a local binary patch and checksum inventory. Exclude `.codex-deploy/`, `tmp/`, exports, browser profiles, screenshots, credentials, generated clients and dependencies from commits/uploads. Do not copy an environment file or reuse a Railway session. The existing seven-line AI test addition stays in the original checkout and recovery copy.

## Tasks and routes
- [x] GSB-1 — Delegated read-only mapping and direct mechanical preservation: establish current source, protect original dirty work, create the clean feature branch from `4e9ca1d`. Mapping/preparation triggers: multiple branch histories, nine changed files and release documents. Evidence: baseline identities, recovery patch/inventory, unchanged original checkout.
- [x] GSB-2 — Delegated verification, direct documentation commit: confirm ancestry, runtime-byte equality to the selected deployed source, offline recipient-key regression, hosting/booking contracts, UTF-8 and diff checks. Commit this document as the work unit; record the exact commit and native assessment result afterward.
- [ ] GSB-3 — Remote synchronization only after explicit authorization of destination/branch and configured Git credential. Publish the concrete verified branch, never force-push or replace `main`; verify the advertised remote commit. If authorization is not yet granted, report pending and preserve local completion.

## Acceptance and checks
The feature branch descends from `4e9ca1d` and freshly fetched `origin/main`; its runtime sources are unchanged from the selected production baseline. Original checkout files and HEAD remain intact. Offline contracts pass or limitations are recorded. Remote synchronization has an explicit receipt or is honestly pending. No production operation occurs.

TDD: STRICT, source `openspec/config.yaml` (`strict_tdd: true`); runner `tsx` contract scripts. This task changes Git references/documentation only, so no behavior RED is applicable. Any later behavior change must observe RED/GREEN/REFACTOR. Planned runners: `scripts/communication-attempt-repository-contract-test.ts`, `scripts/la-cochera-hosting-contract-test.ts`, `scripts/public-booking-services-ui-contract-test.ts`, `npm run test:text-encoding`, `git diff --check`. Use dummy loopback configuration and a nonexistent dotenv path, never live providers/databases. No build (project configuration).

RDD: ON, confirmed with elevated `gentle-ai review mode status --cwd C:/Users/cpu/salon-ai` (global ON, clone unset). A sandbox-denied status printed contradictory OFF before failing identity lookup and is invalid evidence. Assess only the new documentation work unit against `4e9ca1d`; do not fabricate review of the 463 historical commits or reuse prior candidate consent.

Delivery: `ask-on-risk`; no PR planned, new authored forecast under 180 lines (documentation), zero runtime changes. Historical commits are retained as history, not reauthored. Registry names `work-unit-commits` and `chained-pr` resolved through `.atl/skill-registry.md`; registered paths are missing and searches in the available local skill roots found no replacement. No PR planning/creation is performed.

## Recovery and mirror
Locator: `odd/tasks/git-social-platform-baseline.md`. Engram tools (`mem_context`, scoped `mem_search`, `mem_get_observation`, save/update) are unavailable in this runtime; no observation was read or mirrored. Full mirror topic `odd/git-social-platform-baseline/tasks` remains pending; the local full document is authoritative recovery state until resynchronization is possible.

## Progress and next step
GSB-1 and GSB-2 verified. Clean feature branch is ready for remote synchronization authorization; GSB-3 is pending. No Instagram/TikTok source changes have begun.

GSB-1 verified: managed checkout at C:/Users/cpu/.codex/worktrees/social-platforms/salon-ai, branch codex/social-platforms from 4e9ca1d. Original root HEAD and nine dirty files retained. Binary recovery patch SHA256 05b2cb327ef1b8a0583723df4055c0de76e96241497355d8f13c0eda81a43753 and nine-file checksum inventory saved in the chat visualization directory git-social-platform-baseline. Runtime tracked files still equal baseline. GSB-1 closed in work-unit commit 7ea964cddbaf043bb2d6da39d40bd02f2c119656. UTF-8 and diff checks passed before commit. Mirror pending (tools unavailable).

GSB-1 native assessment against 4e9ca1d: exit0, passive/non_executable_only, 37 authored lines, review_due=false/passive. No review ceremony or fabricated approval; reviewed boundary advances to 7ea964cddbaf043bb2d6da39d40bd02f2c119656.

GSB-2 observed verification: ancestry of 4e9ca1d and freshly fetched origin/main PASS; runtime diff across src/prisma/sites/scripts/package files zero; no assume-unchanged or skip-worktree sources; nine original hashes match recovery inventory and root HEAD694cff6 remains intact. Offline recipient-key regression nine cases PASS; La Cochera hosting PASS; public booking services UI PASS; CRM inline syntax two scripts PASS; UTF-8 and diff check PASS. Initial missing Prisma-client import and sandbox EPERM resolved by authorized offline generation into ignored src/generated/prisma. All tests used nonexistent dotenv path, dummy loopback database and JITI_FS_CACHE=false; no live DB/provider/Railway requests. Full build not run per project config; global typecheck/full historical suite not run for this documentation-only baseline. Only added tracked path is this task document. Mirror remains pending.
