import { constants } from "node:fs";
import { access, mkdtemp, open, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPiSubagentsInstallation } from "./pi-subagents.js";
import { runProcess } from "./process.js";

export interface DoctorCheck {
  readonly name: string;
  readonly status: "ok" | "missing" | "unsupported" | "unverified";
  readonly detail: string;
  readonly setup?: string;
}

async function commandCheck(name: string, executable: string, versionArguments: readonly string[], setup: string): Promise<DoctorCheck> {
  try {
    const result = await runProcess({ executable, arguments: versionArguments, cwd: process.cwd(), timeoutMs: 10_000, maxOutputBytes: 65_536 });
    const detail = `${result.stdout}\n${result.stderr}`.trim().split("\n")[0] ?? "version unavailable";
    return result.exitCode === 0
      ? { name, status: "ok", detail }
      : { name, status: "unsupported", detail: `${executable} returned ${result.exitCode}`, setup };
  } catch {
    return { name, status: "missing", detail: `${executable} was not found`, setup };
  }
}

async function authenticationCheck(name: string, executable: string, arguments_: readonly string[]): Promise<DoctorCheck> {
  try {
    const result = await runProcess({ executable, arguments: arguments_, cwd: process.cwd(), timeoutMs: 10_000, maxOutputBytes: 65_536 });
    return {
      name,
      status: result.exitCode === 0 ? "ok" : "unverified",
      detail: result.exitCode === 0 ? "authentication is configured" : "authentication is absent or could not be verified",
    };
  } catch {
    return { name, status: "missing", detail: `${executable} is unavailable` };
  }
}

async function filesystemCheck(): Promise<DoctorCheck> {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-doctor-"));
  try {
    const source = join(directory, "source");
    const target = join(directory, "target");
    const handle = await open(source, "wx", 0o600);
    await handle.writeFile("probe\n");
    await handle.sync();
    await handle.close();
    await rename(source, target);
    await access(target, constants.R_OK | constants.W_OK);
    return { name: "filesystem", status: "ok", detail: "exclusive creation, flush, and atomic replacement succeeded" };
  } catch (error) {
    return { name: "filesystem", status: "unsupported", detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runDoctor(): Promise<readonly DoctorCheck[]> {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const checks: DoctorCheck[] = [{
    name: "node",
    status: major >= 24 ? "ok" : "unsupported",
    detail: process.version,
    ...(major >= 24 ? {} : { setup: "Install Node.js 24 or newer; Autopilot never installs runtimes." }),
  }, process.platform === "win32" ? {
    name: "process-supervision",
    status: "unsupported",
    detail: "Windows native containment is not packaged; direct CLI execution is session-scoped and continuity loss requires operator recovery",
  } : {
    name: "process-supervision",
    status: "ok",
    detail: "POSIX attempt-scoped process-group supervision and restart reattachment are available",
  }];
  const piSubagents = findPiSubagentsInstallation();
  checks.push(
    await commandCheck("git", "git", ["--version"], "Install Git and make it available on PATH."),
    await commandCheck("pi", "pi", ["--version"], "Install Pi only if you plan to use the Pi adapter."),
    piSubagents === undefined
      ? { name: "pi-subagents", status: "unverified", detail: "version 0.53.0 or newer was not found; Pi will use its distinct direct CLI fallback", setup: "Install and enable pi-subagents through Pi to use the process-local backend; Autopilot never installs it." }
      : { name: "pi-subagents", status: "ok", detail: `${piSubagents.version} at ${piSubagents.extensionPath}; process-local owner availability is checked by the Autopilot Pi extension before launch` },
    await commandCheck("claude-code", "claude", ["--version"], "Install Claude Code only if you plan to use that adapter."),
    await commandCheck("codex", "codex", ["--version"], "Install Codex only if you plan to use that adapter."),
    await commandCheck(
      "codex-app-server",
      "codex",
      ["app-server", "--help"],
      "Install a Codex version with app-server support only if you plan to use that adapter.",
    ),
    await commandCheck("opencode", "opencode", ["--version"], "Install OpenCode only if you plan to use that adapter."),
    await commandCheck(
      "opencode-server",
      "opencode",
      ["serve", "--help"],
      "Install an OpenCode version with server support only if you plan to use that adapter.",
    ),
    await commandCheck("github-cli", "gh", ["--version"], "Install gh only for GitHub delivery."),
    await commandCheck("gitlab-cli", "glab", ["--version"], "Install glab only for GitLab delivery."),
    await authenticationCheck("claude-auth-config", "claude", ["auth", "status"]),
    await authenticationCheck("codex-auth-config", "codex", ["login", "status"]),
    await authenticationCheck("opencode-auth-config", "opencode", ["providers", "list"]),
    await authenticationCheck("github-auth", "gh", ["auth", "status"]),
    await authenticationCheck("gitlab-auth", "glab", ["auth", "status"]),
    await filesystemCheck(),
  );
  return checks;
}
