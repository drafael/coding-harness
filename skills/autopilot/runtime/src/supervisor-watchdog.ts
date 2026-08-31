import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./journal.js";
import {
  readSupervisedCompletion,
  readSupervisedRequest,
  readSupervisedStatus,
  supervisedCancellationAt,
  supervisorArtifactNames,
  supervisorRequestHash,
} from "./process-supervisor.js";
import { terminateProcessTree } from "./process.js";

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

async function quiesceExecution(supervisorPid: number, executable: string): Promise<void> {
  if (process.platform === "win32") {
    throw new Error("runtime-owned process supervision is unavailable on Windows");
  }
  await terminateProcessTree(supervisorPid, executable);
}

async function lastActivityAt(directory: string, startedAt: string): Promise<number> {
  try {
    const value = Number.parseInt(await readFile(join(directory, supervisorArtifactNames.activityPulse), "utf8"), 10);
    return Number.isSafeInteger(value) ? value : Date.parse(startedAt);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return Date.parse(startedAt);
    }
    throw error;
  }
}

async function publishWatchdogFailure(directory: string, error: unknown): Promise<void> {
  const request = await readSupervisedRequest(directory);
  const status = await readSupervisedStatus(directory);
  if (request === undefined || status === undefined) {
    return;
  }
  const requestHash = supervisorRequestHash(request);
  if (status.executionId !== request.executionId || status.requestHash !== requestHash
    || ["completed", "failed", "cancelled", "timed-out", "state-unknown"].includes(status.state)) {
    return;
  }
  const failedAt = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  try {
    await writeJsonAtomic(join(directory, supervisorArtifactNames.watchdogError), {
      schemaVersion: 1,
      executionId: request.executionId,
      requestHash,
      failedAt,
      error: message,
    });
  } catch {
    // The exact-identity state-unknown status remains the caller-visible fail-closed path.
  }
  try {
    const current = await readSupervisedStatus(directory);
    if (current === undefined || current.executionId !== request.executionId || current.requestHash !== requestHash
      || ["completed", "failed", "cancelled", "timed-out", "state-unknown"].includes(current.state)) {
      return;
    }
    await writeJsonAtomic(join(directory, supervisorArtifactNames.status), {
      ...current,
      state: "state-unknown",
      updatedAt: failedAt,
      completedAt: failedAt,
      exitCode: 1,
    });
  } catch {
    // The durable watchdog error artifact is observed independently when status replacement still cannot complete.
  }
}

async function main(): Promise<void> {
  const directory = process.argv[2];
  if (directory === undefined) {
    return;
  }
  const request = await readSupervisedRequest(directory);
  if (request === undefined) {
    return;
  }
  const requestHash = supervisorRequestHash(request);
  const initialStatus = await readSupervisedStatus(directory);
  if (initialStatus === undefined || initialStatus.executionId !== request.executionId
    || initialStatus.requestHash !== requestHash) {
    return;
  }
  const supervisorPid = initialStatus.supervisorPid;
  await writeJsonAtomic(join(directory, supervisorArtifactNames.watchdogReady), {
    schemaVersion: 1,
    executionId: request.executionId,
    requestHash,
    supervisorPid,
    readyAt: new Date().toISOString(),
  });
  while (true) {
    const status = await readSupervisedStatus(directory);
    if (status === undefined || status.executionId !== request.executionId || status.requestHash !== requestHash) {
      return;
    }
    if (["completed", "failed", "cancelled", "timed-out", "state-unknown"].includes(status.state)) {
      return;
    }
    const now = Date.now();
    const completion = await readSupervisedCompletion(directory);
    const cancellationAt = await supervisedCancellationAt(directory, request.executionId, requestHash);
    const absoluteDeadlineAt = Date.parse(request.deadline);
    const idleDeadlineAt = await lastActivityAt(directory, status.startedAt) + request.idleTimeoutMs;
    const supervisorGone = !processExists(supervisorPid);
    const causes = [
      ...(completion === undefined ? [] : [{ at: completion.completedAt, priority: 3, state: completion.state, message: "attempt harness exited and its process group was quiesced" }]),
      ...(cancellationAt === undefined ? [] : [{ at: cancellationAt, priority: 0, state: "cancelled" as const, message: "attempt cancellation was requested" }]),
      { at: absoluteDeadlineAt, priority: 1, state: "timed-out" as const, message: "attempt harness exceeded its absolute deadline" },
      { at: idleDeadlineAt, priority: 2, state: "timed-out" as const, message: "attempt harness exceeded its idle deadline" },
      ...(supervisorGone ? [{ at: now, priority: 4, state: "failed" as const, message: "attempt supervisor exited before publishing a terminal observation" }] : []),
    ].filter(({ at }) => at <= now).sort((left, right) => left.at - right.at || left.priority - right.priority);
    const cause = causes[0];
    if (cause !== undefined) {
      const state = cause.state;
      const message = cause.message;
      const completionSelected = completion !== undefined && cause.at === completion.completedAt && cause.priority === 3;
      let terminalState: "cancelled" | "completed" | "failed" | "timed-out" | "state-unknown" = state;
      let terminalMessage = message;
      try {
        await quiesceExecution(supervisorPid, request.executable);
      } catch (error) {
        terminalState = "state-unknown";
        terminalMessage = error instanceof Error ? error.message : String(error);
      }
      const completedAt = new Date().toISOString();
      if (terminalState !== "state-unknown") {
        await writeJsonAtomic(
          join(directory, supervisorArtifactNames.result),
          completionSelected ? completion.result : {
            exitCode: terminalState === "failed" ? 1 : 124,
            stdout: "",
            stderr: terminalMessage,
            truncated: false,
          },
        );
      }
      await writeJsonAtomic(join(directory, supervisorArtifactNames.status), {
        ...status,
        state: terminalState,
        updatedAt: completedAt,
        completedAt,
        exitCode: completionSelected
          ? completion.result.exitCode
          : terminalState === "failed" || terminalState === "state-unknown" ? 1 : 124,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

await main().catch(async (error: unknown) => {
  const directory = process.argv[2];
  if (directory !== undefined) {
    try {
      await publishWatchdogFailure(directory, error);
    } catch {
      // Callers retain their bounded execution-state-unknown timeout if even fatal publication is unavailable.
    }
  }
  process.exitCode = 1;
});
