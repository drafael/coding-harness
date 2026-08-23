import { canonicalJson, sha256 } from "./json.js";
const FALLBACK_TITLE_LENGTH = 72;
export function changeRequestTitle(item) {
    if (item.title !== undefined) {
        return item.title;
    }
    const normalized = item.objective.replace(/\s+/gu, " ").trim();
    const clause = normalized.split(/(?:[.!?](?:\s|$)|;)/u, 1)[0] ?? normalized;
    if (clause.length <= FALLBACK_TITLE_LENGTH) {
        return clause;
    }
    const lastWholeWord = clause.lastIndexOf(" ", FALLBACK_TITLE_LENGTH - 1);
    const end = lastWholeWord > 0 ? lastWholeWord : FALLBACK_TITLE_LENGTH - 1;
    return `${clause.slice(0, end).trimEnd()}…`;
}
export function reviewThreadDigest(thread) {
    return sha256(canonicalJson({
        id: thread.id,
        ...(thread.path === undefined ? {} : { path: thread.path }),
        comments: thread.comments,
    }));
}
