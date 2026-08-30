import { AutopilotError } from "../../src/errors.js";
import { expectInteger, expectLiteral, expectRecord, expectString, isRecord } from "../../src/json.js";
import { runChecked } from "../../src/process.js";
async function glab(repositoryRoot, arguments_) {
    return (await runChecked({ executable: "glab", arguments: arguments_, cwd: repositoryRoot })).stdout.trim();
}
function parseJson(text, path) {
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `${path} returned malformed JSON`, { cause: String(error) });
    }
}
function mergeRequestRef(value) {
    const object = expectRecord(value, "GitLab merge request");
    const id = expectInteger(object.iid ?? object.id, "GitLab merge request.iid", 1);
    return { provider: "gitlab", id: String(id), url: expectString(object.web_url, "GitLab merge request.web_url") };
}
function mergeRequestHead(object) {
    const diffRefs = isRecord(object.diff_refs) ? object.diff_refs : undefined;
    const diffHead = typeof diffRefs?.head_sha === "string" && diffRefs.head_sha.length > 0 ? diffRefs.head_sha : undefined;
    const sourceHead = typeof object.sha === "string" && object.sha.length > 0 ? object.sha : undefined;
    if (diffHead !== undefined && sourceHead !== undefined && diffHead !== sourceHead) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "GitLab merge request head identities disagree");
    }
    const head = diffHead ?? sourceHead;
    if (head === undefined) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "GitLab merge request did not expose a head commit");
    }
    return head;
}
export class GitLabDeliveryAdapter {
    async describe() {
        const providerVersion = (await glab(process.cwd(), ["--version"])).split("\n")[0] ?? "unknown";
        return {
            provider: "gitlab",
            providerVersion,
            changeRequests: true,
            checks: true,
            approvals: true,
            mergeQueue: false,
            mergeTrain: true,
        };
    }
    async observeChangeRequest(repositoryRoot, ref) {
        const object = expectRecord(parseJson(await glab(repositoryRoot, ["mr", "view", ref.id, "--output", "json"]), "glab mr view"), "GitLab merge request");
        const state = expectLiteral(expectString(object.state, "GitLab merge request.state").toLowerCase(), ["opened", "merged", "closed"], "GitLab merge request.state");
        return {
            ref: mergeRequestRef(object),
            state: state === "merged" ? "merged" : state === "closed" ? "closed" : "open",
            headCommit: mergeRequestHead(object),
            baseBranch: expectString(object.target_branch, "GitLab merge request.target_branch"),
            approved: object.approved === true || object.approvals_left === 0,
        };
    }
    async findChangeRequest(repositoryRoot, runId, itemId) {
        const output = parseJson(await glab(repositoryRoot, ["mr", "list", "--all", "--output", "json"]), "glab mr list");
        if (!Array.isArray(output)) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "glab mr list did not return an array");
        }
        const match = output.find((entry) => isRecord(entry)
            && typeof entry.description === "string"
            && entry.description.includes(`Autopilot-Run: ${runId}`)
            && entry.description.includes(`Autopilot-Item: ${itemId}`));
        return match === undefined ? undefined : mergeRequestRef(match);
    }
    async createChangeRequest(request) {
        const existing = await this.findChangeRequest(request.repositoryRoot, request.runId, request.itemId);
        if (existing !== undefined) {
            return existing;
        }
        const description = `${request.body}\n\nAutopilot-Run: ${request.runId}\nAutopilot-Item: ${request.itemId}\nAutopilot-Head: ${request.expectedHeadCommit}`;
        const output = await glab(request.repositoryRoot, [
            "mr", "create", "--source-branch", request.headBranch, "--target-branch", request.baseBranch, "--title", request.title,
            "--description", description, "--yes",
        ]);
        const url = output.split(/\s+/).find((part) => part.startsWith("http"));
        const id = url?.split("/").at(-1);
        if (url === undefined || id === undefined) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "glab mr create did not return a merge request URL");
        }
        return { provider: "gitlab", id, url };
    }
    async observeReviewThreads(repositoryRoot, ref) {
        const project = expectRecord(parseJson(await glab(repositoryRoot, ["repo", "view", "--output", "json"]), "glab repo view"), "GitLab project");
        const projectId = String(expectInteger(project.id, "GitLab project.id", 1));
        const discussions = [];
        let page = 1;
        while (true) {
            const output = parseJson(await glab(repositoryRoot, [
                "api", `projects/${projectId}/merge_requests/${ref.id}/discussions`, "--method", "GET",
                "--field", "per_page=100", "--field", `page=${page}`,
            ]), "glab merge request discussions");
            if (!Array.isArray(output)) {
                throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "GitLab discussions response is not an array");
            }
            discussions.push(...output);
            if (output.length < 100) {
                break;
            }
            page += 1;
        }
        return discussions.flatMap((entry, index) => {
            const discussion = expectRecord(entry, `GitLab discussions[${index}]`);
            if (!Array.isArray(discussion.notes)) {
                throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `GitLab discussions[${index}].notes is malformed`);
            }
            const notes = discussion.notes.filter((note) => !isRecord(note) || note.system !== true).map((entry_, noteIndex) => {
                const note = expectRecord(entry_, `GitLab discussions[${index}].notes[${noteIndex}]`);
                const author = expectRecord(note.author, `GitLab discussions[${index}].notes[${noteIndex}].author`);
                const id = String(expectInteger(note.id, `GitLab discussions[${index}].notes[${noteIndex}].id`, 1));
                return {
                    id,
                    author: expectString(author.username, `GitLab discussions[${index}].notes[${noteIndex}].author.username`),
                    body: expectString(note.body, `GitLab discussions[${index}].notes[${noteIndex}].body`),
                    url: typeof note.web_url === "string" ? note.web_url : `${ref.url}#note_${id}`,
                    createdAt: expectString(note.created_at, `GitLab discussions[${index}].notes[${noteIndex}].created_at`),
                };
            });
            if (notes.length === 0) {
                return [];
            }
            const firstNote = expectRecord(discussion.notes[0], `GitLab discussions[${index}].notes[0]`);
            const position = isRecord(firstNote.position) ? firstNote.position : undefined;
            const resolvableNotes = discussion.notes.filter((note) => isRecord(note) && note.resolvable === true);
            return [{
                    id: expectString(discussion.id, `GitLab discussions[${index}].id`),
                    resolved: resolvableNotes.length > 0 && resolvableNotes.every((note) => isRecord(note) && note.resolved === true),
                    outdated: position?.position_type === "text" && position.new_path === null,
                    resolvable: resolvableNotes.length > 0,
                    ...(typeof position?.new_path === "string" ? { path: position.new_path } : {}),
                    ...(typeof position?.new_line === "number" && Number.isInteger(position.new_line) ? { line: position.new_line } : {}),
                    comments: notes,
                }];
        });
    }
    async resolveReviewThreads(repositoryRoot, ref, threadIds) {
        const project = expectRecord(parseJson(await glab(repositoryRoot, ["repo", "view", "--output", "json"]), "glab repo view"), "GitLab project");
        const projectId = String(expectInteger(project.id, "GitLab project.id", 1));
        return await Promise.all(threadIds.map(async (threadId) => {
            const discussion = expectRecord(parseJson(await glab(repositoryRoot, [
                "api", `projects/${projectId}/merge_requests/${ref.id}/discussions/${encodeURIComponent(threadId)}`,
                "--method", "PUT", "--field", "resolved=true",
            ]), "glab resolve discussion"), "GitLab discussion");
            const notes = Array.isArray(discussion.notes) ? discussion.notes.filter((note) => isRecord(note) && note.resolvable === true) : [];
            if (expectString(discussion.id, "GitLab discussion.id") !== threadId || notes.length === 0
                || !notes.every((note) => isRecord(note) && note.resolved === true)) {
                throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `GitLab did not confirm resolution of discussion ${threadId}`);
            }
            return threadId;
        }));
    }
    async observeChecks(repositoryRoot, subjectCommit) {
        const project = expectRecord(parseJson(await glab(repositoryRoot, ["repo", "view", "--output", "json"]), "glab repo view"), "GitLab project");
        const path = expectString(project.path_with_namespace, "GitLab project.path_with_namespace");
        const statuses = parseJson(await glab(repositoryRoot, ["api", `projects/${encodeURIComponent(path)}/repository/commits/${subjectCommit}/statuses`]), "glab commit statuses");
        if (!Array.isArray(statuses)) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "GitLab commit statuses response is malformed");
        }
        const latestByName = new Map();
        statuses.forEach((entry, index) => {
            const status = expectRecord(entry, `GitLab statuses[${index}]`);
            const value = expectString(status.status, `GitLab statuses[${index}].status`);
            const name = expectString(status.name, `GitLab statuses[${index}].name`);
            const rank = typeof status.id === "number" && Number.isInteger(status.id)
                ? status.id
                : typeof status.created_at === "string" && Number.isFinite(Date.parse(status.created_at))
                    ? Date.parse(status.created_at)
                    : -index;
            const current = latestByName.get(name);
            if (current === undefined || rank > current.rank) {
                latestByName.set(name, {
                    rank,
                    observation: {
                        name,
                        status: value === "success" ? "passed" : ["pending", "running", "created"].includes(value) ? "pending" : "failed",
                        subjectCommit,
                        ...(typeof status.target_url === "string" && status.target_url.length > 0 ? { detailsUrl: status.target_url } : {}),
                    },
                });
            }
        });
        return [...latestByName.values()].map(({ observation }) => observation);
    }
    async merge(request) {
        const current = await this.observeChangeRequest(request.repositoryRoot, request.ref);
        if (current.headCommit !== request.expectedHeadCommit) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "merge request head changed before merge", {
                expected: request.expectedHeadCommit,
                observed: current.headCommit,
            });
        }
        const arguments_ = ["mr", "merge", request.ref.id, "--yes", "--sha", request.expectedHeadCommit];
        if (request.method === "squash") {
            arguments_.push("--squash");
        }
        await glab(request.repositoryRoot, arguments_);
        const merged = await this.observeChangeRequest(request.repositoryRoot, request.ref);
        return { merged: merged.state === "merged", observedHeadCommit: merged.headCommit };
    }
}
