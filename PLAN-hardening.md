# agentctl Hardening Plan

Tracked from the architecture review of the v0.1.0 codebase. Seven changes, ordered by dependency. Each item includes scope, approach, affected files, and test impact.

---

## 1. Error Infrastructure: `AgentctlError` + raise model

**Problem**: `process.exit(1)` is scattered through `run.ts`, `init.ts`, `sync.ts`, `list.ts`, and `doctor.ts`. This prevents cleanup, makes library code untestable, and swallows stack traces.

**Approach**:

1. Create `src/errors.ts` with a typed error class:

   ```ts
   export class AgentctlError extends Error {
     constructor(message: string, public readonly exitCode: number = 1) {
       super(message);
       this.name = "AgentctlError";
     }
   }
   ```

2. Replace every `console.error(...) + process.exit(1)` call in `src/cli/*.ts` with `throw new AgentctlError(...)`.

3. Add a single top-level handler in `src/cli/index.ts`:

   ```ts
   program.exitOverride(); // prevent commander from calling process.exit

   program.action(async () => { ... }); // existing actions unchanged

   program.parseAsync().catch((err) => {
     if (err instanceof AgentctlError) {
       console.error(`Error: ${err.message}`);
       process.exit(err.exitCode);
     }
     // commander error (bad args, etc.)
     if (err?.code === "commander.*") {
       console.error(err.message);
       process.exit(1);
     }
     // unexpected — print full trace
     console.error(err);
     process.exit(1);
   });
   ```

4. Also call `program.exitOverride()` so Commander's own validation errors (missing required args, unknown options) throw instead of exiting.

**Files changed**:
- New: `src/errors.ts`
- Modified: `src/cli/index.ts`, `src/cli/run.ts`, `src/cli/init.ts`, `src/cli/sync.ts`, `src/cli/list.ts`, `src/cli/doctor.ts`

**Tests affected**: Integration tests that assert on error messages and exit codes should still pass — the error text and exit behavior are preserved, just the mechanism changes. The `AGENTCTL_EXIT=N` pattern in the test runner will still work because the top-level handler calls `process.exit`.

---

## 2. Config Parse Failure: Error Instead of Silent Drop

**Problem**: `loadConfig()` in `src/config/index.ts` uses `.safeParse()` and silently ignores layers that fail validation. A typo in `models.json` causes the entire layer to be dropped with zero feedback.

**Approach**:

1. After each `safeParse` call, check `parsed.success`:
   - If `false`, throw `AgentctlError` with the Zod error details included. The message should name the file and the specific fields that failed.

   ```ts
   const globalConfig = await readJsonFile<unknown>(...);
   if (globalConfig) {
     const parsed = ConfigSchema.partial().safeParse(globalConfig);
     if (!parsed.success) {
       const issues = parsed.error.issues
         .map((i) => `${i.path.join(".")}: ${i.message}`)
         .join("; ");
       throw new AgentctlError(
         `Invalid config in ${path.join(globalDir, "config.json")}: ${issues}`,
       );
     }
     config = mergeConfigs(config, parsed.data);
   }
   ```

2. Repeat for all four parse sites: global config, global models, project config, project models.

3. For `readJsonFile` returning `null` — this currently means either "file doesn't exist" or "file is unreadable" or "file has invalid JSON". Split this into distinguishable cases:
   - File doesn't exist → skip (current behavior, correct).
   - File exists but can't be parsed as JSON → throw `AgentctlError` with the parse error.
   - File exists but can't be read (permissions) → throw `AgentctlError`.

   Implement this by changing `readJsonFile` to throw on parse errors rather than returning `null`, or add a separate `readJsonFileOrThrow` variant. The safest migration is:

   ```ts
   export async function readJsonFile<T>(filePath: string): Promise<T | null> {
     try {
       const content = await fs.readFile(filePath, "utf-8");
       return JSON.parse(content) as T;
     } catch (err) {
       if ((err as any).code === "ENOENT") return null;       // file doesn't exist
       throw new AgentctlError(                                // file exists but broken
         `Failed to read ${filePath}: ${(err as Error).message}`,
       );
     }
   }
   ```

**Files changed**:
- Modified: `src/util/index.ts` (`readJsonFile`)
- Modified: `src/config/index.ts` (`loadConfig`)
- Modified: `src/resources/agents/index.ts` (`loadAgentsFromDir` — agent.json parse)

**Tests affected**: Any test where a malformed config previously caused silent fallback will now error. This is the intended behavior change. Tests should be updated to expect errors in those cases.

---

## 3. HOME Not Set: Error Instead of Silent `"~"` Fallback

**Problem**: `process.env.HOME ?? "~"` appears in `util/index.ts`, `claude.ts`, and `opencode.ts`. If `HOME` is unset, the literal string `"~"` is used as a path, creating directories in cwd.

**Approach**:

1. Add a helper to `src/util/index.ts`:

   ```ts
   import { homedir } from "node:os";

   export function getHome(): string {
     const home = process.env.HOME ?? homedir();
     if (!home) {
       throw new AgentctlError(
         "Cannot determine home directory. Set the HOME environment variable.",
       );
     }
     return home;
   }
   ```

2. Replace all `process.env.HOME ?? "~"` with `getHome()`.

   Locations:
   - `src/util/index.ts:69` — `globalConfigDir()`
   - `src/adapters/claude.ts:83` — `resolveInstallPaths()`
   - `src/adapters/opencode.ts:82` — `globalConfigDir()`
   - `src/cli/init.ts:77` — `runInit()`

**Files changed**:
- Modified: `src/util/index.ts`
- Modified: `src/adapters/claude.ts`
- Modified: `src/adapters/opencode.ts`
- Modified: `src/cli/init.ts`

**Tests affected**: Tests that set HOME should still pass. Tests running in isolated environments may need to explicitly set HOME in the tmux session setup (check `helpers.ts` — it already sets HOME).

---

## 4. Remove `--project-only`

**Problem**: The `--project-only` flag is wired through the CLI into `SyncCommandOptions` but is never read or acted upon. It's a phantom feature.

**Approach**:

1. Remove `--project-only` from the sync command definition in `src/cli/index.ts`.
2. Remove `projectOnly` from the `SyncCommandOptions` interface in `src/cli/sync.ts`.
3. Remove the `projectOnly` field from the `.action()` handler.

**Files changed**:
- Modified: `src/cli/index.ts`
- Modified: `src/cli/sync.ts`

**Tests affected**: No test cases use `--project-only`. Clean removal.

---

## 5. Validate Agent Names

**Problem**: Agent names from `agent.json` are used directly in file paths. A crafted name like `../../../etc/crontab` would write outside the project directory.

**Approach**:

1. Add a regex constraint to `AgentManifestSchema` in `src/resources/agents/schema.ts`:

   ```ts
   export const AgentManifestSchema = z.object({
     version: z.number().default(1),
     name: z.string().regex(
       /^[a-zA-Z0-9_-]+$/,
       "Agent name must contain only alphanumeric characters, hyphens, and underscores",
     ),
     // ... rest unchanged
   });
   ```

2. This validates on load (`loadAgentsFromDir`), on import (`runInit`), and on any future creation path.

3. The directory name under `.agentctl/agents/` is also the source of truth for the agent name in `loadAgentsFromDir`. Consider also validating the directory name matches the manifest `name` field, but that's a separate concern — the schema validation on `name` is the security fix.

**Files changed**:
- Modified: `src/resources/agents/schema.ts`

**Tests affected**: Any fixture with a non-conforming agent name would fail. Current fixtures use `"reviewer"` — fine. If future fixtures test invalid names, they should expect Zod validation errors.

---

## 6. Prompt Files: Pass the File, Not the Content

**Problem**: Both adapters read the entire prompt file into memory and pass the content as a CLI argument. This breaks on large files (shell arg limits ~128KB) and is semantically wrong — the harness should read the file.

**Approach**:

The fix is adapter-specific because each harness has its own mechanism:

**Claude Code** (`src/adapters/claude.ts`):

The `claude` CLI supports `-p` for inline prompts. For file-based prompts, the idiomatic approach is to read the file and pass it via stdin or use the file path convention. Check current `claude` CLI docs for a `--prompt-file` flag. If one exists, use it directly. If not, pipe the file content via stdin instead of passing it as an arg:

```ts
// Option A: if claude has --prompt-file (preferred)
if (input.promptFile) {
  args.push("--prompt-file", input.promptFile);
}

// Option B: pipe via stdin
return {
  command: "claude",
  args,
  stdin: input.promptFile ? fs.createReadStream(input.promptFile) : undefined,
  // ...
};
```

Research is needed here — check `claude --help` or docs for the current flag. The test cases should tell us what's expected: case 04 (`headless-prompt-file`) checks the dry-run output for the prompt content being in the command. That test expectation will need updating.

**OpenCode** (`src/adapters/opencode.ts`):

`opencode run <prompt>` takes the prompt as a positional arg. Same issue. Check if `opencode` has a file-based alternative. If not, pipe via stdin.

**General pattern**:

1. Remove `readTextFile` calls from both adapters' `buildRunCommand`.
2. Add `promptFile?: string` to `CommandSpec` to let the CLI layer handle file reading and piping.
3. In `src/cli/run.ts`, if `spec.promptFile` is set, pipe it via stdin:

   ```ts
   const child = spawn(spec.command, spec.args, {
     stdio: ["pipe", "inherit", "inherit"],  // stdin is now a pipe
     env: { ...process.env, ...spec.env },
     cwd: spec.cwd,
   });

   if (spec.promptFile) {
     const stream = fs.createReadStream(spec.promptFile);
     stream.pipe(child.stdin!);
   }
   ```

4. If a harness has native `--prompt-file` support, the adapter can use that instead. The adapter decides the mechanism.

**Files changed**:
- Modified: `src/adapters/base.ts` — add `promptFile?: string` to `CommandSpec`
- Modified: `src/adapters/claude.ts` — remove `readTextFile` from `buildRunCommand`, use file path or stdin
- Modified: `src/adapters/opencode.ts` — same
- Modified: `src/cli/run.ts` — handle stdin piping for prompt files

**Tests affected**:
- Case 04 (`headless-prompt-file`) dry-run expectations change — the command should show a file reference, not inline content.
- Case 19 (`dry-run-full-composition`) may need updating if it checks prompt content in the dry-run output.
- Live tests for cases 04 and 07 should still work — the harness still receives the prompt, just via a different channel.

---

## 7. Deduplicate Sync Logic

**Problem**: `ClaudeAdapter.sync()` and `OpenCodeAdapter.sync()` are ~55 lines of nearly identical code. The only differences are `resolveInstallPaths()` and `renderAgent()`.

**Approach**:

1. Create `src/adapters/sync-utils.ts` with a shared sync implementation:

   ```ts
   export async function syncAgents(options: {
     agents: Map<string, Agent>;
     context: SyncContext;
     projectAgentsDir: string;
     renderAgent: (input: RenderAgentInput) => Promise<RenderedFile[]>;
   }): Promise<SyncResult> {
     const { agents, context, projectAgentsDir, renderAgent } = options;
     const actions: SyncFileAction[] = [];
     const warnings: string[] = [];

     for (const [name, agent] of agents) {
       const rendered = await renderAgent({ agent, context });
       for (const file of rendered) {
         const targetPath = path.join(projectAgentsDir, file.relativePath);
         const existing = await readTextFile(targetPath);

         if (existing !== null && !context.managedNames.has(name)) {
           if (!context.force) {
             warnings.push(
               `Conflict: "${name}" exists in ${projectAgentsDir} but is not managed by agentctl. Use --force to overwrite.`,
             );
             actions.push({ path: targetPath, action: "skip", reason: "unmanaged conflict" });
             continue;
           }
         }

         if (existing === file.content) {
           actions.push({ path: targetPath, action: "skip", reason: "unchanged" });
           continue;
         }

         if (!context.dryRun) {
           await fs.mkdir(path.dirname(targetPath), { recursive: true });
           await fs.writeFile(targetPath, file.content, "utf-8");
         }

         actions.push({ path: targetPath, action: "write" });
       }
     }

     // Detect unmanaged agents
     if (await fileExists(projectAgentsDir)) {
       const entries = await fs.readdir(projectAgentsDir, { withFileTypes: true });
       for (const entry of entries) {
         if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
         const name = entry.name.replace(/\.md$/, "");
         if (!agents.has(name)) {
           warnings.push(`Unmanaged agent "${name}" found in ${projectAgentsDir}`);
         }
       }
     }

     return { actions, warnings };
   }
   ```

2. Each adapter's `sync()` becomes a thin wrapper:

   ```ts
   async sync(context: SyncContext): Promise<SyncResult> {
     const paths = this.resolveInstallPaths(context);
     return syncAgents({
       agents: context.agents,
       context,
       projectAgentsDir: paths.projectAgentsDir,
       renderAgent: (input) => this.renderAgent(input),
     });
   }
   ```

**Files changed**:
- New: `src/adapters/sync-utils.ts`
- Modified: `src/adapters/claude.ts` — replace `sync()` body with delegation
- Modified: `src/adapters/opencode.ts` — same

**Tests affected**: All sync tests and dry-run tests should pass unchanged — the behavior is identical, just the code location changes. The unit test `render-frontmatter.test.ts` is unaffected.

---

## Execution Order

The items are ordered by dependency:

```
1. Error Infrastructure     ← foundation, everything else depends on AgentctlError
2. Config Parse Failure     ← uses AgentctlError, changes readJsonFile
3. HOME Not Set             ← uses AgentctlError
4. Remove --project-only    ← independent, trivial
5. Validate Agent Names     ← independent, trivial
6. Prompt File Fix          ← uses AgentctlError, touches adapters + CLI
7. Deduplicate Sync         ← independent, can be done last
```

Items 4 and 5 are small enough to combine into one commit. Item 6 requires research into current harness CLI capabilities before implementation.

---

## Out of Scope (from the review, deferred)

- **Agent deletion in sync**: The `SyncFileAction` type already supports `"delete"` but no logic produces it. This needs design work (what happens when an agent is removed from `.agentctl/agents/`?) and is deferred.
- **Concurrent sync locking**: No file-level locking on sync manifest. Acceptable for v0.1 given single-user CLI usage.
- **Hand-rolled YAML parsers**: Replacing with `js-yaml` would be an improvement but isn't blocking. The current parsers handle the subset they need.
- **`readJsonFile` permission error distinction**: The fix in item 2 handles ENOENT vs other errors, which covers the most important case.
