"""Summaries for GitHub webhook events."""

from __future__ import annotations

from html import escape as _esc
from typing import Any, Callable, Iterable, Mapping, Sequence

MAX_COMMITS = 5  # Show up to five commits in push summaries.

Handler = Callable[[Mapping[str, Any], str], str]

UNKNOWN = "unknown"


def _esc_html(value: Any) -> str:
    return _esc(str(value or ""), quote=True)


def _link(url: str | None, text: str | None = None) -> str:
    if not url:
        return ""
    label = text or url
    return f'<a href="{_esc_html(url)}">{_esc_html(label)}</a>'


def _first_line(text: str | None, limit: int = 120) -> str:
    if not text:
        return ""
    return text.splitlines()[0][:limit]


def _dig(data: Any, path: Sequence[str]) -> Any:
    current = data
    for key in path:
        if not isinstance(current, Mapping):
            return None
        current = current.get(key)
        if current is None:
            return None
    return current


SUBJECT_NAME_FIELDS: tuple[Sequence[str], ...] = (
    ("title",),
    ("name",),
    ("login",),
    ("slug",),
    ("ref",),
    ("branch",),
    ("tag",),
    ("tag_name",),
    ("environment",),
    ("key",),
    ("pattern",),
    ("sha",),
    ("node_id",),
    ("id",),
    ("number",),
)

SUBJECT_URL_FIELDS: tuple[Sequence[str], ...] = (
    ("html_url",),
    ("url",),
    ("target_url",),
    ("links", "html"),
    ("links", "self"),
)


def _extract_subject(data: Any, *, fields: Iterable[Sequence[str]] | None = None) -> tuple[str, str]:
    if isinstance(data, Mapping):
        name_fields = tuple(fields) if fields else SUBJECT_NAME_FIELDS
        for candidate in name_fields:
            value = _dig(data, tuple(candidate))
            if value is None:
                continue
            if isinstance(value, (Mapping, list, tuple)):
                continue
            text = str(value).strip()
            if not text:
                continue
            if candidate[-1] == "number" and text and not text.startswith("#"):
                text = f"#{text}"
            if len(text) > 160:
                text = text[:157] + "..."
            break
        else:
            text = ""
        url_fields = SUBJECT_URL_FIELDS
        url = ""
        for candidate in url_fields:
            value = _dig(data, tuple(candidate))
            if isinstance(value, str) and value:
                url = value
                break
        return text, url
    if data in (None, ""):
        return "", ""
    text = str(data)
    if len(text) > 160:
        text = text[:157] + "..."
    return text, ""


def _resolve_subject(payload: Mapping[str, Any], spec: Any) -> Any:
    if spec is None:
        return None
    paths: list[Sequence[str]] = []
    if isinstance(spec, str):
        paths.append((spec,))
    elif isinstance(spec, Sequence):
        if spec and all(isinstance(item, str) for item in spec):
            paths.append(tuple(spec))
        else:
            for item in spec:
                if isinstance(item, str):
                    paths.append((item,))
                elif isinstance(item, Sequence):
                    paths.append(tuple(item))
    for path in paths:
        subject = _dig(payload, path)
        if subject:
            return subject
    return None


def _actor(payload: Mapping[str, Any]) -> str:
    for path in (
        ("sender", "login"),
        ("sender", "name"),
        ("user", "login"),
        ("user", "name"),
        ("actor", "login"),
        ("actor", "name"),
        ("pusher", "name"),
        ("pusher", "email"),
        ("installation", "account", "login"),
        ("installation", "account", "name"),
    ):
        value = _dig(payload, path)
        if isinstance(value, str) and value:
            return value
    return ""


def _repo(payload: Mapping[str, Any]) -> str:
    for path in (
        ("repository", "full_name"),
        ("repository", "name"),
    ):
        value = _dig(payload, path)
        if isinstance(value, str) and value:
            return value
    return ""


def _pretty_label(event: str) -> str:
    words = event.replace("_", " ").strip()
    return words.title() if words else "Event"


def _ensure_mapping(payload: Mapping[str, Any] | None) -> Mapping[str, Any]:
    return payload if isinstance(payload, Mapping) else {}


def _format_main_line(
    *,
    label: str,
    action: str,
    subject_name: str,
    repo_name: str,
    actor_name: str,
) -> str:
    line = f"<b>{_esc_html(label)}</b>"
    if subject_name:
        line += f": {_esc_html(subject_name)}"
    if action:
        line += f" <b>{_esc_html(action)}</b>"
    if repo_name:
        line += f" in <code>{_esc_html(repo_name)}</code>"
    if actor_name and actor_name != UNKNOWN:
        line += f" by <b>{_esc_html(actor_name)}</b>"
    return line


def _callable_extra(extra: Any, payload: Mapping[str, Any]) -> list[str]:
    if callable(extra):
        result = extra(payload)
        if isinstance(result, str):
            return [result]
        if isinstance(result, Iterable):
            return [str(item) for item in result if item]
        return []
    if isinstance(extra, str):
        return [extra]
    if isinstance(extra, Iterable):
        return [str(item) for item in extra if item]
    return []


def _generic_action_summary(
    label: str,
    payload: Mapping[str, Any],
    *,
    subject: Any = None,
    subject_fields: Iterable[Sequence[str]] | None = None,
    url_fields: Iterable[Sequence[str]] | None = None,
    extra: Any = None,
) -> str:
    payload = _ensure_mapping(payload)
    action = str(payload.get("action") or "").strip()
    actor = _actor(payload) or UNKNOWN
    repo_name = _repo(payload)

    subject_data = _resolve_subject(payload, subject)
    subject_name = ""
    subject_url = ""
    if subject_data is not None:
        subject_name, subject_url = _extract_subject(
            subject_data,
            fields=subject_fields,
        )
        if not subject_url and isinstance(subject_data, Mapping) and url_fields:
            for candidate in url_fields:
                value = _dig(subject_data, tuple(candidate))
                if isinstance(value, str) and value:
                    subject_url = value
                    break
    main = _format_main_line(
        label=label,
        action=action,
        subject_name=subject_name,
        repo_name=repo_name,
        actor_name=actor,
    )
    lines = [main]
    if subject_url:
        lines.append(_link(subject_url, "View details"))
    for line in _callable_extra(extra, payload):
        if line:
            lines.append(line)
    return "\n".join(lines)


def _summarize_ping(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    repo = _repo(payload) or "?"
    zen = payload.get("zen") or ""
    hook = _ensure_mapping(payload.get("hook"))
    hook_id = payload.get("hook_id") or hook.get("id") or "?"
    cfg = _ensure_mapping(hook.get("config"))
    events = hook.get("events") or []
    last_resp = _ensure_mapping(hook.get("last_response")).get("status") or "unknown"
    created_at = hook.get("created_at") or ""
    updated_at = hook.get("updated_at") or ""
    payload_url = cfg.get("url")
    test_url = hook.get("test_url")
    ping_url = hook.get("ping_url")

    lines = [
        "<b>GitHub webhook ping received</b>",
        f"repository: <code>{_esc_html(repo)}</code>",
        f"hook_id: <code>{_esc_html(hook_id)}</code>",
    ]
    if events:
        lines.append(
            "events: "
            + ", ".join(f"<code>{_esc_html(evt)}</code>" for evt in events)
        )
    else:
        lines.append("events: <code>*</code>")
    lines.append(
        "payload_url: "
        + (_link(payload_url) if payload_url else "<code>-</code>")
    )
    lines.append(f"last_response: <code>{_esc_html(last_resp)}</code>")
    if created_at:
        lines.append(f"created_at: <code>{_esc_html(created_at)}</code>")
    if updated_at:
        lines.append(f"updated_at: <code>{_esc_html(updated_at)}</code>")
    if test_url:
        lines.append("test_url: " + _link(test_url))
    if ping_url:
        lines.append("ping_url: " + _link(ping_url))
    if zen:
        lines.append(f"zen: {_esc_html(zen)}")
    return "\n".join(lines)


def _summarize_create(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    repo = _repo(payload)
    ref_type = payload.get("ref_type") or "ref"
    ref = payload.get("ref") or "?"
    actor = _actor(payload) or UNKNOWN
    repo_part = f" in <code>{_esc_html(repo)}</code>" if repo else ""
    return (
        f"<b>Create</b> { _esc_html(ref_type)} <code>{_esc_html(ref)}</code>"
        f"{repo_part} by <b>{_esc_html(actor)}</b>"
    )


def _summarize_delete(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    repo = _repo(payload)
    ref_type = payload.get("ref_type") or "ref"
    ref = payload.get("ref") or "?"
    actor = _actor(payload) or UNKNOWN
    repo_part = f" from <code>{_esc_html(repo)}</code>" if repo else ""
    return (
        f"<b>Delete</b> { _esc_html(ref_type)} <code>{_esc_html(ref)}</code>"
        f"{repo_part} by <b>{_esc_html(actor)}</b>"
    )


def _summarize_push(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    repo = _repo(payload) or "?"
    repo_url = _dig(payload, ("repository", "html_url")) or ""
    ref = payload.get("ref") or ""
    is_tag = ref.startswith("refs/tags/")
    branch = ref.split("/")[-1] if ref else "unknown"
    deleted = bool(payload.get("deleted"))
    forced = bool(payload.get("forced"))
    actor = (
        _dig(payload, ("pusher", "name"))
        or _actor(payload)
        or UNKNOWN
    )
    commits = payload.get("commits") or []
    compare_url = payload.get("compare") or ""

    target_label = "tag" if is_tag else "branch"
    lines: list[str] = []
    if deleted:
        head = (
            f"<b>Deleted</b> {target_label} <code>{_esc_html(branch)}</code>"
            f" from <code>{_esc_html(repo)}</code> by <b>{_esc_html(actor)}</b>"
        )
    else:
        commit_count = len(commits)
        plural = "commit" if commit_count == 1 else "commits"
        head = (
            f"<b>Push</b> to {target_label} <code>{_esc_html(branch)}</code>"
            f" in <code>{_esc_html(repo)}</code> by <b>{_esc_html(actor)}</b>"
            f" ({commit_count} {plural})"
        )
        if forced:
            head += " <i>(forced)</i>"
    lines.append(head)
    if not deleted and compare_url:
        lines.append(_link(compare_url, "Compare"))
    if not deleted and commits:
        lines.append("")
        shown = min(len(commits), MAX_COMMITS)
        for index, commit in enumerate(commits[:MAX_COMMITS]):
            sha = (commit.get("id") or "")[:7]
            message = _first_line(commit.get("message"))
            url = commit.get("url") or ""
            line = f"<code>{_esc_html(sha)}</code> {_esc_html(message)}"
            lines.append(line)
            if url:
                lines.append(_link(url, "View commit"))
            if index < shown - 1:
                lines.append("")
        overflow = len(commits) - MAX_COMMITS
        if overflow > 0:
            lines.append(f"<i>+{overflow} more commits</i>")
    if deleted and repo_url:
        lines.append(_link(repo_url, "Repository"))
    return "\n".join(lines)


def _summarize_pull_request(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    repo = _repo(payload) or "?"
    pr = _ensure_mapping(payload.get("pull_request"))
    number = pr.get("number") or payload.get("number") or "?"
    title = pr.get("title") or ""
    actor = _actor(payload) or UNKNOWN
    head_ref = _dig(pr, ("head", "ref")) or "?"
    base_ref = _dig(pr, ("base", "ref")) or "?"
    merged = bool(pr.get("merged"))
    url = pr.get("html_url")

    if action == "closed" and merged:
        action = "merged"

    head = (
        f"<b>Pull request</b> <code>{_esc_html(repo)}</code> #{_esc_html(number)}"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if title:
        lines.append(f"<b>{_esc_html(title)}</b>")
    lines.append(f"{_esc_html(head_ref)} → {_esc_html(base_ref)}")
    if url:
        lines.append(_link(url, "View pull request"))
    return "\n".join(lines)


def _summarize_issues(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    repo = _repo(payload) or "?"
    issue = _ensure_mapping(payload.get("issue"))
    number = issue.get("number") or payload.get("number") or "?"
    title = issue.get("title") or ""
    actor = _actor(payload) or UNKNOWN
    url = issue.get("html_url")

    head = (
        f"<b>Issue</b> <code>{_esc_html(repo)}</code> #{_esc_html(number)}"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if title:
        lines.append(f"<b>{_esc_html(title)}</b>")
    if url:
        lines.append(_link(url, "View issue"))
    return "\n".join(lines)


def _summarize_issue_comment(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    issue = _ensure_mapping(payload.get("issue"))
    comment = _ensure_mapping(payload.get("comment"))
    actor = _actor(payload) or UNKNOWN
    repo = _repo(payload) or "?"
    number = issue.get("number") or "?"
    excerpt = _first_line(comment.get("body"), 200)
    url = comment.get("html_url") or issue.get("html_url")

    head = (
        f"<b>Issue comment</b> on <code>{_esc_html(repo)}</code> #{_esc_html(number)}"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if excerpt:
        lines.append(_esc_html(excerpt))
    if url:
        lines.append(_link(url, "View comment"))
    return "\n".join(lines)


def _summarize_pull_request_review(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    review = _ensure_mapping(payload.get("review"))
    pr = _ensure_mapping(payload.get("pull_request"))
    actor = _actor(payload) or UNKNOWN
    repo = _repo(payload) or "?"
    number = pr.get("number") or payload.get("number") or "?"
    state = review.get("state") or ""
    body = _first_line(review.get("body"), 200)
    url = review.get("html_url") or pr.get("html_url")

    head = (
        f"<b>Pull request review</b> on <code>{_esc_html(repo)}</code> #{_esc_html(number)}"
        f" <b>{_esc_html(action or state)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if state and state.lower() != action.lower():
        lines.append(f"state: <code>{_esc_html(state)}</code>")
    if body:
        lines.append(_esc_html(body))
    if url:
        lines.append(_link(url, "View review"))
    return "\n".join(lines)


def _summarize_pull_request_review_comment(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    comment = _ensure_mapping(payload.get("comment"))
    pr = _ensure_mapping(payload.get("pull_request"))
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    number = pr.get("number") or payload.get("number") or "?"
    path = comment.get("path") or ""
    position = comment.get("position")
    body = _first_line(comment.get("body"), 200)
    url = comment.get("html_url") or pr.get("html_url")

    head = (
        f"<b>PR review comment</b> on <code>{_esc_html(repo)}</code> #{_esc_html(number)}"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if path:
        position_text = f" (line {position})" if position is not None else ""
        lines.append(f"file: <code>{_esc_html(path)}</code>{position_text}")
    if body:
        lines.append(_esc_html(body))
    if url:
        lines.append(_link(url, "View comment"))
    return "\n".join(lines)


def _summarize_pull_request_review_thread(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    thread = _ensure_mapping(payload.get("thread"))
    pr = _ensure_mapping(payload.get("pull_request"))
    repo = _repo(payload) or "?"
    number = pr.get("number") or payload.get("number") or "?"
    actor = _actor(payload) or UNKNOWN
    url = thread.get("html_url") or pr.get("html_url")
    path = thread.get("path") or ""

    head = (
        f"<b>PR review thread</b> on <code>{_esc_html(repo)}</code> #{_esc_html(number)}"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if path:
        lines.append(f"file: <code>{_esc_html(path)}</code>")
    if url:
        lines.append(_link(url, "View thread"))
    return "\n".join(lines)


def _summarize_release(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    release = _ensure_mapping(payload.get("release"))
    repo = _repo(payload) or "?"
    tag = release.get("tag_name") or ""
    name = release.get("name") or tag or "release"
    url = release.get("html_url")
    actor = _actor(payload) or UNKNOWN

    head = (
        f"<b>Release</b> <code>{_esc_html(repo)}</code>"
        f" <b>{_esc_html(action)}</b>"
        f" → <b>{_esc_html(name)}</b>"
        f" by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if tag and tag != name:
        lines.append(f"tag: <code>{_esc_html(tag)}</code>")
    if url:
        lines.append(_link(url, "View release"))
    return "\n".join(lines)


def _summarize_workflow_run(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    workflow_run = _ensure_mapping(payload.get("workflow_run"))
    repo = _repo(payload) or "?"
    name = workflow_run.get("name") or "workflow"
    status = workflow_run.get("status") or ""
    conclusion = workflow_run.get("conclusion") or ""
    actor = _actor(payload) or UNKNOWN
    url = workflow_run.get("html_url")
    run_number = workflow_run.get("run_number")
    head_branch = workflow_run.get("head_branch") or ""

    title = f"<b>Workflow run</b> <code>{_esc_html(repo)}</code>: <b>{_esc_html(name)}</b>"
    if run_number:
        title += f" #{_esc_html(run_number)}"
    title += f" — <b>{_esc_html(status)}</b>"
    if conclusion:
        title += f" {_esc_html(conclusion)}"
    title += f" by <b>{_esc_html(actor)}</b>"

    lines = [title]
    if head_branch:
        lines.append(f"branch: <code>{_esc_html(head_branch)}</code>")
    if url:
        lines.append(_link(url, "View run"))
    return "\n".join(lines)


def _summarize_workflow_job(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    workflow_job = _ensure_mapping(payload.get("workflow_job"))
    repo = _repo(payload) or "?"
    name = workflow_job.get("name") or "job"
    status = workflow_job.get("status") or ""
    conclusion = workflow_job.get("conclusion") or ""
    actor = _actor(payload) or UNKNOWN
    url = workflow_job.get("html_url")
    run_id = workflow_job.get("run_id")

    head = (
        f"<b>Workflow job</b> <code>{_esc_html(repo)}</code>: <b>{_esc_html(name)}</b>"
        f" — <b>{_esc_html(status)}</b>"
    )
    if conclusion:
        head += f" {_esc_html(conclusion)}"
    head += f" by <b>{_esc_html(actor)}</b>"
    if run_id:
        head += f" (run {_esc_html(run_id)})"
    lines = [head]
    if url:
        lines.append(_link(url, "View job"))
    return "\n".join(lines)


def _summarize_workflow_dispatch(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    workflow = _ensure_mapping(payload.get("workflow"))
    name = workflow.get("name") or workflow.get("path") or "workflow"
    repo = _repo(payload) or "?"
    ref = payload.get("ref") or payload.get("workflow_ref") or ""
    actor = _actor(payload) or UNKNOWN
    inputs = payload.get("inputs") or {}

    head = (
        f"<b>Workflow dispatch</b> <code>{_esc_html(repo)}</code>: <b>{_esc_html(name)}</b>"
        f" triggered by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if ref:
        lines.append(f"ref: <code>{_esc_html(ref)}</code>")
    if inputs:
        formatted = ", ".join(
            f"{_esc_html(str(key))}={_esc_html(str(value))}"
            for key, value in inputs.items()
        )
        lines.append(f"inputs: {formatted}")
    return "\n".join(lines)


def _summarize_check_run(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    check_run = _ensure_mapping(payload.get("check_run"))
    name = check_run.get("name") or "check run"
    status = check_run.get("status") or ""
    conclusion = check_run.get("conclusion") or ""
    actor = _actor(payload) or UNKNOWN
    repo = _repo(payload) or "?"
    url = check_run.get("html_url")
    details_url = check_run.get("details_url")

    head = (
        f"<b>Check run</b> <code>{_esc_html(repo)}</code>: <b>{_esc_html(name)}</b>"
        f" — <b>{_esc_html(status)}</b>"
    )
    if conclusion:
        head += f" {_esc_html(conclusion)}"
    head += f" by <b>{_esc_html(actor)}</b>"
    lines = [head]
    if url:
        lines.append(_link(url, "View check run"))
    elif details_url:
        lines.append(_link(details_url, "Details"))
    return "\n".join(lines)


def _summarize_check_suite(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    check_suite = _ensure_mapping(payload.get("check_suite"))
    action = payload.get("action") or ""
    status = check_suite.get("status") or ""
    conclusion = check_suite.get("conclusion") or ""
    head_branch = check_suite.get("head_branch") or ""
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN

    head = (
        f"<b>Check suite</b> <code>{_esc_html(repo)}</code>"
        f" <b>{_esc_html(action or status)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if head_branch:
        lines.append(f"branch: <code>{_esc_html(head_branch)}</code>")
    if conclusion:
        lines.append(f"conclusion: <code>{_esc_html(conclusion)}</code>")
    return "\n".join(lines)


def _summarize_status(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    state = payload.get("state") or ""
    repo = _repo(payload) or "?"
    sha = (payload.get("sha") or "")[:7]
    context = payload.get("context") or ""
    description = payload.get("description") or ""
    target_url = payload.get("target_url") or ""

    head = (
        f"<b>Status</b> <code>{_esc_html(repo)}</code> <code>{_esc_html(context)}</code>"
        f" → <b>{_esc_html(state)}</b>"
        f" for <code>{_esc_html(sha)}</code>"
    )
    lines = [head]
    if description:
        lines.append(_esc_html(description))
    if target_url:
        lines.append(_link(target_url, "View status"))
    return "\n".join(lines)


def _summarize_deployment(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    deployment = _ensure_mapping(payload.get("deployment"))
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    environment = deployment.get("environment") or "?"
    ref = deployment.get("ref") or ""
    description = deployment.get("description") or ""
    url = deployment.get("statuses_url") or deployment.get("url")

    head = (
        f"<b>Deployment</b> <code>{_esc_html(repo)}</code>"
        f" → <b>{_esc_html(environment)}</b>"
        f" by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if ref:
        lines.append(f"ref: <code>{_esc_html(ref)}</code>")
    if description:
        lines.append(_esc_html(description))
    if url:
        lines.append(_link(url, "Deployment API"))
    return "\n".join(lines)


def _summarize_deployment_status(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    deployment = _ensure_mapping(payload.get("deployment"))
    status = _ensure_mapping(payload.get("deployment_status"))
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    environment = deployment.get("environment") or status.get("environment") or "?"
    state = status.get("state") or ""
    description = status.get("description") or ""
    target_url = status.get("target_url") or ""

    head = (
        f"<b>Deployment status</b> <code>{_esc_html(repo)}</code>"
        f" → <b>{_esc_html(environment)}</b>"
        f" is <b>{_esc_html(state)}</b>"
        f" by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if description:
        lines.append(_esc_html(description))
    if target_url:
        lines.append(_link(target_url, "Target"))
    return "\n".join(lines)


def _summarize_deployment_review(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    deployment = _ensure_mapping(payload.get("deployment"))
    review = _ensure_mapping(payload.get("review"))
    env = deployment.get("environment") or review.get("environment") or "?"
    state = review.get("state") or ""
    actor = _actor(payload) or UNKNOWN
    repo = _repo(payload) or "?"
    url = review.get("html_url")

    head = (
        f"<b>Deployment review</b> <code>{_esc_html(repo)}</code>"
        f" → <b>{_esc_html(env)}</b>"
        f" <b>{_esc_html(state)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if url:
        lines.append(_link(url, "View review"))
    return "\n".join(lines)


def _summarize_deployment_protection_rule(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    environment = payload.get("environment") or _dig(payload, ("deployment_protection_rule", "environment")) or "?"
    actor = _actor(payload) or UNKNOWN
    action = payload.get("action") or ""
    repo = _repo(payload) or "?"

    head = (
        f"<b>Deployment protection rule</b> <code>{_esc_html(repo)}</code>"
        f" → <b>{_esc_html(environment)}</b>"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    return "\n".join(lines)


def _summarize_discussion(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    discussion = _ensure_mapping(payload.get("discussion"))
    action = payload.get("action") or ""
    title = discussion.get("title") or ""
    url = discussion.get("html_url")
    repo = _repo(payload)
    actor = _actor(payload) or UNKNOWN
    category = _dig(discussion, ("category", "name")) or ""

    head = f"<b>Discussion</b> <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    if repo:
        head += f" in <code>{_esc_html(repo)}</code>"
    lines = [head]
    if title:
        lines.append(f"<b>{_esc_html(title)}</b>")
    if category:
        lines.append(f"category: <code>{_esc_html(category)}</code>")
    if url:
        lines.append(_link(url, "View discussion"))
    return "\n".join(lines)


def _summarize_discussion_comment(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    discussion = _ensure_mapping(payload.get("discussion"))
    comment = _ensure_mapping(payload.get("comment"))
    action = payload.get("action") or ""
    actor = _actor(payload) or UNKNOWN
    url = comment.get("html_url") or discussion.get("html_url")
    body = _first_line(comment.get("body"), 200)
    title = discussion.get("title") or ""

    head = f"<b>Discussion comment</b> <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    if title:
        head += f" on <b>{_esc_html(title)}</b>"
    lines = [head]
    if body:
        lines.append(_esc_html(body))
    if url:
        lines.append(_link(url, "View comment"))
    return "\n".join(lines)


def _summarize_fork(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    repo = _repo(payload) or "?"
    forkee = _ensure_mapping(payload.get("forkee"))
    fork_full = forkee.get("full_name") or forkee.get("name") or "?"
    fork_url = forkee.get("html_url") or forkee.get("svn_url")
    actor = _actor(payload) or UNKNOWN

    head = (
        f"<b>Fork</b> of <code>{_esc_html(repo)}</code>"
        f" created by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    lines.append(f"new repo: <code>{_esc_html(fork_full)}</code>")
    if fork_url:
        lines.append(_link(fork_url, "View fork"))
    return "\n".join(lines)


def _summarize_gollum(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    pages = payload.get("pages") or []
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN

    head = (
        f"<b>Wiki update</b> in <code>{_esc_html(repo)}</code>"
        f" by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    for page in pages:
        title = page.get("title") or "page"
        action = page.get("action") or ""
        url = page.get("html_url") or page.get("page_name")
        lines.append(f"• <b>{_esc_html(action)}</b> {_esc_html(title)}")
        if url:
            lines.append(_link(url, "View page"))
    return "\n".join(lines)


def _summarize_installation(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    installation = _ensure_mapping(payload.get("installation"))
    action = payload.get("action") or ""
    account = _ensure_mapping(installation.get("account"))
    account_login = account.get("login") or account.get("name") or "?"
    repo_count = len(installation.get("repositories", []) or [])
    repositories = installation.get("repositories") or []
    lines = [
        f"<b>Installation</b> <b>{_esc_html(action)}</b> for <b>{_esc_html(account_login)}</b>"
    ]
    if repo_count:
        sample = ", ".join(
            _esc_html(repo.get("full_name") or repo.get("name") or "?")
            for repo in repositories[:5]
        )
        if repo_count > 5:
            sample += f" … (+{repo_count - 5})"
        lines.append(f"repositories: {sample}")
    return "\n".join(lines)


def _summarize_installation_repositories(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    installation = _ensure_mapping(payload.get("installation"))
    account = _ensure_mapping(installation.get("account"))
    account_login = account.get("login") or account.get("name") or "?"
    added = payload.get("repositories_added") or []
    removed = payload.get("repositories_removed") or []
    lines = [
        f"<b>Installation repositories</b> <b>{_esc_html(action)}</b> for <b>{_esc_html(account_login)}</b>"
    ]
    if added:
        add_list = ", ".join(
            _esc_html(repo.get("full_name") or repo.get("name") or "?")
            for repo in added[:5]
        )
        more = len(added) - 5
        if more > 0:
            add_list += f" … (+{more})"
        lines.append(f"added: {add_list}")
    if removed:
        remove_list = ", ".join(
            _esc_html(repo.get("full_name") or repo.get("name") or "?")
            for repo in removed[:5]
        )
        more = len(removed) - 5
        if more > 0:
            remove_list += f" … (+{more})"
        lines.append(f"removed: {remove_list}")
    return "\n".join(lines)


def _summarize_installation_target(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    installation = _ensure_mapping(payload.get("installation"))
    account = _ensure_mapping(installation.get("account"))
    account_login = account.get("login") or account.get("name") or "?"
    target_type = payload.get("target_type") or installation.get("target_type") or "target"
    lines = [
        f"<b>Installation target</b> <b>{_esc_html(action)}</b>"
        f" on <b>{_esc_html(account_login)}</b> ({_esc_html(target_type)})"
    ]
    return "\n".join(lines)


def _summarize_marketplace_purchase(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    purchase = _ensure_mapping(payload.get("marketplace_purchase"))
    account = _ensure_mapping(purchase.get("account"))
    plan = _ensure_mapping(purchase.get("plan"))
    account_login = account.get("login") or account.get("name") or "?"
    plan_name = plan.get("name") or "plan"
    quantity = purchase.get("unit_count")

    head = (
        f"<b>Marketplace purchase</b> <b>{_esc_html(action)}</b>"
        f" by <b>{_esc_html(account_login)}</b>"
    )
    lines = [head]
    lines.append(f"plan: <b>{_esc_html(plan_name)}</b>")
    if quantity is not None:
        lines.append(f"seats: <code>{_esc_html(quantity)}</code>")
    return "\n".join(lines)


def _summarize_member(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    member = _ensure_mapping(payload.get("member"))
    action = payload.get("action") or ""
    repo = _repo(payload)
    member_login = member.get("login") or member.get("name") or "?"
    actor = _actor(payload) or UNKNOWN

    head = (
        f"<b>Repository member</b> <b>{_esc_html(action)}</b>"
        f" { _esc_html(member_login)}"
    )
    if repo:
        head += f" in <code>{_esc_html(repo)}</code>"
    head += f" by <b>{_esc_html(actor)}</b>"
    return head


def _summarize_membership(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    member = _ensure_mapping(payload.get("member"))
    team = _ensure_mapping(payload.get("team"))
    member_login = member.get("login") or member.get("name") or "?"
    team_name = team.get("name") or team.get("slug") or "team"
    org = _dig(payload, ("organization", "login")) or "?"

    head = (
        f"<b>Team membership</b> <b>{_esc_html(action)}</b>"
        f" — <b>{_esc_html(member_login)}</b> in <b>{_esc_html(team_name)}</b>"
        f" (@{_esc_html(org)})"
    )
    return head


def _summarize_merge_group(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    merge_group = _ensure_mapping(payload.get("merge_group"))
    head_ref = merge_group.get("head_ref") or ""
    base_ref = merge_group.get("base_ref") or ""
    repo = _repo(payload) or "?"

    head = (
        f"<b>Merge group</b> <b>{_esc_html(action)}</b>"
        f" in <code>{_esc_html(repo)}</code>"
    )
    lines = [head]
    if head_ref or base_ref:
        lines.append(f"{_esc_html(head_ref)} → {_esc_html(base_ref)}")
    return "\n".join(lines)


def _summarize_meta(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    hook_id = payload.get("hook_id") or "?"
    hook = _ensure_mapping(payload.get("hook"))
    repo = _repo(payload)

    head = f"<b>Webhook meta</b> <b>{_esc_html(action)}</b> (hook <code>{_esc_html(hook_id)}</code>)"
    if repo:
        head += f" for <code>{_esc_html(repo)}</code>"
    config_url = _ensure_mapping(hook.get("config")).get("url")
    lines = [head]
    if config_url:
        lines.append(_link(config_url, "Payload URL"))
    return "\n".join(lines)


def _summarize_milestone(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    milestone = _ensure_mapping(payload.get("milestone"))
    action = payload.get("action") or ""
    repo = _repo(payload) or "?"
    title = milestone.get("title") or "milestone"
    due = milestone.get("due_on") or ""
    url = milestone.get("html_url")

    head = (
        f"<b>Milestone</b> <code>{_esc_html(repo)}</code>"
        f" <b>{_esc_html(action)}</b> → <b>{_esc_html(title)}</b>"
    )
    lines = [head]
    if due:
        lines.append(f"due: <code>{_esc_html(due)}</code>")
    if url:
        lines.append(_link(url, "View milestone"))
    return "\n".join(lines)


def _summarize_org_block(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    blocked_user = _dig(payload, ("blocked_user", "login")) or "?"
    org = _dig(payload, ("organization", "login")) or "?"

    return (
        f"<b>Org block</b> <b>{_esc_html(action)}</b>"
        f" — <b>{_esc_html(blocked_user)}</b> @{_esc_html(org)}"
    )


def _summarize_organization(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    membership = _ensure_mapping(payload.get("membership"))
    invitation = _ensure_mapping(payload.get("invitation"))
    org = _dig(payload, ("organization", "login")) or "?"

    head = f"<b>Organization</b> <b>{_esc_html(action)}</b> @{_esc_html(org)}"
    lines = [head]
    if membership:
        user = membership.get("user") or {}
        login = user.get("login") or user.get("name") or "?"
        role = membership.get("role") or ""
        lines.append(f"member: <b>{_esc_html(login)}</b> role <code>{_esc_html(role)}</code>")
    if invitation:
        invitee = invitation.get("login") or invitation.get("email") or "?"
        lines.append(f"invitation: <code>{_esc_html(invitee)}</code>")
    return "\n".join(lines)


def _summarize_page_build(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    build = _ensure_mapping(payload.get("build"))
    status = build.get("status") or ""
    url = build.get("url") or ""
    error = _ensure_mapping(build.get("error"))
    message = error.get("message") or ""
    repo = _repo(payload) or "?"

    head = (
        f"<b>Page build</b> <code>{_esc_html(repo)}</code>"
        f" → <b>{_esc_html(status)}</b>"
    )
    lines = [head]
    if message:
        lines.append(_esc_html(message))
    if url:
        lines.append(_link(url, "View build"))
    return "\n".join(lines)


def _summarize_personal_access_token_request(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    request = _ensure_mapping(payload.get("personal_access_token_request"))
    request_id = request.get("id") or "?"
    state = request.get("state") or ""
    actor = _actor(payload) or UNKNOWN
    org = _dig(payload, ("organization", "login")) or "?"

    head = (
        f"<b>Personal access token request</b> <b>{_esc_html(action)}</b>"
        f" — request <code>{_esc_html(request_id)}</code>"
        f" for @{_esc_html(org)}"
    )
    lines = [head]
    if state:
        lines.append(f"state: <code>{_esc_html(state)}</code>")
    lines.append(f"by <b>{_esc_html(actor)}</b>")
    return "\n".join(lines)


def _summarize_project(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Project",
        payload,
        subject="project",
        subject_fields=(("name",), ("body",), ("number",)),
    )


def _summarize_project_card(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Project card",
        payload,
        subject="project_card",
        subject_fields=(("note",), ("column_name",), ("id",)),
    )


def _summarize_project_column(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Project column",
        payload,
        subject="project_column",
        subject_fields=(("name",), ("id",)),
    )


def _summarize_projects_v2(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Project",
        payload,
        subject="projects_v2",
        subject_fields=(("title",), ("number",), ("id",)),
    )


def _summarize_projects_v2_item(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Project item",
        payload,
        subject="projects_v2_item",
        subject_fields=(("title",), ("content_type",), ("id",)),
    )


def _summarize_projects_v2_status_update(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Project status update",
        payload,
        subject="projects_v2_status_update",
        subject_fields=(("status",), ("title",), ("id",)),
    )


def _summarize_public(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    return (
        f"<b>Repository public</b> <code>{_esc_html(repo)}</code>"
        f" by <b>{_esc_html(actor)}</b>"
    )


def _summarize_registry_package(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Registry package",
        payload,
        subject="registry_package",
        subject_fields=(("name",), ("package_type",), ("id",)),
    )


def _summarize_repository(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Repository",
        payload,
        subject="repository",
        subject_fields=(("full_name",), ("name",), ("id",)),
    )


def _summarize_repository_dispatch(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    event_type = payload.get("action") or payload.get("event_type") or "dispatch"
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    lines = [
        f"<b>Repository dispatch</b> <code>{_esc_html(repo)}</code>"
        f" event <code>{_esc_html(event_type)}</code> by <b>{_esc_html(actor)}</b>"
    ]
    client_payload = payload.get("client_payload")
    if isinstance(client_payload, Mapping) and client_payload:
        snippet = ", ".join(
            f"{_esc_html(str(k))}={_esc_html(str(v))}"
            for k, v in list(client_payload.items())[:6]
        )
        lines.append(f"payload: {snippet}")
    return "\n".join(lines)


def _summarize_repository_import(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    status = payload.get("status") or ""
    repo = _repo(payload) or "?"
    human = payload.get("human_name") or ""
    progress = payload.get("progress")

    head = (
        f"<b>Repository import</b> <code>{_esc_html(repo)}</code>"
        f" → <b>{_esc_html(status)}</b>"
    )
    lines = [head]
    if human:
        lines.append(_esc_html(human))
    if progress is not None:
        lines.append(f"progress: <code>{_esc_html(progress)}</code>")
    return "\n".join(lines)


def _summarize_repository_ruleset(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Repository ruleset",
        payload,
        subject="ruleset",
        subject_fields=(("name",), ("target",), ("id",)),
    )


def _summarize_repository_vulnerability_alert(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    alert = _ensure_mapping(payload.get("alert"))
    action = payload.get("action") or ""
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    dependency = _ensure_mapping(alert.get("affected_package"))
    package_name = (
        dependency.get("name")
        or _dig(alert, ("security_advisory", "summary"))
        or "dependency"
    )
    severity = _dig(alert, ("security_advisory", "severity")) or ""
    url = _dig(alert, ("security_advisory", "html_url"))

    head = (
        f"<b>Repository vulnerability alert</b> <code>{_esc_html(repo)}</code>"
        f" <b>{_esc_html(action)}</b>"
        f" — <b>{_esc_html(package_name)}</b>"
        f" by <b>{_esc_html(actor)}</b>"
    )
    lines = [head]
    if severity:
        lines.append(f"severity: <code>{_esc_html(severity)}</code>")
    if url:
        lines.append(_link(url, "View advisory"))
    return "\n".join(lines)


def _summarize_secret_scanning_alert(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    alert = _ensure_mapping(payload.get("alert"))
    action = payload.get("action") or ""
    repo = _repo(payload) or "?"
    secret_type = alert.get("secret_type_display_name") or alert.get("secret_type") or "secret"
    state = alert.get("state") or ""
    url = alert.get("html_url")

    head = (
        f"<b>Secret scanning alert</b> <code>{_esc_html(repo)}</code>"
        f" <b>{_esc_html(action)}</b>"
        f" — <b>{_esc_html(secret_type)}</b>"
    )
    lines = [head]
    if state:
        lines.append(f"state: <code>{_esc_html(state)}</code>")
    if url:
        lines.append(_link(url, "View alert"))
    return "\n".join(lines)


def _summarize_secret_scanning_alert_location(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    location = _ensure_mapping(payload.get("location"))
    alert = _ensure_mapping(payload.get("alert"))
    repo = _repo(payload) or "?"
    type_name = location.get("type") or "location"
    path = location.get("details", {}).get("path") if isinstance(location.get("details"), Mapping) else ""
    url = alert.get("html_url")

    head = (
        f"<b>Secret scanning location</b> <code>{_esc_html(repo)}</code>"
        f" → <b>{_esc_html(type_name)}</b>"
    )
    lines = [head]
    if path:
        lines.append(f"path: <code>{_esc_html(path)}</code>")
    if url:
        lines.append(_link(url, "View alert"))
    return "\n".join(lines)


def _summarize_secret_scanning_scan(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Secret scanning scan",
        payload,
        subject="scan",
        subject_fields=(("type",), ("id",)),
    )


def _summarize_security_advisory(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    advisory = _ensure_mapping(payload.get("security_advisory"))
    action = payload.get("action") or ""
    ghsa = advisory.get("ghsa_id") or ""
    summary = advisory.get("summary") or "security advisory"
    url = advisory.get("html_url")

    head = (
        f"<b>Security advisory</b> <b>{_esc_html(action)}</b>"
        f" — <b>{_esc_html(summary)}</b>"
    )
    lines = [head]
    if ghsa:
        lines.append(f"GHSA: <code>{_esc_html(ghsa)}</code>")
    if url:
        lines.append(_link(url, "View advisory"))
    return "\n".join(lines)


def _summarize_security_and_analysis(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Security and analysis",
        payload,
        subject=("security_and_analysis",),
        subject_fields=(("status",), ("advanced_security", "status"), ("secret_scanning", "status")),
    )


def _summarize_sponsorship(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    sponsorship = _ensure_mapping(payload.get("sponsorship"))
    action = payload.get("action") or ""
    sponsor = _ensure_mapping(sponsorship.get("sponsor"))
    maintainer = _ensure_mapping(sponsorship.get("maintainer"))
    tier = _ensure_mapping(sponsorship.get("tier"))
    sponsor_login = sponsor.get("login") or sponsor.get("name") or "?"
    maintainer_login = maintainer.get("login") or maintainer.get("name") or "?"
    tier_name = tier.get("name") or "tier"

    head = (
        f"<b>Sponsorship</b> <b>{_esc_html(action)}</b>"
        f" — <b>{_esc_html(sponsor_login)}</b> → <b>{_esc_html(maintainer_login)}</b>"
    )
    lines = [head]
    if tier_name:
        lines.append(f"tier: <b>{_esc_html(tier_name)}</b>")
    return "\n".join(lines)


def _summarize_star(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    return (
        f"<b>Star</b> <code>{_esc_html(repo)}</code>"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    )


def _summarize_sub_issues(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Sub-issues",
        payload,
        subject="sub_issue",
        subject_fields=(("title",), ("number",), ("id",)),
    )


def _summarize_team_add(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    team = _ensure_mapping(payload.get("team"))
    repo = _ensure_mapping(payload.get("repository"))
    team_name = team.get("name") or team.get("slug") or "team"
    repo_name = repo.get("full_name") or repo.get("name") or "repository"

    return (
        f"<b>Team access</b> — <b>{_esc_html(team_name)}</b> now has access to"
        f" <code>{_esc_html(repo_name)}</code>"
    )


def _summarize_team(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Team",
        payload,
        subject="team",
        subject_fields=(("name",), ("slug",), ("id",)),
    )


def _summarize_watch(payload: Mapping[str, Any], _event: str) -> str:
    action = payload.get("action") or payload.get("event") or "started"
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    return (
        f"<b>Watch</b> <code>{_esc_html(repo)}</code>"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
    )


def _summarize_dependabot_alert(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Dependabot alert",
        payload,
        subject="alert",
        subject_fields=(("number",), ("security_advisory", "summary"), ("dependency", "package", "name")),
    )


def _summarize_code_scanning_alert(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Code scanning alert",
        payload,
        subject="alert",
        subject_fields=(("rule", "id"), ("rule", "name"), ("number",), ("html_url",)),
    )


def _summarize_commit_comment(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    comment = _ensure_mapping(payload.get("comment"))
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    body = _first_line(comment.get("body"), 200)
    sha = (comment.get("commit_id") or "")[:7]
    url = comment.get("html_url")

    head = (
        f"<b>Commit comment</b> <code>{_esc_html(repo)}</code>"
        f" <b>{_esc_html(action)}</b> by <b>{_esc_html(actor)}</b>"
        f" on <code>{_esc_html(sha)}</code>"
    )
    lines = [head]
    if body:
        lines.append(_esc_html(body))
    if url:
        lines.append(_link(url, "View comment"))
    return "\n".join(lines)


def _summarize_branch_protection_configuration(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Branch protection configuration",
        payload,
    )


def _summarize_branch_protection_rule(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Branch protection rule",
        payload,
        subject="rule",
        subject_fields=(("name",), ("pattern",), ("id",)),
    )


def _summarize_custom_property(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Custom property",
        payload,
        subject="custom_property",
        subject_fields=(("name",), ("full_name",), ("id",)),
    )


def _summarize_custom_property_values(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    repo = _repo(payload) or "?"
    actor = _actor(payload) or UNKNOWN
    new_values = payload.get("new_property_values") or []
    old_values = payload.get("old_property_values") or []
    lines = [
        f"<b>Custom property values</b> updated in <code>{_esc_html(repo)}</code>"
        f" by <b>{_esc_html(actor)}</b>"
    ]
    if new_values:
        lines.append(f"{len(new_values)} new values")
    if old_values:
        lines.append(f"{len(old_values)} previous values")
    return "\n".join(lines)


def _summarize_deploy_key(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Deploy key",
        payload,
        subject="key",
        subject_fields=(("title",), ("id",), ("fingerprint",)),
    )


def _summarize_github_app_authorization(payload: Mapping[str, Any], _event: str) -> str:
    payload = _ensure_mapping(payload)
    action = payload.get("action") or ""
    user = _ensure_mapping(payload.get("sender"))
    login = user.get("login") or user.get("name") or "user"
    return (
        f"<b>GitHub App authorization</b> <b>{_esc_html(action)}</b>"
        f" by <b>{_esc_html(login)}</b>"
    )


def _summarize_issue_dependencies(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Issue dependencies",
        payload,
        subject=("dependent", "issue"),
        subject_fields=(("title",), ("number",)),
    )


def _summarize_label(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Label",
        payload,
        subject="label",
        subject_fields=(("name",), ("color",), ("id",)),
    )


def _summarize_package(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Package",
        payload,
        subject="package",
        subject_fields=(("name",), ("package_type",), ("id",)),
    )


def _summarize_repository_advisory(payload: Mapping[str, Any], _event: str) -> str:
    return _generic_action_summary(
        "Repository advisory",
        payload,
        subject="repository_advisory",
        subject_fields=(("summary",), ("ghsa_id",), ("cve_id",)),
    )


def _summarize_watch_default(payload: Mapping[str, Any], event: str) -> str:
    return _summarize_watch(payload, event)


EVENTS_METADATA: dict[str, dict[str, Any]] = {
    "branch_protection_configuration": {"handler": _summarize_branch_protection_configuration},
    "branch_protection_rule": {"handler": _summarize_branch_protection_rule},
    "check_run": {"handler": _summarize_check_run},
    "check_suite": {"handler": _summarize_check_suite},
    "code_scanning_alert": {"handler": _summarize_code_scanning_alert},
    "commit_comment": {"handler": _summarize_commit_comment},
    "create": {"handler": _summarize_create},
    "custom_property": {"handler": _summarize_custom_property},
    "custom_property_values": {"handler": _summarize_custom_property_values},
    "delete": {"handler": _summarize_delete},
    "dependabot_alert": {"handler": _summarize_dependabot_alert},
    "deploy_key": {"handler": _summarize_deploy_key},
    "deployment": {"handler": _summarize_deployment},
    "deployment_protection_rule": {"handler": _summarize_deployment_protection_rule},
    "deployment_review": {"handler": _summarize_deployment_review},
    "deployment_status": {"handler": _summarize_deployment_status},
    "discussion": {"handler": _summarize_discussion},
    "discussion_comment": {"handler": _summarize_discussion_comment},
    "fork": {"handler": _summarize_fork},
    "github_app_authorization": {"handler": _summarize_github_app_authorization},
    "gollum": {"handler": _summarize_gollum},
    "installation": {"handler": _summarize_installation},
    "installation_repositories": {"handler": _summarize_installation_repositories},
    "installation_target": {"handler": _summarize_installation_target},
    "issue_comment": {"handler": _summarize_issue_comment},
    "issue_dependencies": {"handler": _summarize_issue_dependencies},
    "issues": {"handler": _summarize_issues},
    "label": {"handler": _summarize_label},
    "marketplace_purchase": {"handler": _summarize_marketplace_purchase},
    "member": {"handler": _summarize_member},
    "membership": {"handler": _summarize_membership},
    "merge_group": {"handler": _summarize_merge_group},
    "meta": {"handler": _summarize_meta},
    "milestone": {"handler": _summarize_milestone},
    "org_block": {"handler": _summarize_org_block},
    "organization": {"handler": _summarize_organization},
    "package": {"handler": _summarize_package},
    "page_build": {"handler": _summarize_page_build},
    "personal_access_token_request": {"handler": _summarize_personal_access_token_request},
    "ping": {"handler": _summarize_ping},
    "project": {"handler": _summarize_project},
    "project_card": {"handler": _summarize_project_card},
    "project_column": {"handler": _summarize_project_column},
    "projects_v2": {"handler": _summarize_projects_v2},
    "projects_v2_item": {"handler": _summarize_projects_v2_item},
    "projects_v2_status_update": {"handler": _summarize_projects_v2_status_update},
    "public": {"handler": _summarize_public},
    "pull_request": {"handler": _summarize_pull_request},
    "pull_request_review": {"handler": _summarize_pull_request_review},
    "pull_request_review_comment": {"handler": _summarize_pull_request_review_comment},
    "pull_request_review_thread": {"handler": _summarize_pull_request_review_thread},
    "push": {"handler": _summarize_push},
    "registry_package": {"handler": _summarize_registry_package},
    "release": {"handler": _summarize_release},
    "repository": {"handler": _summarize_repository},
    "repository_advisory": {"handler": _summarize_repository_advisory},
    "repository_dispatch": {"handler": _summarize_repository_dispatch},
    "repository_import": {"handler": _summarize_repository_import},
    "repository_ruleset": {"handler": _summarize_repository_ruleset},
    "repository_vulnerability_alert": {"handler": _summarize_repository_vulnerability_alert},
    "secret_scanning_alert": {"handler": _summarize_secret_scanning_alert},
    "secret_scanning_alert_location": {"handler": _summarize_secret_scanning_alert_location},
    "secret_scanning_scan": {"handler": _summarize_secret_scanning_scan},
    "security_advisory": {"handler": _summarize_security_advisory},
    "security_and_analysis": {"handler": _summarize_security_and_analysis},
    "sponsorship": {"handler": _summarize_sponsorship},
    "star": {"handler": _summarize_star},
    "status": {"handler": _summarize_status},
    "sub_issues": {"handler": _summarize_sub_issues},
    "team": {"handler": _summarize_team},
    "team_add": {"handler": _summarize_team_add},
    "watch": {"handler": _summarize_watch_default},
    "workflow_dispatch": {"handler": _summarize_workflow_dispatch},
    "workflow_job": {"handler": _summarize_workflow_job},
    "workflow_run": {"handler": _summarize_workflow_run},
}


HANDLERS: dict[str, Handler] = {}
for event, meta in EVENTS_METADATA.items():
    handler = meta.get("handler")
    if handler:
        HANDLERS[event] = handler
    else:
        label = meta.get("label") or _pretty_label(event)
        HANDLERS[event] = lambda payload, evt=event, lbl=label: _generic_action_summary(lbl, payload)


def _generic_fallback(event: str, payload: Mapping[str, Any]) -> str:
    label = _pretty_label(event or "event")
    repo = _repo(payload) or ""
    actor = _actor(payload) or UNKNOWN
    line = f"<b>{_esc_html(label)}</b> event"
    if repo:
        line += f" for <code>{_esc_html(repo)}</code>"
    if actor:
        line += f" by <b>{_esc_html(actor)}</b>"
    return line


def summarize_event(event: str, payload: Mapping[str, Any] | None) -> str:
    event_key = (event or "").lower()
    payload = _ensure_mapping(payload)
    handler = HANDLERS.get(event_key)
    if handler:
        try:
            return handler(payload, event_key)
        except Exception:  # pragma: no cover - never crash on summaries
            pass
    return _generic_fallback(event_key, payload)
