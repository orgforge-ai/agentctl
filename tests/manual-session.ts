/**
 * Launch an interactive harness session in an isolated test environment.
 *
 * Usage: npx tsx tests/manual-session.ts <harness>
 * Example: npx tsx tests/manual-session.ts claude
 *
 * Creates the same isolated environment the tests use (synthetic HOME,
 * fixture project dir, credentials, onboarding bypass), then attaches
 * you to the tmux session so you can interact with the harness directly.
 *
 * The output persists at .test-output/_manual/<harness>/ so any config
 * created during the session can be inspected or copied into fixtures.
 */

import { execSync } from "node:child_process";
import { createTestProject, killSession } from "./helpers.js";

const harness = process.argv[2];
if (!harness) {
  console.error("Usage: npx tsx tests/manual-session.ts <harness>");
  process.exit(1);
}

const session = `agentctl-manual-${harness}`;

// Kill any existing manual session
try {
  execSync(`tmux kill-session -t '${session}' 2>/dev/null`);
} catch {
  // No prior session
}

// Use the same environment setup as tests
const env = await createTestProject("_manual", harness);

console.log("Environment:");
console.log(`  HOME=${env.homeDir}`);
console.log(`  CWD=${env.projectDir}`);
console.log(`  Session=${session}`);
console.log();
console.log(`  TMP=${env.tmpDir}`);
console.log();
console.log("After exiting, inspect output at:");
console.log(`  ${env.outputDir}`);
console.log(`  ${env.tmpDir}`);
console.log();

// Create tmux session with isolated env
execSync(`tmux new-session -d -s '${session}' -x 120 -y 40`);
execSync(
  `tmux send-keys -t '${session}' 'unset OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_API_KEY AZURE_OPENAI_API_KEY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY && export HOME=${env.homeDir} && cd ${env.projectDir}' Enter`
);

// Attach (this blocks until the user detaches or exits)
try {
  execSync(`tmux attach-session -t '${session}'`, { stdio: "inherit" });
} catch {
  // User detached or session ended
}
