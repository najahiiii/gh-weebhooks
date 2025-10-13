/* eslint-disable @typescript-eslint/no-explicit-any */
// Ported from original FastAPI implementation. Generates HTML-formatted summaries for Telegram.
import { inspect } from "node:util";

export type Payload = Record<string, any>;
export type Handler = (payload: Payload, event: string) => string;

const MAX_COMMITS = 5;
const UNKNOWN = "unknown";

function esc(value: any): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function link(url: unknown, text?: unknown): string {
  if (!url || typeof url !== "string" || url.length === 0) {
    return "";
  }
  const label = text ? String(text) : url;
  return `<a href="${esc(url)}">${esc(label)}</a>`;
}

function firstLine(text: unknown, limit = 120): string {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }
  return text.split(/\r?\n/, 1)[0].slice(0, limit);
}

function ensureMapping(data: unknown): Payload {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Payload;
  }
  return {};
}

function dig(data: unknown, path: string[]): any {
  let current: any = data;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, any>)[key];
    if (current === undefined || current === null) {
      return current;
    }
  }
  return current;
}

const SUBJECT_NAME_FIELDS: string[][] = [
  ["title"],
  ["name"],
  ["login"],
  ["slug"],
  ["ref"],
  ["branch"],
  ["tag"],
  ["tag_name"],
  ["environment"],
  ["key"],
  ["pattern"],
  ["sha"],
  ["node_id"],
  ["id"],
  ["number"],
];

const SUBJECT_URL_FIELDS: string[][] = [
  ["html_url"],
  ["url"],
  ["target_url"],
  ["links", "html"],
  ["links", "self"],
];

type ExtraValue = string | string[] | undefined;
type ExtraResolver = (payload: Payload) => ExtraValue;
type Extra = ExtraValue | ExtraResolver;

function extractSubject(data: any, fields?: Iterable<string[]>): { name: string; url: string } {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nameFields = fields ? Array.from(fields) : SUBJECT_NAME_FIELDS;
    let text = "";
    for (const candidate of nameFields) {
      const value = dig(data, candidate);
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === "object") {
        continue;
      }
      text = String(value).trim();
      if (!text) {
        continue;
      }
      if (candidate[candidate.length - 1] === "number" && text.length > 0 && !text.startsWith("#")) {
        text = `#${text}`;
      }
      if (text.length > 160) {
        text = `${text.slice(0, 157)}...`;
      }
      break;
    }
    let url = "";
    for (const candidate of SUBJECT_URL_FIELDS) {
      const value = dig(data, candidate);
      if (typeof value === "string" && value) {
        url = value;
        break;
      }
    }
    return { name: text, url };
  }
  if (data === null || data === undefined || data === "") {
    return { name: "", url: "" };
  }
  let text = String(data);
  if (text.length > 160) {
    text = `${text.slice(0, 157)}...`;
  }
  return { name: text, url: "" };
}

function resolveSubject(payload: Payload, spec: any): any {
  if (spec === null || spec === undefined) {
    return null;
  }
  const paths: string[][] = [];
  if (typeof spec === "string") {
    paths.push([spec]);
  } else if (Array.isArray(spec)) {
    const flattened: string[][] = [];
    for (const item of spec) {
      if (typeof item === "string") {
        flattened.push([item]);
      } else if (Array.isArray(item)) {
        flattened.push(item.map((entry) => String(entry)));
      }
    }
    if (flattened.length > 0) {
      paths.push(...flattened);
    }
  }
  for (const path of paths) {
    const subject = dig(payload, path);
    if (subject) {
      return subject;
    }
  }
  return null;
}

function actor(payload: Payload): string {
  const paths: string[][] = [
    ["sender", "login"],
    ["sender", "name"],
    ["user", "login"],
    ["user", "name"],
    ["actor", "login"],
    ["actor", "name"],
    ["pusher", "name"],
    ["pusher", "email"],
    ["installation", "account", "login"],
    ["installation", "account", "name"],
  ];
  for (const path of paths) {
    const value = dig(payload, path);
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return "";
}

function repo(payload: Payload): string {
  const paths: string[][] = [
    ["repository", "full_name"],
    ["repository", "name"],
  ];
  for (const path of paths) {
    const value = dig(payload, path);
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return "";
}

function prettyLabel(event: string): string {
  const words = event.replace(/_/g, " ").trim();
  if (!words) {
    return "Event";
  }
  return words
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function callableExtra(extra: Extra, payload: Payload): string[] {
  if (!extra) {
    return [];
  }
  if (typeof extra === "function") {
    try {
      const result = extra(payload);
      if (typeof result === "string") {
        return result ? [result] : [];
      }
      if (Array.isArray(result)) {
        return result.filter((item) => item).map((item) => String(item));
      }
      return [];
    } catch (error) {
      return [`<i>extra error: ${esc((error as Error).message || inspect(error))}</i>`];
    }
  }
  if (typeof extra === "string") {
    return extra ? [extra] : [];
  }
  if (Array.isArray(extra)) {
    return extra.filter((item) => item).map((item) => String(item));
  }
  return [];
}

function formatMainLine(options: {
  label: string;
  action: string;
  subjectName: string;
  repoName: string;
  actorName: string;
}): string {
  const { label, action, subjectName, repoName, actorName } = options;
  let line = `<b>${esc(label)}</b>`;
  if (subjectName) {
    line += `: ${esc(subjectName)}`;
  }
  if (action) {
    line += ` <b>${esc(action)}</b>`;
  }
  if (repoName) {
    line += ` in <code>${esc(repoName)}</code>`;
  }
  if (actorName && actorName !== UNKNOWN) {
    line += ` by <b>${esc(actorName)}</b>`;
  }
  return line;
}

function genericActionSummary(
  label: string,
  payloadInput: Payload,
  options: {
    subject?: any;
    subjectFields?: Iterable<string[]> | null;
    urlFields?: Iterable<string[]> | null;
    extra?: Extra;
  } = {}
): string {
  const payload = ensureMapping(payloadInput);
  const action = String(payload.action ?? "").trim();
  const actorName = actor(payload) || UNKNOWN;
  const repoName = repo(payload);

  const subjectData = resolveSubject(payload, options.subject);
  let subjectName = "";
  let subjectUrl = "";
  if (subjectData !== null && subjectData !== undefined) {
    const subject = extractSubject(subjectData, options.subjectFields || undefined);
    subjectName = subject.name;
    subjectUrl = subject.url;
    if (!subjectUrl && options.urlFields && typeof subjectData === "object") {
      for (const candidate of options.urlFields) {
        const value = dig(subjectData, candidate);
        if (typeof value === "string" && value) {
          subjectUrl = value;
          break;
        }
      }
    }
  }

  const lines: string[] = [];
  lines.push(
    formatMainLine({
      label,
      action,
      subjectName,
      repoName,
      actorName,
    })
  );
  if (subjectUrl) {
    lines.push(link(subjectUrl, "View details"));
  }
  for (const line of callableExtra(options.extra ?? undefined, payload)) {
    if (line) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}

function summarizePing(payload: Payload): string {
  const data = ensureMapping(payload);
  const repoName = repo(data) || "?";
  const zen = data.zen ?? "";
  const hook = ensureMapping(data.hook);
  const hookId = data.hook_id ?? hook.id ?? "?";
  const cfg = ensureMapping(hook.config);
  const events = Array.isArray(hook.events) ? hook.events : [];
  const lastResponse = ensureMapping(hook.last_response).status ?? "unknown";
  const createdAt = hook.created_at ?? "";
  const updatedAt = hook.updated_at ?? "";
  const payloadUrl = cfg.url;
  const testUrl = hook.test_url;
  const pingUrl = hook.ping_url;

  const lines = [
    "<b>GitHub webhook ping received</b>",
    `repository: <code>${esc(repoName)}</code>`,
    `hook_id: <code>${esc(hookId)}</code>`,
  ];
  if (events.length > 0) {
    lines.push(
      "events: " +
      events
        .map((evt: unknown) => `<code>${esc(evt)}</code>`)
        .join(", ")
    );
  } else {
    lines.push("events: <code>*</code>");
  }
  lines.push(
    "payload_url: " + (payloadUrl ? link(payloadUrl) : "<code>-</code>")
  );
  lines.push(`last_response: <code>${esc(lastResponse)}</code>`);
  if (createdAt) {
    lines.push(`created_at: <code>${esc(createdAt)}</code>`);
  }
  if (updatedAt) {
    lines.push(`updated_at: <code>${esc(updatedAt)}</code>`);
  }
  if (testUrl) {
    lines.push(`test_url: ${link(testUrl)}`);
  }
  if (pingUrl) {
    lines.push(`ping_url: ${link(pingUrl)}`);
  }
  if (zen) {
    lines.push(`zen: ${esc(zen)}`);
  }
  return lines.join("\n");
}

function summarizeCreate(payload: Payload): string {
  const data = ensureMapping(payload);
  const repoName = repo(data);
  const refType = data.ref_type ?? "ref";
  const ref = data.ref ?? "?";
  const actorName = actor(data) || UNKNOWN;
  const repoPart = repoName ? ` in <code>${esc(repoName)}</code>` : "";
  return `<b>Create</b> ${esc(refType)} <code>${esc(ref)}</code>${repoPart} by <b>${esc(actorName)}</b>`;
}

function summarizeDelete(payload: Payload): string {
  const data = ensureMapping(payload);
  const repoName = repo(data);
  const refType = data.ref_type ?? "ref";
  const ref = data.ref ?? "?";
  const actorName = actor(data) || UNKNOWN;
  const repoPart = repoName ? ` from <code>${esc(repoName)}</code>` : "";
  return `<b>Delete</b> ${esc(refType)} <code>${esc(ref)}</code>${repoPart} by <b>${esc(actorName)}</b>`;
}

function summarizePush(payload: Payload): string {
  const data = ensureMapping(payload);
  const repoName = repo(data) || "?";
  const repoUrl = dig(data, ["repository", "html_url"]);
  const ref = data.ref ?? "";
  const isTag = typeof ref === "string" && ref.startsWith("refs/tags/");
  const branch = typeof ref === "string" && ref ? ref.split("/").pop() ?? "unknown" : "unknown";
  const deleted = Boolean(data.deleted);
  const forced = Boolean(data.forced);
  const actorName =
    (dig(data, ["pusher", "name"]) ?? actor(data)) ||
    UNKNOWN;
  const commits = Array.isArray(data.commits) ? data.commits : [];
  const compareUrl = typeof data.compare === "string" ? data.compare : "";

  const targetLabel = isTag ? "tag" : "branch";
  const lines: string[] = [];
  if (deleted) {
    const head =
      `<b>Deleted</b> ${targetLabel} <code>${esc(branch)}</code>` +
      ` from <code>${esc(repoName)}</code> by <b>${esc(actorName)}</b>`;
    lines.push(head);
  } else {
    const commitCount = commits.length;
    const plural = commitCount === 1 ? "commit" : "commits";
    let head =
      `<b>Push</b> to ${targetLabel} <code>${esc(branch)}</code>` +
      ` in <code>${esc(repoName)}</code> by <b>${esc(actorName)}</b>` +
      ` (${commitCount} ${plural})`;
    if (forced) {
      head += " <i>(forced)</i>";
    }
    lines.push(head);
    if (compareUrl) {
      lines.push(link(compareUrl, "Compare"));
    }
    if (commits.length > 0) {
      lines.push("");
      const shown = Math.min(commits.length, MAX_COMMITS);
      for (let index = 0; index < shown; index += 1) {
        const commit = ensureMapping(commits[index]);
        const sha = typeof commit.id === "string" ? commit.id.slice(0, 7) : "";
        const message = firstLine(commit.message);
        const url = typeof commit.url === "string" ? commit.url : "";
        const line = `<code>${esc(sha)}</code> ${esc(message)}`;
        lines.push(line);
        if (url) {
          lines.push(link(url, "View commit"));
        }
        if (index < shown - 1) {
          lines.push("");
        }
      }
      const overflow = commits.length - MAX_COMMITS;
      if (overflow > 0) {
        lines.push(`<i>+${overflow} more commits</i>`);
      }
    }
  }
  if (deleted && repoUrl) {
    lines.push(link(repoUrl, "Repository"));
  }
  return lines.join("\n");
}

function summarizePullRequest(payload: Payload): string {
  const data = ensureMapping(payload);
  let action = data.action ?? "";
  const repoName = repo(data) || "?";
  const pr = ensureMapping(data.pull_request);
  const number = pr.number ?? data.number ?? "?";
  const title = pr.title ?? "";
  const actorName = actor(data) || UNKNOWN;
  const headRef = dig(pr, ["head", "ref"]) ?? "?";
  const baseRef = dig(pr, ["base", "ref"]) ?? "?";
  const merged = Boolean(pr.merged);
  const url = pr.html_url;

  if (action === "closed" && merged) {
    action = "merged";
  }

  const lines = [
    `<b>Pull request</b> <code>${esc(repoName)}</code> #${esc(number)} <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (title) {
    lines.push(`<b>${esc(title)}</b>`);
  }
  lines.push(`${esc(headRef)} → ${esc(baseRef)}`);
  if (url) {
    lines.push(link(url, "View pull request"));
  }
  return lines.join("\n");
}

function summarizeIssues(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const repoName = repo(data) || "?";
  const issue = ensureMapping(data.issue);
  const number = issue.number ?? data.number ?? "?";
  const title = issue.title ?? "";
  const actorName = actor(data) || UNKNOWN;
  const url = issue.html_url;

  const lines = [
    `<b>Issue</b> <code>${esc(repoName)}</code> #${esc(number)} <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (title) {
    lines.push(`<b>${esc(title)}</b>`);
  }
  if (url) {
    lines.push(link(url, "View issue"));
  }
  return lines.join("\n");
}

function summarizeIssueComment(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const issue = ensureMapping(data.issue);
  const comment = ensureMapping(data.comment);
  const actorName = actor(data) || UNKNOWN;
  const repoName = repo(data) || "?";
  const number = issue.number ?? "?";
  const excerpt = firstLine(comment.body, 200);
  const url = comment.html_url ?? issue.html_url;

  const lines = [
    `<b>Issue comment</b> on <code>${esc(repoName)}</code> #${esc(number)} <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (excerpt) {
    lines.push(esc(excerpt));
  }
  if (url) {
    lines.push(link(url, "View comment"));
  }
  return lines.join("\n");
}

function summarizePullRequestReview(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const review = ensureMapping(data.review);
  const pr = ensureMapping(data.pull_request);
  const actorName = actor(data) || UNKNOWN;
  const repoName = repo(data) || "?";
  const number = pr.number ?? data.number ?? "?";
  const state = review.state ?? "";
  const body = firstLine(review.body, 200);
  const url = review.html_url ?? pr.html_url;

  const lines = [
    `<b>Pull request review</b> on <code>${esc(repoName)}</code> #${esc(number)} <b>${esc(action || state)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (state && state.toLowerCase() !== String(action).toLowerCase()) {
    lines.push(`state: <code>${esc(state)}</code>`);
  }
  if (body) {
    lines.push(esc(body));
  }
  if (url) {
    lines.push(link(url, "View review"));
  }
  return lines.join("\n");
}

function summarizePullRequestReviewComment(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const comment = ensureMapping(data.comment);
  const pr = ensureMapping(data.pull_request);
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  const number = pr.number ?? data.number ?? "?";
  const path = comment.path ?? "";
  const position = comment.position;
  const body = firstLine(comment.body, 200);
  const url = comment.html_url ?? pr.html_url;

  const lines = [
    `<b>PR review comment</b> on <code>${esc(repoName)}</code> #${esc(number)} <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (path) {
    const positionText = position !== undefined && position !== null ? ` (line ${position})` : "";
    lines.push(`file: <code>${esc(path)}</code>${positionText}`);
  }
  if (body) {
    lines.push(esc(body));
  }
  if (url) {
    lines.push(link(url, "View comment"));
  }
  return lines.join("\n");
}

function summarizePullRequestReviewThread(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const thread = ensureMapping(data.thread);
  const pr = ensureMapping(data.pull_request);
  const repoName = repo(data) || "?";
  const number = pr.number ?? data.number ?? "?";
  const actorName = actor(data) || UNKNOWN;
  const url = thread.html_url ?? pr.html_url;
  const path = thread.path ?? "";

  const lines = [
    `<b>PR review thread</b> on <code>${esc(repoName)}</code> #${esc(number)} <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (path) {
    lines.push(`file: <code>${esc(path)}</code>`);
  }
  if (url) {
    lines.push(link(url, "View thread"));
  }
  return lines.join("\n");
}

function summarizeRelease(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const release = ensureMapping(data.release);
  const repoName = repo(data) || "?";
  const name = release.name ?? release.tag_name ?? "release";
  const url = release.html_url;
  const body = firstLine(release.body, 200);
  const draft = release.draft ? " (draft)" : "";
  const prerelease = release.prerelease ? " (pre-release)" : "";
  const actorName = actor(data) || UNKNOWN;

  const lines = [
    `<b>Release</b> <code>${esc(repoName)}</code> <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`,
    `<b>${esc(name)}</b>${draft}${prerelease}`,
  ];
  if (body) {
    lines.push(esc(body));
  }
  if (url) {
    lines.push(link(url, "View release"));
  }
  return lines.join("\n");
}

function summarizeStatus(payload: Payload): string {
  const data = ensureMapping(payload);
  const state = data.state ?? "";
  const repoName = repo(data) || "?";
  const sha = typeof data.sha === "string" ? data.sha.slice(0, 7) : "";
  const context = data.context ?? "";
  const description = data.description ?? "";
  const targetUrl = data.target_url ?? "";

  const lines = [
    `<b>Status</b> <code>${esc(repoName)}</code> <code>${esc(context)}</code> → <b>${esc(state)}</b> for <code>${esc(sha)}</code>`,
  ];
  if (description) {
    lines.push(esc(description));
  }
  if (targetUrl) {
    lines.push(link(targetUrl, "View status"));
  }
  return lines.join("\n");
}

function summarizeDeployment(payload: Payload): string {
  const data = ensureMapping(payload);
  const deployment = ensureMapping(data.deployment);
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  const environment = deployment.environment ?? "?";
  const ref = deployment.ref ?? "";
  const description = deployment.description ?? "";
  const url = deployment.statuses_url ?? deployment.url;

  const lines = [
    `<b>Deployment</b> <code>${esc(repoName)}</code> → <b>${esc(environment)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (ref) {
    lines.push(`ref: <code>${esc(ref)}</code>`);
  }
  if (description) {
    lines.push(esc(description));
  }
  if (url) {
    lines.push(link(url, "Deployment API"));
  }
  return lines.join("\n");
}

function summarizeDeploymentStatus(payload: Payload): string {
  const data = ensureMapping(payload);
  const deployment = ensureMapping(data.deployment);
  const status = ensureMapping(data.deployment_status);
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  const environment = deployment.environment ?? status.environment ?? "?";
  const state = status.state ?? "";
  const description = status.description ?? "";
  const targetUrl = status.target_url ?? "";

  const lines = [
    `<b>Deployment status</b> <code>${esc(repoName)}</code> → <b>${esc(environment)}</b> is <b>${esc(state)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (description) {
    lines.push(esc(description));
  }
  if (targetUrl) {
    lines.push(link(targetUrl, "Target"));
  }
  return lines.join("\n");
}

function summarizeDeploymentReview(payload: Payload): string {
  const data = ensureMapping(payload);
  const deployment = ensureMapping(data.deployment);
  const review = ensureMapping(data.review);
  const environment = deployment.environment ?? review.environment ?? "?";
  const state = review.state ?? "";
  const actorName = actor(data) || UNKNOWN;
  const repoName = repo(data) || "?";
  const url = review.html_url;

  const lines = [
    `<b>Deployment review</b> <code>${esc(repoName)}</code> → <b>${esc(environment)}</b> <b>${esc(state)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (url) {
    lines.push(link(url, "View review"));
  }
  return lines.join("\n");
}

function summarizeDeploymentProtectionRule(payload: Payload): string {
  const data = ensureMapping(payload);
  const environment = data.environment ?? dig(data, ["deployment_protection_rule", "environment"]) ?? "?";
  const actorName = actor(data) || UNKNOWN;
  const action = data.action ?? "";
  const repoName = repo(data) || "?";

  return `<b>Deployment protection rule</b> <code>${esc(repoName)}</code> → <b>${esc(environment)}</b> <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`;
}

function summarizeDiscussion(payload: Payload): string {
  const data = ensureMapping(payload);
  const discussion = ensureMapping(data.discussion);
  const action = data.action ?? "";
  const title = discussion.title ?? "";
  const url = discussion.html_url;
  const repoName = repo(data);
  const actorName = actor(data) || UNKNOWN;
  const category = dig(discussion, ["category", "name"]) ?? "";

  let head = `<b>Discussion</b> <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`;
  if (repoName) {
    head += ` in <code>${esc(repoName)}</code>`;
  }
  const lines = [head];
  if (title) {
    lines.push(`<b>${esc(title)}</b>`);
  }
  if (category) {
    lines.push(`category: <code>${esc(category)}</code>`);
  }
  if (url) {
    lines.push(link(url, "View discussion"));
  }
  return lines.join("\n");
}

function summarizeDiscussionComment(payload: Payload): string {
  const data = ensureMapping(payload);
  const discussion = ensureMapping(data.discussion);
  const comment = ensureMapping(data.comment);
  const action = data.action ?? "";
  const actorName = actor(data) || UNKNOWN;
  const url = comment.html_url ?? discussion.html_url;
  const body = firstLine(comment.body, 200);
  const title = discussion.title ?? "";

  let head = `<b>Discussion comment</b> <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`;
  if (title) {
    head += ` on <b>${esc(title)}</b>`;
  }
  const lines = [head];
  if (body) {
    lines.push(esc(body));
  }
  if (url) {
    lines.push(link(url, "View comment"));
  }
  return lines.join("\n");
}

function summarizeFork(payload: Payload): string {
  const data = ensureMapping(payload);
  const repoName = repo(data) || "?";
  const forkee = ensureMapping(data.forkee);
  const forkFull = forkee.full_name ?? forkee.name ?? "?";
  const forkUrl = forkee.html_url ?? forkee.svn_url;
  const actorName = actor(data) || UNKNOWN;

  const lines = [
    `<b>Fork</b> of <code>${esc(repoName)}</code> created by <b>${esc(actorName)}</b>`,
    `new repo: <code>${esc(forkFull)}</code>`,
  ];
  if (forkUrl) {
    lines.push(link(forkUrl, "View fork"));
  }
  return lines.join("\n");
}

function summarizeGollum(payload: Payload): string {
  const data = ensureMapping(payload);
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;

  const lines = [
    `<b>Wiki update</b> in <code>${esc(repoName)}</code> by <b>${esc(actorName)}</b>`,
  ];
  for (const page of pages) {
    const pageData = ensureMapping(page);
    const title = pageData.title ?? "page";
    const action = pageData.action ?? "";
    const url = pageData.html_url ?? pageData.page_name;
    lines.push(`• <b>${esc(action)}</b> ${esc(title)}`);
    if (url) {
      lines.push(link(url, "View page"));
    }
  }
  return lines.join("\n");
}

function summarizeInstallation(payload: Payload): string {
  const data = ensureMapping(payload);
  const installation = ensureMapping(data.installation);
  const action = data.action ?? "";
  const account = ensureMapping(installation.account);
  const accountLogin = account.login ?? account.name ?? "?";
  const repositories = Array.isArray(installation.repositories) ? installation.repositories : [];
  const repoCount = repositories.length;

  const lines = [
    `<b>Installation</b> <b>${esc(action)}</b> for <b>${esc(accountLogin)}</b>`,
  ];
  if (repoCount > 0) {
    const sample = repositories.slice(0, 5).map((repoInfo) => {
      const repoData = ensureMapping(repoInfo);
      return esc(repoData.full_name ?? repoData.name ?? "?");
    });
    let summary = sample.join(", ");
    if (repoCount > 5) {
      summary += ` … (+${repoCount - 5})`;
    }
    lines.push(`repositories: ${summary}`);
  }
  return lines.join("\n");
}

function summarizeInstallationRepositories(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const installation = ensureMapping(data.installation);
  const account = ensureMapping(installation.account);
  const accountLogin = account.login ?? account.name ?? "?";
  const added = Array.isArray(data.repositories_added) ? data.repositories_added : [];
  const removed = Array.isArray(data.repositories_removed) ? data.repositories_removed : [];
  const lines = [
    `<b>Installation repositories</b> <b>${esc(action)}</b> for <b>${esc(accountLogin)}</b>`,
  ];
  if (added.length > 0) {
    let text = added
      .slice(0, 5)
      .map((repoData) => {
        const repoInfo = ensureMapping(repoData);
        return esc(repoInfo.full_name ?? repoInfo.name ?? "?");
      })
      .join(", ");
    const more = added.length - 5;
    if (more > 0) {
      text += ` … (+${more})`;
    }
    lines.push(`added: ${text}`);
  }
  if (removed.length > 0) {
    let text = removed
      .slice(0, 5)
      .map((repoData) => {
        const repoInfo = ensureMapping(repoData);
        return esc(repoInfo.full_name ?? repoInfo.name ?? "?");
      })
      .join(", ");
    const more = removed.length - 5;
    if (more > 0) {
      text += ` … (+${more})`;
    }
    lines.push(`removed: ${text}`);
  }
  return lines.join("\n");
}

function summarizeInstallationTarget(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const installation = ensureMapping(data.installation);
  const account = ensureMapping(installation.account);
  const targetType = installation.target_type ?? "";
  const login = account.login ?? account.name ?? "?";
  const repoSelection = installation.repository_selection ?? "";
  const lines = [
    `<b>Installation target</b> <b>${esc(action)}</b> for <b>${esc(login)}</b>`,
  ];
  if (targetType) {
    lines.push(`target: <code>${esc(targetType)}</code>`);
  }
  if (repoSelection) {
    lines.push(`repository_selection: <code>${esc(repoSelection)}</code>`);
  }
  return lines.join("\n");
}

function summarizeMember(payload: Payload): string {
  return genericActionSummary("Member", payload, {
    subject: "member",
    subjectFields: [
      ["login"],
      ["name"],
    ],
  });
}

function summarizeMembership(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const team = ensureMapping(data.team);
  const org = ensureMapping(data.organization);
  const user = ensureMapping(data.user);
  const teamName = team.name ?? team.slug ?? "team";
  const orgLogin = org.login ?? "?";
  const userLogin = user.login ?? user.name ?? "?";

  const lines = [
    `<b>Membership</b> <b>${esc(action)}</b> in <b>${esc(teamName)}</b> @${esc(orgLogin)}`,
    `member: <b>${esc(userLogin)}</b>`,
  ];
  return lines.join("\n");
}

function summarizeMeta(payload: Payload): string {
  const data = ensureMapping(payload);
  const hook = ensureMapping(data.hook);
  const hookId = hook.id ?? "?";
  const changes = ensureMapping(data.changes);
  const line = `<b>Meta</b> webhook <code>${esc(hookId)}</code> updated: ${esc(JSON.stringify(changes))}`;
  return line;
}

function summarizeMilestone(payload: Payload): string {
  return genericActionSummary("Milestone", payload, {
    subject: "milestone",
    subjectFields: [
      ["title"],
      ["description"],
      ["number"],
    ],
  });
}

function summarizeOrgBlock(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const organization = ensureMapping(data.organization);
  const blockedUser = ensureMapping(data.blocked_user);
  const orgLogin = organization.login ?? "?";
  const userLogin = blockedUser.login ?? blockedUser.name ?? "?";

  return `<b>Org block</b> <b>${esc(action)}</b> @${esc(orgLogin)} user <b>${esc(userLogin)}</b>`;
}

function summarizeOrganization(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const membership = ensureMapping(data.membership);
  const invitation = ensureMapping(data.invitation);
  const lines = [`<b>Organization</b> <b>${esc(action)}</b>`];
  if (membership && Object.keys(membership).length > 0) {
    const login = membership.user?.login ?? "?";
    const role = membership.role ?? "";
    lines.push(`member: <b>${esc(login)}</b> role <code>${esc(role)}</code>`);
  }
  if (invitation && Object.keys(invitation).length > 0) {
    const invitee = invitation.login ?? invitation.email ?? "?";
    lines.push(`invitation: <code>${esc(invitee)}</code>`);
  }
  return lines.join("\n");
}

function summarizePageBuild(payload: Payload): string {
  const data = ensureMapping(payload);
  const build = ensureMapping(data.build);
  const status = build.status ?? "";
  const url = build.url ?? "";
  const error = ensureMapping(build.error);
  const message = error.message ?? "";
  const repoName = repo(data) || "?";

  const lines = [`<b>Page build</b> <code>${esc(repoName)}</code> → <b>${esc(status)}</b>`];
  if (message) {
    lines.push(esc(message));
  }
  if (url) {
    lines.push(link(url, "View build"));
  }
  return lines.join("\n");
}

function summarizePersonalAccessTokenRequest(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const request = ensureMapping(data.personal_access_token_request);
  const requestId = request.id ?? "?";
  const state = request.state ?? "";
  const actorName = actor(data) || UNKNOWN;
  const org = dig(data, ["organization", "login"]) ?? "?";

  const lines = [
    `<b>Personal access token request</b> <b>${esc(action)}</b> — request <code>${esc(requestId)}</code> for @${esc(org)}`,
  ];
  if (state) {
    lines.push(`state: <code>${esc(state)}</code>`);
  }
  lines.push(`by <b>${esc(actorName)}</b>`);
  return lines.join("\n");
}

function summarizeProject(payload: Payload): string {
  return genericActionSummary("Project", payload, {
    subject: "project",
    subjectFields: [
      ["name"],
      ["body"],
      ["number"],
    ],
  });
}

function summarizeProjectCard(payload: Payload): string {
  return genericActionSummary("Project card", payload, {
    subject: "project_card",
    subjectFields: [
      ["note"],
      ["column_name"],
      ["id"],
    ],
  });
}

function summarizeProjectColumn(payload: Payload): string {
  return genericActionSummary("Project column", payload, {
    subject: "project_column",
    subjectFields: [
      ["name"],
      ["id"],
    ],
  });
}

function summarizeProjectsV2(payload: Payload): string {
  return genericActionSummary("Project", payload, {
    subject: "projects_v2",
    subjectFields: [
      ["title"],
      ["number"],
      ["id"],
    ],
  });
}

function summarizeProjectsV2Item(payload: Payload): string {
  return genericActionSummary("Project item", payload, {
    subject: "projects_v2_item",
    subjectFields: [
      ["title"],
      ["content_type"],
      ["id"],
    ],
  });
}

function summarizeProjectsV2StatusUpdate(payload: Payload): string {
  return genericActionSummary("Project status update", payload, {
    subject: "projects_v2_status_update",
    subjectFields: [
      ["status"],
      ["title"],
      ["id"],
    ],
  });
}

function summarizePublic(payload: Payload): string {
  const data = ensureMapping(payload);
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  return `<b>Repository public</b> <code>${esc(repoName)}</code> by <b>${esc(actorName)}</b>`;
}

function summarizeRegistryPackage(payload: Payload): string {
  return genericActionSummary("Registry package", payload, {
    subject: "registry_package",
    subjectFields: [
      ["name"],
      ["package_type"],
      ["id"],
    ],
  });
}

function summarizeRepository(payload: Payload): string {
  return genericActionSummary("Repository", payload, {
    subject: "repository",
    subjectFields: [
      ["full_name"],
      ["name"],
      ["id"],
    ],
  });
}

function summarizeRepositoryDispatch(payload: Payload): string {
  const data = ensureMapping(payload);
  const eventType = data.action ?? data.event_type ?? "dispatch";
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  const lines = [
    `<b>Repository dispatch</b> <code>${esc(repoName)}</code> event <code>${esc(eventType)}</code> by <b>${esc(actorName)}</b>`,
  ];
  const clientPayload = data.client_payload;
  if (clientPayload && typeof clientPayload === "object") {
    const entries = Object.entries(clientPayload).slice(0, 6);
    if (entries.length > 0) {
      const snippet = entries
        .map(([key, value]) => `${esc(key)}=${esc(value)}`)
        .join(", ");
      lines.push(`payload: ${snippet}`);
    }
  }
  return lines.join("\n");
}

function summarizeRepositoryImport(payload: Payload): string {
  const data = ensureMapping(payload);
  const status = data.status ?? "";
  const repoName = repo(data) || "?";
  const human = data.human_name ?? "";
  const progress = data.progress;

  const lines = [`<b>Repository import</b> <code>${esc(repoName)}</code> → <b>${esc(status)}</b>`];
  if (human) {
    lines.push(esc(human));
  }
  if (progress !== undefined && progress !== null) {
    lines.push(`progress: <code>${esc(progress)}</code>`);
  }
  return lines.join("\n");
}

function summarizeRepositoryRuleset(payload: Payload): string {
  return genericActionSummary("Repository ruleset", payload, {
    subject: "ruleset",
    subjectFields: [
      ["name"],
      ["target"],
      ["id"],
    ],
  });
}

function summarizeRepositoryVulnerabilityAlert(payload: Payload): string {
  const data = ensureMapping(payload);
  const alert = ensureMapping(data.alert);
  const action = data.action ?? "";
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  const dependency = ensureMapping(alert.affected_package);
  const packageName =
    dependency.name ??
    dig(alert, ["security_advisory", "summary"]) ??
    "dependency";
  const severity = dig(alert, ["security_advisory", "severity"]) ?? "";
  const url = dig(alert, ["security_advisory", "html_url"]);

  const lines = [
    `<b>Repository vulnerability alert</b> <code>${esc(repoName)}</code> <b>${esc(action)}</b> — <b>${esc(packageName)}</b> by <b>${esc(actorName)}</b>`,
  ];
  if (severity) {
    lines.push(`severity: <code>${esc(severity)}</code>`);
  }
  if (url) {
    lines.push(link(url, "View advisory"));
  }
  return lines.join("\n");
}

function summarizeSecretScanningAlert(payload: Payload): string {
  const data = ensureMapping(payload);
  const alert = ensureMapping(data.alert);
  const action = data.action ?? "";
  const repoName = repo(data) || "?";
  const secretType = alert.secret_type_display_name ?? alert.secret_type ?? "secret";
  const state = alert.state ?? "";
  const url = alert.html_url;

  const lines = [
    `<b>Secret scanning alert</b> <code>${esc(repoName)}</code> <b>${esc(action)}</b> — <b>${esc(secretType)}</b>`,
  ];
  if (state) {
    lines.push(`state: <code>${esc(state)}</code>`);
  }
  if (url) {
    lines.push(link(url, "View alert"));
  }
  return lines.join("\n");
}

function summarizeSecretScanningAlertLocation(payload: Payload): string {
  const data = ensureMapping(payload);
  const location = ensureMapping(data.location);
  const alert = ensureMapping(data.alert);
  const repoName = repo(data) || "?";
  const typeName = location.type ?? "location";
  const details = ensureMapping(location.details);
  const path = details.path ?? "";
  const url = alert.html_url;

  const lines = [`<b>Secret scanning location</b> <code>${esc(repoName)}</code> → <b>${esc(typeName)}</b>`];
  if (path) {
    lines.push(`path: <code>${esc(path)}</code>`);
  }
  if (url) {
    lines.push(link(url, "View alert"));
  }
  return lines.join("\n");
}

function summarizeSecretScanningScan(payload: Payload): string {
  return genericActionSummary("Secret scanning scan", payload);
}

function summarizeSecurityAdvisory(payload: Payload): string {
  return genericActionSummary("Security advisory", payload, {
    subject: "security_advisory",
    subjectFields: [
      ["summary"],
      ["ghsa_id"],
      ["cve_id"],
    ],
  });
}

function summarizeSecurityAndAnalysis(payload: Payload): string {
  return genericActionSummary("Security & analysis", payload, {
    subject: "security_and_analysis",
  });
}

function summarizeSponsorship(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const sponsorship = ensureMapping(data.sponsorship);
  const sponsor = sponsorship.sponsor ?? sponsorship.account; // backward compat
  const sponsorName = ensureMapping(sponsor).login ?? ensureMapping(sponsor).name ?? "sponsor";
  const sponsorable = ensureMapping(sponsorship.sponsorable);
  const sponsorableName = sponsorable.login ?? sponsorable.name ?? "sponsorable";
  const tier = ensureMapping(sponsorship.tier);
  const amount = tier.monthly_price_in_dollars ?? tier.monthly_price ?? "";
  const tierName = tier.name ?? "";

  const lines = [
    `<b>Sponsorship</b> <b>${esc(action)}</b> — <b>${esc(sponsorName)}</b> → <b>${esc(sponsorableName)}</b>`,
  ];
  if (tierName) {
    lines.push(`tier: <code>${esc(tierName)}</code>`);
  }
  if (amount) {
    lines.push(`amount: <code>${esc(amount)}</code>`);
  }
  return lines.join("\n");
}

function summarizeStar(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  return `<b>Star</b> <code>${esc(repoName)}</code> <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`;
}

function summarizeSubIssues(payload: Payload): string {
  return genericActionSummary("Sub-issues", payload, {
    subject: ["sub_issue", "issue"],
    subjectFields: [
      ["title"],
      ["number"],
    ],
  });
}

function summarizeTeam(payload: Payload): string {
  return genericActionSummary("Team", payload, {
    subject: "team",
    subjectFields: [
      ["name"],
      ["slug"],
      ["id"],
    ],
  });
}

function summarizeTeamAdd(payload: Payload): string {
  const data = ensureMapping(payload);
  const team = ensureMapping(data.team);
  const repoData = ensureMapping(data.repository);
  const teamName = team.name ?? team.slug ?? "team";
  const repoName = repoData.full_name ?? repoData.name ?? "repository";
  return `<b>Team add</b> team <b>${esc(teamName)}</b> added to <code>${esc(repoName)}</code>`;
}

function summarizeWatch(payload: Payload, event: string): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "started";
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  return `<b>${esc(prettyLabel(event))}</b> <code>${esc(repoName)}</code> <b>${esc(action)}</b> by <b>${esc(actorName)}</b>`;
}

function summarizeWorkflowDispatch(payload: Payload): string {
  return genericActionSummary("Workflow dispatch", payload, {
    subject: "workflow",
    subjectFields: [
      ["name"],
      ["path"],
    ],
  });
}

function summarizeWorkflowJob(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const workflowJob = ensureMapping(data.workflow_job);
  const name = workflowJob.name ?? "job";
  const status = workflowJob.status ?? "";
  const conclusion = workflowJob.conclusion ?? "";
  const steps = Array.isArray(workflowJob.steps) ? workflowJob.steps : [];

  const lines = [
    `<b>Workflow job</b> <b>${esc(action)}</b> — <b>${esc(name)}</b>`,
  ];
  if (status) {
    lines.push(`status: <code>${esc(status)}</code>`);
  }
  if (conclusion) {
    lines.push(`conclusion: <code>${esc(conclusion)}</code>`);
  }
  if (steps.length > 0) {
    steps.slice(0, 5).forEach((step: any) => {
      const stepData = ensureMapping(step);
      lines.push(`• ${esc(stepData.name ?? "step")} (${esc(stepData.conclusion ?? stepData.status ?? "")})`);
    });
    if (steps.length > 5) {
      lines.push(`<i>+${steps.length - 5} more steps</i>`);
    }
  }
  return lines.join("\n");
}

function summarizeWorkflowRun(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const workflowRun = ensureMapping(data.workflow_run);
  const name = workflowRun.name ?? "workflow";
  const status = workflowRun.status ?? "";
  const conclusion = workflowRun.conclusion ?? "";
  const url = workflowRun.html_url ?? workflowRun.url;
  const repoName = repo(data) || "?";

  const lines = [
    `<b>Workflow run</b> <code>${esc(repoName)}</code> <b>${esc(action)}</b> — <b>${esc(name)}</b>`,
  ];
  if (status) {
    lines.push(`status: <code>${esc(status)}</code>`);
  }
  if (conclusion) {
    lines.push(`conclusion: <code>${esc(conclusion)}</code>`);
  }
  if (url) {
    lines.push(link(url, "View run"));
  }
  return lines.join("\n");
}

function summarizeCheckRun(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const checkRun = ensureMapping(data.check_run);
  const name = checkRun.name ?? "check";
  const status = checkRun.status ?? "";
  const conclusion = checkRun.conclusion ?? "";
  const url = checkRun.html_url ?? checkRun.details_url;
  const output = ensureMapping(checkRun.output);
  const summary = firstLine(output.summary, 200);
  const text = firstLine(output.text, 200);

  const lines = [`<b>Check run</b> <b>${esc(action)}</b> — <b>${esc(name)}</b>`];
  if (status) {
    lines.push(`status: <code>${esc(status)}</code>`);
  }
  if (conclusion) {
    lines.push(`conclusion: <code>${esc(conclusion)}</code>`);
  }
  if (summary) {
    lines.push(esc(summary));
  } else if (text) {
    lines.push(esc(text));
  }
  if (url) {
    lines.push(link(url, "View check"));
  }
  return lines.join("\n");
}

function summarizeCheckSuite(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const checkSuite = ensureMapping(data.check_suite);
  const status = checkSuite.status ?? "";
  const conclusion = checkSuite.conclusion ?? "";
  const url = checkSuite.html_url ?? checkSuite.url;
  const lines = [`<b>Check suite</b> <b>${esc(action)}</b>`];
  if (status) {
    lines.push(`status: <code>${esc(status)}</code>`);
  }
  if (conclusion) {
    lines.push(`conclusion: <code>${esc(conclusion)}</code>`);
  }
  if (url) {
    lines.push(link(url, "View suite"));
  }
  return lines.join("\n");
}

function summarizeCodeScanningAlert(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const alert = ensureMapping(data.alert);
  const rule = ensureMapping(alert.rule);
  const ruleId = rule.id ?? rule.security_severity_level ?? "rule";
  const severity = alert.severity ?? alert.security_severity_level ?? "";
  const url = alert.html_url ?? "";

  const lines = [`<b>Code scanning alert</b> <b>${esc(action)}</b> — <b>${esc(ruleId)}</b>`];
  if (severity) {
    lines.push(`severity: <code>${esc(severity)}</code>`);
  }
  if (url) {
    lines.push(link(url, "View alert"));
  }
  return lines.join("\n");
}

function summarizeCommitComment(payload: Payload): string {
  const data = ensureMapping(payload);
  const comment = ensureMapping(data.comment);
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  const body = firstLine(comment.body, 200);
  const url = comment.html_url;
  const commitId = comment.commit_id ?? "";

  const lines = [`<b>Commit comment</b> on <code>${esc(repoName)}</code> by <b>${esc(actorName)}</b>`];
  if (commitId) {
    lines.push(`sha: <code>${esc(commitId.slice(0, 7))}</code>`);
  }
  if (body) {
    lines.push(esc(body));
  }
  if (url) {
    lines.push(link(url, "View comment"));
  }
  return lines.join("\n");
}

function summarizeDependabotAlert(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const alert = ensureMapping(data.alert);
  const dependency = ensureMapping(alert.dependency);
  const packageName = dependency.package?.name ?? "dependency";
  const severity = alert.security_vulnerability?.severity ?? "";
  const advisoryUrl = alert.security_advisory?.ghsa_id ?? "";

  const lines = [`<b>Dependabot alert</b> <b>${esc(action)}</b> — <b>${esc(packageName)}</b>`];
  if (severity) {
    lines.push(`severity: <code>${esc(severity)}</code>`);
  }
  if (advisoryUrl) {
    lines.push(`advisory: <code>${esc(advisoryUrl)}</code>`);
  }
  return lines.join("\n");
}

function summarizeLabel(payload: Payload): string {
  return genericActionSummary("Label", payload, {
    subject: "label",
    subjectFields: [
      ["name"],
      ["color"],
      ["id"],
    ],
  });
}

function summarizePackage(payload: Payload): string {
  return genericActionSummary("Package", payload, {
    subject: "package",
    subjectFields: [
      ["name"],
      ["package_type"],
      ["id"],
    ],
  });
}

function summarizeRepositoryAdvisory(payload: Payload): string {
  return genericActionSummary("Repository advisory", payload, {
    subject: "repository_advisory",
    subjectFields: [
      ["summary"],
      ["ghsa_id"],
      ["cve_id"],
    ],
  });
}

function summarizeCustomProperty(payload: Payload): string {
  return genericActionSummary("Custom property", payload, {
    subject: "custom_property",
    subjectFields: [
      ["name"],
      ["full_name"],
      ["id"],
    ],
  });
}

function summarizeCustomPropertyValues(payload: Payload): string {
  const data = ensureMapping(payload);
  const repoName = repo(data) || "?";
  const actorName = actor(data) || UNKNOWN;
  const newValues = Array.isArray(data.new_property_values) ? data.new_property_values : [];
  const oldValues = Array.isArray(data.old_property_values) ? data.old_property_values : [];

  const lines = [
    `<b>Custom property values</b> updated in <code>${esc(repoName)}</code> by <b>${esc(actorName)}</b>`,
  ];
  if (newValues.length > 0) {
    lines.push(`${newValues.length} new values`);
  }
  if (oldValues.length > 0) {
    lines.push(`${oldValues.length} previous values`);
  }
  return lines.join("\n");
}

function summarizeDeployKey(payload: Payload): string {
  return genericActionSummary("Deploy key", payload, {
    subject: "key",
    subjectFields: [
      ["title"],
      ["id"],
      ["fingerprint"],
    ],
  });
}

function summarizeGithubAppAuthorization(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const user = ensureMapping(data.sender);
  const login = user.login ?? user.name ?? "user";
  return `<b>GitHub App authorization</b> <b>${esc(action)}</b> by <b>${esc(login)}</b>`;
}

function summarizeIssueDependencies(payload: Payload): string {
  return genericActionSummary("Issue dependencies", payload, {
    subject: ["dependent", "issue"],
    subjectFields: [
      ["title"],
      ["number"],
    ],
  });
}

function summarizeBranchProtectionConfiguration(payload: Payload): string {
  return genericActionSummary("Branch protection configuration", payload);
}

function summarizeBranchProtectionRule(payload: Payload): string {
  return genericActionSummary("Branch protection rule", payload, {
    subject: "rule",
    subjectFields: [
      ["name"],
      ["pattern"],
      ["id"],
    ],
  });
}

function summarizeMarketplacePurchase(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const account = ensureMapping(data.marketplace_purchase?.account);
  const login = account.login ?? account.name ?? "?";
  const plan = ensureMapping(data.marketplace_purchase?.plan);
  const planName = plan.name ?? "plan";
  const unitPrice = plan.price_per_unit ?? 0;
  const unitCount = data.marketplace_purchase?.units ?? 0;
  const total = unitPrice * unitCount;

  const lines = [
    `<b>Marketplace purchase</b> <b>${esc(action)}</b> by <b>${esc(login)}</b>`,
    `plan: <code>${esc(planName)}</code> (${unitCount} × ${unitPrice}) = ${total}`,
  ];
  return lines.join("\n");
}

function summarizeMergeGroup(payload: Payload): string {
  const data = ensureMapping(payload);
  const action = data.action ?? "";
  const mergeGroup = ensureMapping(data.merge_group);
  const headCommit = mergeGroup.head_commit ?? "";
  const headSha = typeof headCommit === "string" ? headCommit.slice(0, 7) : "";
  return `<b>Merge group</b> <b>${esc(action)}</b> head <code>${esc(headSha)}</code>`;
}

function summarizeMetaEvent(payload: Payload): string {
  return summarizeMeta(payload);
}

function summarizeOrg(payload: Payload): string {
  return summarizeOrganization(payload);
}

function summarizeSponsorshipEvent(payload: Payload): string {
  return summarizeSponsorship(payload);
}

function summarizeWatchDefault(payload: Payload, event: string): string {
  return summarizeWatch(payload, event);
}

function summarizeWorkflow(payload: Payload): string {
  return summarizeWorkflowRun(payload);
}

const EVENTS_METADATA: Record<string, { handler?: Handler; label?: string }> = {
  branch_protection_configuration: { handler: summarizeBranchProtectionConfiguration },
  branch_protection_rule: { handler: summarizeBranchProtectionRule },
  check_run: { handler: summarizeCheckRun },
  check_suite: { handler: summarizeCheckSuite },
  code_scanning_alert: { handler: summarizeCodeScanningAlert },
  commit_comment: { handler: summarizeCommitComment },
  create: { handler: summarizeCreate },
  custom_property: { handler: summarizeCustomProperty },
  custom_property_values: { handler: summarizeCustomPropertyValues },
  delete: { handler: summarizeDelete },
  dependabot_alert: { handler: summarizeDependabotAlert },
  deploy_key: { handler: summarizeDeployKey },
  deployment: { handler: summarizeDeployment },
  deployment_protection_rule: { handler: summarizeDeploymentProtectionRule },
  deployment_review: { handler: summarizeDeploymentReview },
  deployment_status: { handler: summarizeDeploymentStatus },
  discussion: { handler: summarizeDiscussion },
  discussion_comment: { handler: summarizeDiscussionComment },
  fork: { handler: summarizeFork },
  github_app_authorization: { handler: summarizeGithubAppAuthorization },
  gollum: { handler: summarizeGollum },
  installation: { handler: summarizeInstallation },
  installation_repositories: { handler: summarizeInstallationRepositories },
  installation_target: { handler: summarizeInstallationTarget },
  issue_comment: { handler: summarizeIssueComment },
  issue_dependencies: { handler: summarizeIssueDependencies },
  issues: { handler: summarizeIssues },
  label: { handler: summarizeLabel },
  marketplace_purchase: { handler: summarizeMarketplacePurchase },
  member: { handler: summarizeMember },
  membership: { handler: summarizeMembership },
  merge_group: { handler: summarizeMergeGroup },
  meta: { handler: summarizeMetaEvent },
  milestone: { handler: summarizeMilestone },
  org_block: { handler: summarizeOrgBlock },
  organization: { handler: summarizeOrganization },
  package: { handler: summarizePackage },
  page_build: { handler: summarizePageBuild },
  personal_access_token_request: { handler: summarizePersonalAccessTokenRequest },
  ping: { handler: summarizePing },
  project: { handler: summarizeProject },
  project_card: { handler: summarizeProjectCard },
  project_column: { handler: summarizeProjectColumn },
  projects_v2: { handler: summarizeProjectsV2 },
  projects_v2_item: { handler: summarizeProjectsV2Item },
  projects_v2_status_update: { handler: summarizeProjectsV2StatusUpdate },
  public: { handler: summarizePublic },
  pull_request: { handler: summarizePullRequest },
  pull_request_review: { handler: summarizePullRequestReview },
  pull_request_review_comment: { handler: summarizePullRequestReviewComment },
  pull_request_review_thread: { handler: summarizePullRequestReviewThread },
  push: { handler: summarizePush },
  registry_package: { handler: summarizeRegistryPackage },
  release: { handler: summarizeRelease },
  repository: { handler: summarizeRepository },
  repository_advisory: { handler: summarizeRepositoryAdvisory },
  repository_dispatch: { handler: summarizeRepositoryDispatch },
  repository_import: { handler: summarizeRepositoryImport },
  repository_ruleset: { handler: summarizeRepositoryRuleset },
  repository_vulnerability_alert: { handler: summarizeRepositoryVulnerabilityAlert },
  secret_scanning_alert: { handler: summarizeSecretScanningAlert },
  secret_scanning_alert_location: { handler: summarizeSecretScanningAlertLocation },
  secret_scanning_scan: { handler: summarizeSecretScanningScan },
  security_advisory: { handler: summarizeSecurityAdvisory },
  security_and_analysis: { handler: summarizeSecurityAndAnalysis },
  sponsorship: { handler: summarizeSponsorshipEvent },
  star: { handler: summarizeStar },
  status: { handler: summarizeStatus },
  sub_issues: { handler: summarizeSubIssues },
  team: { handler: summarizeTeam },
  team_add: { handler: summarizeTeamAdd },
  watch: { handler: summarizeWatchDefault },
  workflow_dispatch: { handler: summarizeWorkflowDispatch },
  workflow_job: { handler: summarizeWorkflowJob },
  workflow_run: { handler: summarizeWorkflowRun },
};

const HANDLERS: Record<string, Handler> = {};
for (const [event, meta] of Object.entries(EVENTS_METADATA)) {
  const handler = meta.handler;
  if (handler) {
    HANDLERS[event] = handler;
  } else {
    const label = meta.label ?? prettyLabel(event);
    HANDLERS[event] = (payload, evt) =>
      genericActionSummary(label, payload, { subject: null }) || fallbackSummary(evt, payload);
  }
}

function fallbackSummary(event: string, payload: Payload): string {
  const label = prettyLabel(event || "event");
  const repoName = repo(payload) || "";
  const actorName = actor(payload) || UNKNOWN;
  let line = `<b>${esc(label)}</b> event`;
  if (repoName) {
    line += ` for <code>${esc(repoName)}</code>`;
  }
  if (actorName) {
    line += ` by <b>${esc(actorName)}</b>`;
  }
  return line;
}

export function summarizeGithubEvent(event: string, payload: unknown): string {
  const eventKey = (event || "").toLowerCase();
  const mappedPayload = ensureMapping(payload);
  const handler = HANDLERS[eventKey];
  if (handler) {
    try {
      return handler(mappedPayload, eventKey);
    } catch (error) {
      return fallbackSummary(eventKey, mappedPayload);
    }
  }
  return fallbackSummary(eventKey, mappedPayload);
}

export const EVENT_NAMES = Object.keys(EVENTS_METADATA);
