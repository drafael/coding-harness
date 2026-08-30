import { constants } from "node:fs";
import { access, lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AutopilotError } from "./errors.js";
import { sha256 } from "./json.js";
import { runChecked, runProcess } from "./process.js";
async function git(repositoryRoot, arguments_) {
    return (await runChecked({ executable: "git", arguments: arguments_, cwd: repositoryRoot })).stdout.trim();
}
export async function resolveCommit(repositoryRoot, ref) {
    return await git(repositoryRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
}
export async function currentBranch(repositoryRoot) {
    return await git(repositoryRoot, ["branch", "--show-current"]);
}
export async function inspectCommit(repositoryRoot, commit) {
    const [parents, treeIdentity, message] = await Promise.all([
        git(repositoryRoot, ["show", "-s", "--format=%P", commit]),
        git(repositoryRoot, ["show", "-s", "--format=%T", commit]),
        git(repositoryRoot, ["show", "-s", "--format=%B", commit]),
    ]);
    return {
        parents: parents.length === 0 ? [] : parents.split(" "),
        treeIdentity,
        message,
    };
}
export async function inspectRepository(repositoryRoot) {
    const [headCommit, status] = await Promise.all([
        resolveCommit(repositoryRoot, "HEAD"),
        runChecked({ executable: "git", arguments: ["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd: repositoryRoot }),
    ]);
    return { headCommit, clean: status.stdout.length === 0 };
}
export async function validateBaseCommit(charter) {
    const observed = await resolveCommit(charter.repository.root, charter.repository.baseRef);
    if (observed !== charter.repository.baseCommit) {
        throw new AutopilotError("GIT_FAILED", "base reference no longer matches the sealed charter", {
            expected: charter.repository.baseCommit,
            observed,
        });
    }
}
export async function branchExists(repositoryRoot, branchName) {
    const result = await runProcess({
        executable: "git",
        arguments: ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
        cwd: repositoryRoot,
    });
    return result.exitCode === 0;
}
export async function validateBranchName(repositoryRoot, branchName) {
    const result = await runProcess({ executable: "git", arguments: ["check-ref-format", "--branch", branchName], cwd: repositoryRoot });
    if (result.exitCode !== 0) {
        throw new AutopilotError("CHARTER_INVALID", `invalid Git branch name: ${branchName}`);
    }
}
const MAX_WORKTREE_DIRECTORY_BYTES = 200;
const MAX_CANDIDATE_WORKTREE_DIRECTORY_BYTES = 120;
function safeRepositoryName(repositoryRoot) {
    const original = basename(repositoryRoot);
    const normalized = original.replaceAll(/[^A-Za-z0-9._-]+/gu, "-").replaceAll(/^[.-]+|[.-]+$/gu, "") || "repository";
    return normalized === original ? normalized : `${normalized}-${sha256(repositoryRoot).slice(0, 8)}`;
}
function boundedSiblingWorktreePath(repositoryRoot, readableName, identity, maximumDirectoryBytes = MAX_WORKTREE_DIRECTORY_BYTES) {
    const suffix = sha256(identity).slice(0, 16);
    const windowsSafeName = readableName.endsWith(".")
        ? `${readableName.replaceAll(/\.+$/gu, "")}-${suffix}`
        : readableName;
    if (Buffer.byteLength(windowsSafeName) <= maximumDirectoryBytes) {
        return join(dirname(repositoryRoot), windowsSafeName);
    }
    const maximumPrefixLength = maximumDirectoryBytes - suffix.length - 1;
    const prefix = readableName.slice(0, maximumPrefixLength).replaceAll(/[._-]+$/gu, "");
    return join(dirname(repositoryRoot), `${prefix}-${suffix}`);
}
export async function resolveWorktreePath(charter, item) {
    const repositoryRoot = await realpath(charter.repository.root);
    return boundedSiblingWorktreePath(repositoryRoot, `${safeRepositoryName(repositoryRoot)}-autopilot-${charter.runId}-${item.id}`, `${repositoryRoot}\0${charter.runId}\0${item.id}`);
}
async function canonicalGitCommonDirectory(repositoryRoot) {
    return await realpath(await git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
}
export async function assertRegisteredWorktree(repositoryRoot, worktreePath) {
    const [repositoryCommonDirectory, worktreeCommonDirectory, canonicalWorktree, listed] = await Promise.all([
        canonicalGitCommonDirectory(repositoryRoot),
        canonicalGitCommonDirectory(worktreePath),
        realpath(worktreePath),
        git(repositoryRoot, ["worktree", "list", "--porcelain", "-z"]),
    ]);
    const registeredPaths = listed.split("\0")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length));
    const registered = (await Promise.all(registeredPaths.map(async (path) => {
        try {
            return await realpath(path) === canonicalWorktree;
        }
        catch {
            return false;
        }
    }))).some(Boolean);
    if (repositoryCommonDirectory !== worktreeCommonDirectory || !registered) {
        throw new AutopilotError("BRANCH_COLLISION", "managed worktree path is not registered to the charter repository");
    }
}
export async function ensureWorktree(charter, item, baseCommit = charter.repository.baseCommit, ownedCommits = []) {
    await validateBranchName(charter.repository.root, item.branchName);
    const worktreePath = await resolveWorktreePath(charter, item);
    try {
        const status = await lstat(worktreePath);
        if (!status.isDirectory() || status.isSymbolicLink()) {
            throw new AutopilotError("BRANCH_COLLISION", `worktree destination for ${item.id} is not a managed directory`);
        }
        try {
            await assertRegisteredWorktree(charter.repository.root, worktreePath);
            const [branch, headCommit] = await Promise.all([
                git(worktreePath, ["branch", "--show-current"]),
                resolveCommit(worktreePath, "HEAD"),
            ]);
            if (branch !== item.branchName) {
                throw new AutopilotError("BRANCH_COLLISION", `existing worktree for ${item.id} uses branch ${branch}`);
            }
            if (headCommit !== baseCommit && !ownedCommits.includes(headCommit)) {
                throw new AutopilotError("BRANCH_COLLISION", `existing worktree for ${item.id} has an unowned HEAD commit`);
            }
            return worktreePath;
        }
        catch (error) {
            const entries = await readdir(worktreePath);
            if (entries.length > 0) {
                throw error;
            }
            await rm(worktreePath, { recursive: true });
        }
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw error;
        }
    }
    if (await branchExists(charter.repository.root, item.branchName)) {
        const branchCommit = await resolveCommit(charter.repository.root, item.branchName);
        if (branchCommit !== baseCommit && !ownedCommits.includes(branchCommit)) {
            throw new AutopilotError("BRANCH_COLLISION", `branch ${item.branchName} already exists at an unowned commit`);
        }
        await runChecked({ executable: "git", arguments: ["worktree", "add", worktreePath, item.branchName], cwd: charter.repository.root });
    }
    else {
        await runChecked({
            executable: "git",
            arguments: ["worktree", "add", "-b", item.branchName, worktreePath, baseCommit],
            cwd: charter.repository.root,
        });
    }
    return worktreePath;
}
async function changedPaths(worktreePath) {
    const tracked = await runChecked({ executable: "git", arguments: ["diff", "--name-only", "-z", "HEAD"], cwd: worktreePath });
    const untracked = await runChecked({ executable: "git", arguments: ["ls-files", "--others", "--exclude-standard", "-z"], cwd: worktreePath });
    return [...new Set(`${tracked.stdout}${untracked.stdout}`.split("\0").filter((path) => path.length > 0))].sort();
}
function lexicalWithin(path, root) {
    const child = resolve(path);
    const parent = resolve(root);
    const relation = relative(parent, child);
    return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}
export async function assertWritablePaths(worktreePath, changed, writableRoots) {
    const realWorktree = await realpath(worktreePath);
    for (const changedPath of changed) {
        const candidate = resolve(realWorktree, changedPath);
        if (!lexicalWithin(candidate, realWorktree) || !writableRoots.some((root) => lexicalWithin(candidate, resolve(realWorktree, root)))) {
            throw new AutopilotError("CAPABILITY_DENIED", `changed path is outside writable roots: ${changedPath}`);
        }
        try {
            const realCandidate = await realpath(candidate);
            if (!lexicalWithin(realCandidate, realWorktree)) {
                throw new AutopilotError("CAPABILITY_DENIED", `changed path resolves outside worktree: ${changedPath}`);
            }
        }
        catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
                throw error;
            }
        }
    }
}
export async function observeRepository(worktreePath, managedBranches = []) {
    const [headCommit, branchName, refState, configurationState] = await Promise.all([
        git(worktreePath, ["rev-parse", "HEAD"]),
        currentBranch(worktreePath),
        git(worktreePath, ["for-each-ref", "--format=%(refname)%09%(objectname)"]),
        git(worktreePath, ["config", "--show-origin", "--null", "--list"]),
    ]);
    const refIdentity = sha256(refState);
    const refLines = refState.split("\n");
    const auxiliaryRefIdentity = sha256(refLines.filter((line) => !line.startsWith(`refs/heads/${branchName}\t`)).join("\n"));
    const refs = new Map(refLines.filter(Boolean).map((line) => {
        const [refName, objectName] = line.split("\t", 2);
        return [refName ?? "", objectName ?? ""];
    }));
    const expectedManagedRefs = new Map(managedBranches.map((expectation) => [
        `refs/heads/${expectation.branchName}`,
        expectation,
    ]));
    const unexpectedRefs = refLines.filter((line) => {
        const [refName, objectName] = line.split("\t", 2);
        const expectation = expectedManagedRefs.get(refName ?? "");
        return expectation === undefined || expectation.expectedCommit !== objectName;
    });
    const missingManagedRefs = [...expectedManagedRefs].flatMap(([refName, expectation]) => expectation.required && !refs.has(refName) ? [`${refName}\t<missing>`] : []);
    const externalRefIdentity = sha256([...unexpectedRefs, ...missingManagedRefs].sort().join("\n"));
    const configurationIdentity = sha256(configurationState);
    const changed = await changedPaths(worktreePath);
    let treeIdentity = await git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    if (changed.length > 0) {
        await runChecked({ executable: "git", arguments: ["add", "--all"], cwd: worktreePath });
        treeIdentity = await git(worktreePath, ["write-tree"]);
    }
    return {
        headCommit,
        treeIdentity,
        changedPaths: changed,
        clean: changed.length === 0,
        refIdentity,
        auxiliaryRefIdentity,
        externalRefIdentity,
        configurationIdentity,
    };
}
export async function remoteBranchCommit(repositoryRoot, remote, branchName) {
    const result = await runProcess({
        executable: "git",
        arguments: ["ls-remote", "--heads", remote, `refs/heads/${branchName}`],
        cwd: repositoryRoot,
    });
    if (result.exitCode !== 0) {
        throw new AutopilotError("GIT_FAILED", `could not observe remote ${remote}`, { stderr: result.stderr });
    }
    const commit = result.stdout.trim().split(/\s+/)[0] ?? "";
    return commit.length === 0 ? undefined : commit;
}
export async function pushBranch(worktreePath, remote, branchName, expectedCommit) {
    const observed = await remoteBranchCommit(worktreePath, remote, branchName);
    if (observed === expectedCommit) {
        return observed;
    }
    if (observed !== undefined) {
        throw new AutopilotError("BRANCH_COLLISION", `remote branch ${remote}/${branchName} already exists at ${observed}`);
    }
    await runChecked({
        executable: "git",
        arguments: ["push", "--porcelain", remote, `${expectedCommit}:refs/heads/${branchName}`],
        cwd: worktreePath,
    });
    const confirmed = await remoteBranchCommit(worktreePath, remote, branchName);
    if (confirmed !== expectedCommit) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "remote branch did not reach the expected commit after push", {
            expected: expectedCommit,
            observed: confirmed,
        });
    }
    return confirmed;
}
export async function pushAmendmentBranch(worktreePath, remote, branchName, previousCommit, expectedCommit, beforePush) {
    const ancestor = await runProcess({
        executable: "git",
        arguments: ["merge-base", "--is-ancestor", previousCommit, expectedCommit],
        cwd: worktreePath,
    });
    if (ancestor.exitCode !== 0) {
        throw new AutopilotError("BRANCH_COLLISION", "amendment commit is not a descendant of the predecessor commit");
    }
    const observed = await remoteBranchCommit(worktreePath, remote, branchName);
    if (observed === expectedCommit) {
        return observed;
    }
    if (observed !== previousCommit) {
        throw new AutopilotError("BRANCH_COLLISION", `remote amendment branch changed from ${previousCommit} to ${String(observed)}`);
    }
    beforePush?.();
    await runChecked({
        executable: "git",
        arguments: ["push", "--porcelain", remote, `${expectedCommit}:refs/heads/${branchName}`],
        cwd: worktreePath,
    });
    const confirmed = await remoteBranchCommit(worktreePath, remote, branchName);
    if (confirmed !== expectedCommit) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "remote amendment branch did not reach the expected commit", {
            expected: expectedCommit,
            observed: confirmed,
        });
    }
    return confirmed;
}
export async function inspectPreCommitHook(worktreePath) {
    const configuredPath = await git(worktreePath, ["rev-parse", "--git-path", "hooks/pre-commit"]);
    const hookPath = isAbsolute(configuredPath) ? configuredPath : resolve(worktreePath, configuredPath);
    try {
        await access(hookPath, constants.X_OK);
        return { identity: sha256(await readFile(hookPath)), path: hookPath };
    }
    catch {
        return { identity: "NOT_CONFIGURED" };
    }
}
export async function runPreCommitHook(worktreePath, expectedHook, environmentNames, timeoutMs, maximumOutputBytes) {
    const observedHook = await inspectPreCommitHook(worktreePath);
    if (observedHook.identity !== expectedHook.identity || observedHook.path !== expectedHook.path) {
        return {
            status: "FAILED",
            ...(observedHook.path === undefined ? {} : { path: observedHook.path }),
            result: {
                exitCode: 126,
                stdout: "",
                stderr: "configured pre-commit hook changed after the attempt started",
                truncated: false,
            },
        };
    }
    if (observedHook.path === undefined) {
        return { status: "NOT_CONFIGURED" };
    }
    try {
        let executable = observedHook.path;
        let arguments_ = [];
        if (process.platform === "win32") {
            const gitExecutablePath = await git(worktreePath, ["--exec-path"]);
            executable = resolve(gitExecutablePath, "../../../usr/bin/sh.exe");
            await access(executable, constants.X_OK);
            arguments_ = ["-c", 'exec "$1"', "autopilot-pre-commit", observedHook.path];
        }
        const result = await runVerificationCommand(executable, arguments_, worktreePath, environmentNames, timeoutMs, maximumOutputBytes);
        return { status: result.exitCode === 0 ? "PASSED" : "FAILED", path: observedHook.path, result };
    }
    catch (error) {
        return {
            status: "FAILED",
            path: observedHook.path,
            result: {
                exitCode: 124,
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
                truncated: false,
            },
        };
    }
}
export async function commitAcceptedWork(worktreePath, charter, item, attemptId, expectedTree, expectedParent) {
    const message = [
        `autopilot(${item.id}): accept verified work`,
        "",
        `Autopilot-Run: ${charter.runId}`,
        `Autopilot-Item: ${item.id}`,
        `Autopilot-Attempt: ${attemptId}`,
    ].join("\n");
    const [treeIdentity, parentCommit, branchRef] = await Promise.all([
        git(worktreePath, ["write-tree"]),
        resolveCommit(worktreePath, "HEAD"),
        git(worktreePath, ["symbolic-ref", "-q", "HEAD"]),
    ]);
    if (branchRef !== `refs/heads/${item.branchName}` || parentCommit !== expectedParent) {
        throw new AutopilotError("BRANCH_COLLISION", `worktree is no longer on the expected ${item.branchName} commit`);
    }
    if (treeIdentity !== expectedTree) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "staged tree changed after runtime verification", {
            expected: expectedTree,
            observed: treeIdentity,
        });
    }
    const commit = (await runChecked({
        executable: "git",
        arguments: ["commit-tree", treeIdentity, "-p", parentCommit],
        cwd: worktreePath,
        stdin: `${message}\n`,
    })).stdout.trim();
    await runChecked({
        executable: "git",
        arguments: ["update-ref", "-m", `autopilot ${charter.runId}/${item.id}`, branchRef, commit, parentCommit],
        cwd: worktreePath,
    });
    return commit;
}
async function registeredWorktreeHead(repositoryRoot, worktreePath) {
    const fields = (await git(repositoryRoot, ["worktree", "list", "--porcelain", "-z"])).split(/[\0\n]/u);
    const canonicalWorktreePath = join(await realpath(dirname(worktreePath)), basename(worktreePath));
    const index = fields.findIndex((field) => field === `worktree ${canonicalWorktreePath}`);
    const head = index < 0 ? undefined : fields[index + 1];
    return head?.startsWith("HEAD ") === true ? head.slice("HEAD ".length) : undefined;
}
export async function prepareRestackCandidate(repositoryRoot, runId, itemId, oldCommit, freshParentCommit, retainedWorktreePath) {
    const ancestor = await runProcess({
        executable: "git",
        arguments: ["merge-base", "--is-ancestor", freshParentCommit, oldCommit],
        cwd: repositoryRoot,
    });
    if (ancestor.exitCode === 0) {
        throw new AutopilotError("RESTACK_REWRITE_REQUIRED", "restack predecessor is already contained by the descendant");
    }
    const merged = await runProcess({
        executable: "git",
        arguments: ["merge-tree", "--write-tree", oldCommit, freshParentCommit],
        cwd: repositoryRoot,
        maxOutputBytes: 65_536,
    });
    if (merged.exitCode !== 0) {
        throw new AutopilotError("RESTACK_CONFLICT", `restack merge tree conflicts for ${itemId}`, { stderr: merged.stderr });
    }
    const treeIdentity = merged.stdout.trim().split("\n")[0] ?? "";
    if (!/^[a-f0-9]{40,64}$/u.test(treeIdentity)) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "git merge-tree did not return an exact tree identity");
    }
    const message = [
        `autopilot(${itemId}): merge-forward amended predecessor`,
        "",
        `Autopilot-Run: ${runId}`,
        `Autopilot-Item: ${itemId}`,
        `Autopilot-Restack-Old: ${oldCommit}`,
        `Autopilot-Restack-Parent: ${freshParentCommit}`,
    ].join("\n");
    const messageIdentity = sha256(message);
    const commit = (await runChecked({
        executable: "git",
        arguments: ["commit-tree", treeIdentity, "-p", oldCommit, "-p", freshParentCommit],
        cwd: repositoryRoot,
        stdin: `${message}\n`,
        environment: {
            ...process.env,
            GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
            GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
        },
    })).stdout.trim();
    const temporaryWorktreePath = boundedSiblingWorktreePath(repositoryRoot, `${basename(retainedWorktreePath)}-restack-${runId}-${itemId}-candidate`, `${repositoryRoot}\0${runId}\0${itemId}\0restack-candidate`, MAX_CANDIDATE_WORKTREE_DIRECTORY_BYTES);
    try {
        await lstat(temporaryWorktreePath);
        await assertRegisteredWorktree(repositoryRoot, temporaryWorktreePath);
        const existing = await inspectRepository(temporaryWorktreePath);
        if (existing.headCommit !== commit || !existing.clean) {
            throw new AutopilotError("BRANCH_COLLISION", `restack candidate worktree changed for ${itemId}`);
        }
        return { commit, treeIdentity, messageIdentity, temporaryWorktreePath };
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw error;
        }
    }
    const registeredHead = await registeredWorktreeHead(repositoryRoot, temporaryWorktreePath);
    if (registeredHead !== undefined) {
        if (registeredHead !== commit) {
            throw new AutopilotError("BRANCH_COLLISION", `missing restack candidate path is registered at another commit for ${itemId}`);
        }
        await runChecked({
            executable: "git",
            arguments: ["worktree", "remove", temporaryWorktreePath],
            cwd: repositoryRoot,
        });
    }
    await runChecked({
        executable: "git",
        arguments: ["worktree", "add", "--detach", temporaryWorktreePath, commit],
        cwd: repositoryRoot,
    });
    return { commit, treeIdentity, messageIdentity, temporaryWorktreePath };
}
export async function installRestackCandidate(repositoryRoot, branchName, retainedWorktreePath, temporaryWorktreePath, oldCommit, candidateCommit, candidateTreeIdentity, beforeMutation) {
    await assertRegisteredWorktree(repositoryRoot, temporaryWorktreePath);
    const candidate = await inspectRepository(temporaryWorktreePath);
    const candidateIdentity = await inspectCommit(temporaryWorktreePath, candidate.headCommit);
    if (!candidate.clean || candidate.headCommit !== candidateCommit
        || candidateIdentity.treeIdentity !== candidateTreeIdentity) {
        throw new AutopilotError("BRANCH_COLLISION", "temporary restack candidate changed before installation");
    }
    const branchCommit = await resolveCommit(repositoryRoot, branchName);
    if (branchCommit !== oldCommit && branchCommit !== candidateCommit) {
        throw new AutopilotError("BRANCH_COLLISION", "retained restack branch changed before installation");
    }
    let retainedExists = true;
    try {
        await lstat(retainedWorktreePath);
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            retainedExists = false;
        }
        else {
            throw error;
        }
    }
    if (retainedExists) {
        await assertRegisteredWorktree(repositoryRoot, retainedWorktreePath);
        const retained = await inspectRepository(retainedWorktreePath);
        const branch = await currentBranch(retainedWorktreePath);
        if (!retained.clean || retained.headCommit !== branchCommit || branch !== branchName) {
            throw new AutopilotError("BRANCH_COLLISION", "retained restack worktree changed before installation");
        }
        if (branchCommit === oldCommit) {
            beforeMutation?.();
            await runChecked({ executable: "git", arguments: ["worktree", "remove", retainedWorktreePath], cwd: repositoryRoot });
            retainedExists = false;
        }
    }
    try {
        if (branchCommit === oldCommit) {
            if (retainedExists) {
                throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "retained worktree remained registered before restack CAS");
            }
            beforeMutation?.();
            await runChecked({
                executable: "git",
                arguments: ["update-ref", "-m", "autopilot restack", `refs/heads/${branchName}`, candidateCommit, oldCommit],
                cwd: repositoryRoot,
            });
        }
        if (!retainedExists) {
            beforeMutation?.();
            await runChecked({ executable: "git", arguments: ["worktree", "add", retainedWorktreePath, branchName], cwd: repositoryRoot });
        }
        const confirmed = await inspectRepository(retainedWorktreePath);
        const confirmedTree = await git(retainedWorktreePath, ["show", "-s", "--format=%T", "HEAD"]);
        if (!confirmed.clean || confirmed.headCommit !== candidateCommit || confirmedTree !== candidateTreeIdentity) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "restack retained worktree did not reach the candidate");
        }
        await runChecked({ executable: "git", arguments: ["worktree", "remove", temporaryWorktreePath], cwd: repositoryRoot });
    }
    catch (error) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "restack worktree installation did not complete exactly", {
            cause: String(error),
            retainedWorktreePath,
            temporaryWorktreePath,
        });
    }
}
export async function runVerificationCommand(executable, arguments_, cwd, environmentNames, timeoutMs, maximumOutputBytes) {
    const allowedBase = ["HOME", "PATH", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "NO_COLOR", "CI"];
    const names = new Set([...allowedBase, ...environmentNames]);
    const environment = Object.fromEntries([...names].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
    return await runProcess({
        executable,
        arguments: arguments_,
        cwd,
        environment,
        timeoutMs,
        maxOutputBytes: maximumOutputBytes,
    });
}
