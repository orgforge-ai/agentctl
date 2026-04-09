import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { AgentctlError } from "../errors.js";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AgentctlError(
      `Failed to read ${filePath}: ${(err as Error).message}`,
    );
  }
}

export async function writeJsonFile(
  filePath: string,
  data: unknown,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function writeTextFile(
  filePath: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function findProjectRoot(
  startDir: string = process.cwd(),
): Promise<string> {
  let dir = path.resolve(startDir);
  while (true) {
    if (
      (await fileExists(path.join(dir, ".agentctl"))) ||
      (await fileExists(path.join(dir, ".git")))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export function getHome(): string {
  const home = process.env.HOME ?? homedir();
  if (!home) {
    throw new AgentctlError(
      "Cannot determine home directory. Set the HOME environment variable.",
    );
  }
  return home;
}

export function globalConfigDir(): string {
  return path.join(getHome(), ".agentctl");
}

export function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}
