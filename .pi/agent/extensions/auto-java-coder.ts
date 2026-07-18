import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

const JAVA_PROJECT_MARKERS = [
    "pom.xml",
    "mvnw",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradlew",
];

const IGNORED_SOURCE_DIRECTORIES = new Set([
    ".git",
    ".gradle",
    ".idea",
    ".mvn",
    "build",
    "node_modules",
    "out",
    "target",
]);

async function exists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function hasJavaProjectMarker(directory: string): Promise<boolean> {
    const checks = JAVA_PROJECT_MARKERS.map((marker) => exists(join(directory, marker)));
    return (await Promise.all(checks)).some(Boolean);
}

async function containsJavaSource(directory: string): Promise<boolean> {
    let entries;

    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return false;
    }

    if (entries.some((entry) => entry.isFile() && entry.name.endsWith(".java"))) {
        return true;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || IGNORED_SOURCE_DIRECTORIES.has(entry.name)) {
            continue;
        }

        if (await containsJavaSource(join(directory, entry.name))) {
            return true;
        }
    }

    return false;
}

async function hasGitJavaSource(repositoryRoot: string): Promise<boolean> {
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
                "--",
                "*.java",
            ],
            { encoding: "utf8", maxBuffer: 1024 },
        );
        return result.stdout.trim().length > 0;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            return true;
        }
        return containsJavaSource(repositoryRoot);
    }
}

export async function findJavaProjectRoot(cwd: string): Promise<string | undefined> {
    const startingDirectory = resolve(cwd);
    let directory = startingDirectory;

    while (true) {
        if (await hasJavaProjectMarker(directory)) {
            return directory;
        }

        if (await exists(join(directory, ".git"))) {
            return (await hasGitJavaSource(directory)) ? directory : undefined;
        }

        const parent = dirname(directory);
        if (parent === directory) {
            break;
        }
        directory = parent;
    }

    return (await containsJavaSource(startingDirectory)) ? startingDirectory : undefined;
}

function removeFrontmatter(content: string): string {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export default function autoJavaCoder(pi: ExtensionAPI) {
    let detectionComplete = false;
    let javaProjectRoot: string | undefined;
    let missingSkillReported = false;

    pi.on("session_start", async (_event, ctx) => {
        ctx.ui.setStatus("auto-java-coder", undefined);
        javaProjectRoot = await findJavaProjectRoot(ctx.cwd);
        detectionComplete = true;
        missingSkillReported = false;
    });

    pi.on("before_agent_start", async (event, ctx) => {
        if (!detectionComplete) {
            javaProjectRoot = await findJavaProjectRoot(event.systemPromptOptions.cwd);
            detectionComplete = true;
        }

        if (!javaProjectRoot) {
            return;
        }

        const discoveredSkill = event.systemPromptOptions.skills?.find((skill) => skill.name === "java-coder");
        const skillPath = discoveredSkill?.filePath ?? join(homedir(), ".agents", "skills", "java-coder", "SKILL.md");

        let skillContent: string;
        try {
            skillContent = removeFrontmatter(await readFile(skillPath, "utf8"));
        } catch (error) {
            if (!missingSkillReported) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(`Could not auto-activate java-coder: ${message}`, "error");
                missingSkillReported = true;
            }
            return;
        }

        return {
            systemPrompt: `${event.systemPrompt}

## Automatically Activated Java-Coder Skill

The current repository is a Java codebase (${javaProjectRoot}). The java-coder skill below is mandatory for every task in this repository, including planning, investigation, implementation, debugging, review, testing, dependency/build work, and Java-related documentation. It remains active for this entire agent run even when the user does not explicitly mention Java.

Skill root: ${dirname(skillPath)}
Resolve relative references in the skill against that directory and load the relevant references when the task matches them.

<java-coder-skill>
${skillContent}
</java-coder-skill>
`,
        };
    });
}
