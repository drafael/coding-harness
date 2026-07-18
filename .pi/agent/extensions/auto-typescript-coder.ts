import { execFile } from "node:child_process";
import { constants, type Dirent } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

const IGNORED_SOURCE_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "cdk.out",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const TYPESCRIPT_DECLARATION_SUFFIXES = [".d.ts", ".d.mts", ".d.cts"];
const TYPESCRIPT_SOURCE_SUFFIXES = [".ts", ".tsx", ".mts", ".cts"];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isTypeScriptSource(path: string): boolean {
  const fileName = basename(path);
  return (
    TYPESCRIPT_SOURCE_SUFFIXES.some((suffix) => fileName.endsWith(suffix)) &&
    !TYPESCRIPT_DECLARATION_SUFFIXES.some((suffix) =>
      fileName.endsWith(suffix),
    )
  );
}

async function hasTypeScriptConfig(directory: string): Promise<boolean> {
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }

  return entries.some(
    (entry) =>
      entry.isFile() &&
      entry.name.startsWith("tsconfig") &&
      entry.name.endsWith(".json"),
  );
}

function hasDependency(
  packageJson: Record<string, unknown>,
  dependencyName: string,
): boolean {
  return [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]
    .map((field) => packageJson[field])
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null,
    )
    .some((dependencies) => dependencyName in dependencies);
}

async function packageUsesTypeScript(directory: string): Promise<boolean> {
  try {
    const content = await readFile(join(directory, "package.json"), "utf8");
    const packageJson = JSON.parse(content) as Record<string, unknown>;
    return hasDependency(packageJson, "typescript");
  } catch {
    return false;
  }
}

async function hasTypeScriptProjectMarker(directory: string): Promise<boolean> {
  const [hasConfig, usesTypeScript] = await Promise.all([
    hasTypeScriptConfig(directory),
    packageUsesTypeScript(directory),
  ]);
  return hasConfig || usesTypeScript;
}

async function containsTypeScriptSource(directory: string): Promise<boolean> {
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }

  if (
    entries.some(
      (entry) => entry.isFile() && isTypeScriptSource(entry.name),
    )
  ) {
    return true;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_SOURCE_DIRECTORIES.has(entry.name)) {
      continue;
    }

    if (await containsTypeScriptSource(join(directory, entry.name))) {
      return true;
    }
  }

  return false;
}

async function hasGitTypeScriptSource(
  repositoryRoot: string,
): Promise<boolean> {
  try {
    const result = await execFileAsync(
      "git",
      [
        "-C",
        repositoryRoot,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "*.ts",
        "*.tsx",
        "*.mts",
        "*.cts",
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    return result.stdout.split("\0").some(isTypeScriptSource);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return true;
    }
    return containsTypeScriptSource(repositoryRoot);
  }
}

export async function findTypeScriptProjectRoot(
  cwd: string,
): Promise<string | undefined> {
  const startingDirectory = resolve(cwd);
  let directory = startingDirectory;

  while (true) {
    if (await hasTypeScriptProjectMarker(directory)) {
      return directory;
    }

    if (await exists(join(directory, ".git"))) {
      return (await hasGitTypeScriptSource(directory)) ? directory : undefined;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  return (await containsTypeScriptSource(startingDirectory))
    ? startingDirectory
    : undefined;
}

function removeFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export default function autoTypeScriptCoder(pi: ExtensionAPI) {
  let detectionComplete = false;
  let typeScriptProjectRoot: string | undefined;
  let missingSkillReported = false;

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("auto-typescript-coder", undefined);
    typeScriptProjectRoot = await findTypeScriptProjectRoot(ctx.cwd);
    detectionComplete = true;
    missingSkillReported = false;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!detectionComplete) {
      typeScriptProjectRoot = await findTypeScriptProjectRoot(
        event.systemPromptOptions.cwd,
      );
      detectionComplete = true;
    }

    if (!typeScriptProjectRoot) {
      return;
    }

    const discoveredSkill = event.systemPromptOptions.skills?.find(
      (skill) => skill.name === "typescript-coder",
    );
    const skillPath =
      discoveredSkill?.filePath ??
      join(homedir(), ".agents", "skills", "typescript-coder", "SKILL.md");

    let skillContent: string;
    try {
      skillContent = removeFrontmatter(await readFile(skillPath, "utf8"));
    } catch (error) {
      if (!missingSkillReported) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Could not auto-activate typescript-coder: ${message}`,
          "error",
        );
        missingSkillReported = true;
      }
      return;
    }

    return {
      systemPrompt: `${event.systemPrompt}

## Automatically Activated TypeScript-Coder Skill

The current repository is a TypeScript or mixed TypeScript codebase (${typeScriptProjectRoot}). The typescript-coder skill below is mandatory for every task in this repository, including planning, investigation, implementation, debugging, review, testing, dependency/build work, CI, security analysis, and TypeScript-related documentation. It remains active for this entire agent run even when the user does not explicitly mention TypeScript.

Skill root: ${dirname(skillPath)}
Resolve relative references in the skill against that directory and load the relevant references when the task matches them.

<typescript-coder-skill>
${skillContent}
</typescript-coder-skill>
`,
    };
  });
}
