import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileExists } from "../util/index.js";

const execFileAsync = promisify(execFile);

export interface SkillshareDetection {
  installed: boolean;
  version: string | null;
}

export interface SkillInfo {
  name: string;
  description: string | null;
  sourcePath: string;
}

export async function detectSkillshare(): Promise<SkillshareDetection> {
  try {
    const { stdout } = await execFileAsync("skillshare", ["--version"]);
    const version = stdout.trim().replace(/^skillshare\s*/i, "") || null;
    return { installed: true, version };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * Ensure skillshare is available. Returns binary path.
 * Downloads to ~/.agentctl/bin/skillshare if not found.
 */
export async function ensureSkillshare(): Promise<string> {
  // Already installed?
  try {
    await execFileAsync("skillshare", ["--version"]);
    return "skillshare";
  } catch {
    // not on PATH
  }

  // Install via official install script
  console.log("Installing skillshare...");
  await installSkillshare();
  return "skillshare";
}

async function installSkillshare(): Promise<void> {
  const { execFile: execFileCb } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFileCb);

  const { stdout } = await exec("bash", [
    "-c",
    "curl -fsSL https://raw.githubusercontent.com/runkids/skillshare/main/install.sh | sh",
  ]);
  if (stdout.trim()) {
    console.log(stdout.trim());
  }
}

/**
 * Write .skillshare/config.yaml for a project.
 */
export async function writeSkillshareConfig(
  projectRoot: string,
  targets: string[],
): Promise<void> {
  const configDir = path.join(projectRoot, ".skillshare");
  await fs.mkdir(configDir, { recursive: true });

  const targetLines = targets.map((t) => `  - ${t}`).join("\n");
  const content = `source: .agentctl/skills\ntargets:\n${targetLines}\n`;

  await fs.writeFile(path.join(configDir, "config.yaml"), content, "utf-8");
}

/**
 * Detect which harness targets are present in the project.
 */
export async function detectTargets(projectRoot: string): Promise<string[]> {
  const targets: string[] = [];
  if (await fileExists(path.join(projectRoot, ".claude"))) {
    targets.push("claude");
  }
  if (await fileExists(path.join(projectRoot, ".opencode"))) {
    targets.push("opencode");
  }
  // Default to claude if nothing detected
  if (targets.length === 0) {
    targets.push("claude");
  }
  return targets;
}

/**
 * Read .skillshare/config.yaml and return the source path (if it points to .agentctl/skills).
 */
export async function readSkillshareConfig(
  projectRoot: string,
): Promise<{ source: string; exists: boolean }> {
  const configPath = path.join(projectRoot, ".skillshare", "config.yaml");
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const sourceMatch = content.match(/^source:\s*(.+)$/m);
    return {
      exists: true,
      source: sourceMatch ? sourceMatch[1].trim() : "",
    };
  } catch {
    return { exists: false, source: "" };
  }
}

/**
 * List skills from .agentctl/skills/ by reading SKILL.md frontmatter.
 */
export async function listSkills(
  skillsDir: string,
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry);
    const stat = await fs.stat(skillPath);
    if (!stat.isDirectory()) continue;

    const skillMd = path.join(skillPath, "SKILL.md");
    try {
      const content = await fs.readFile(skillMd, "utf-8");
      const frontmatter = parseSkillFrontmatter(content);
      skills.push({
        name: (frontmatter.name as string) ?? entry,
        description: (frontmatter.description as string) ?? null,
        sourcePath: skillPath,
      });
    } catch {
      // Directory exists but no SKILL.md — skip
    }
  }

  return skills;
}

function parseSkillFrontmatter(
  content: string,
): Record<string, unknown> {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const frontmatter: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    // Skip nested keys (indented lines like metadata fields)
    if (line.startsWith(" ") || line.startsWith("\t")) continue;
    let value: string = line.slice(colonIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return frontmatter;
}

/**
 * Check if skills in .agentctl/skills/ are synced to harness skill dirs.
 */
export async function checkSkillsSync(
  projectRoot: string,
  targets: string[],
): Promise<{ synced: boolean; details: string }> {
  const skillsDir = path.join(projectRoot, ".agentctl", "skills");
  const skills = await listSkills(skillsDir);

  if (skills.length === 0) {
    return { synced: true, details: "No skills to sync" };
  }

  const targetPaths: Record<string, string> = {
    claude: path.join(projectRoot, ".claude", "skills"),
    opencode: path.join(projectRoot, ".opencode", "skills"),
  };

  for (const target of targets) {
    const targetDir = targetPaths[target];
    if (!targetDir) continue;

    for (const skill of skills) {
      const skillName = path.basename(skill.sourcePath);
      const targetSkillDir = path.join(targetDir, skillName);
      if (!(await fileExists(targetSkillDir))) {
        return {
          synced: false,
          details: `${skillName} not found in ${target} skills dir`,
        };
      }
    }
  }

  return { synced: true, details: "All skills synced" };
}
