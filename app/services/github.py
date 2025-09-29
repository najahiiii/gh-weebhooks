"""Yet another gh services"""

from __future__ import annotations


def summarize_event(event: str, payload: dict) -> str:
    """summmmm

    Args:
        event (str): gitboob weebhooks events
        payload (dict): payload?

    Returns:
        str: yet return from gitboob weebhooks
    """
    if event == "ping":
        repo = (payload.get("repository") or {}).get("full_name", "?")
        zen = payload.get("zen") or ""
        hook = payload.get("hook") or {}
        hook_id = payload.get("hook_id") or hook.get("id")
        cfg = hook.get("config") or {}
        events = hook.get("events") or []
        last_resp = (hook.get("last_response") or {}).get("status") or "unknown"
        created_at = hook.get("created_at") or ""
        updated_at = hook.get("updated_at") or ""
        payload_url = cfg.get("url") or ""
        test_url = hook.get("test_url") or ""
        ping_url = hook.get("ping_url") or ""

        lines = [
            "GitHub webhook ping received",
            f"repo         : {repo}",
            f"hook_id      : {hook_id}",
            f"events       : {', '.join(events) if events else '*'}",
            f"payload_url  : {payload_url}",
            f"last_response: {last_resp}",
            f"created_at   : {created_at}",
            f"updated_at   : {updated_at}",
        ]
        if test_url:
            lines.append(f"test_url     : {test_url}")
        if ping_url:
            lines.append(f"ping_url     : {ping_url}")
        if zen:
            lines.append(f"zen          : {zen}")

        return "\n".join(lines)

    if event == "push":
        repo = payload.get("repository", {}).get("full_name", "?")
        branch = (payload.get("ref") or "refs/heads/?").split("/")[-1]
        pusher = payload.get("pusher", {}).get("name") or payload.get("sender", {}).get(
            "login", "?"
        )
        commits = payload.get("commits", []) or []
        lines = [
            f"*[{repo}]* push ke *{branch}* oleh *{pusher}* ({len(commits)} commit)"
        ]
        for c in commits[:5]:
            sha = (c.get("id") or "")[:7]
            msg = (c.get("message") or "").split("\n")[0][:120]
            url = c.get("url") or ""
            lines.append(f"`{sha}` {msg}\n{url}")
        if len(commits) > 5:
            lines.append(f"_+{len(commits)-5} commit lainnya_")
        return "\n\n".join(lines)

    if event == "pull_request":
        action = payload.get("action")
        repo = payload.get("repository", {}).get("full_name", "?")
        pr = payload.get("pull_request", {}) or {}
        num = pr.get("number")
        title = pr.get("title", "")
        user = (pr.get("user") or {}).get("login", "?")
        url = pr.get("html_url", "")
        return f"*PR* {repo} \\#{num} *{action}* oleh *{user}*\n*{title}*\n{url}"

    if event == "issues":
        action = payload.get("action")
        repo = payload.get("repository", {}).get("full_name", "?")
        issue = payload.get("issue", {}) or {}
        num = issue.get("number")
        title = issue.get("title", "")
        user = (issue.get("user") or {}).get("login", "?")
        url = issue.get("html_url", "")
        return f"*Issue* {repo} \\#{num} *{action}* oleh *{user}*\n*{title}*\n{url}"

    if event == "release":
        action = payload.get("action")
        repo = payload.get("repository", {}).get("full_name", "?")
        rel = payload.get("release", {}) or {}
        tag = rel.get("tag_name", "")
        url = rel.get("html_url", "")
        return f"*Release* {repo} *{action}*: *{tag}*\n{url}"

    if event == "workflow_run":
        repo = payload.get("repository", {}).get("full_name", "?")
        wr = payload.get("workflow_run", {}) or {}
        name = wr.get("name", "")
        status = wr.get("status", "")
        conclusion = wr.get("conclusion") or ""
        url = wr.get("html_url", "")
        return f"*CI* {repo}: *{name}* — *{status}* {conclusion}\n{url}"

    return f"*Event*: {event} diterima \\(diringkas\\)"
