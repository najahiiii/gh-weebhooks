# "Yet another gh services"

from __future__ import annotations

from html import escape as _esc


def _esc_html(value) -> str:
    return _esc(str(value or ""), quote=True)


def _link(url: str | None, text: str | None = None) -> str:
    if not url:
        return ""
    t = text or url
    return f'<a href="{_esc_html(url)}">{_esc_html(t)}</a>'


def summarize_event(event: str, payload: dict) -> str:
    """
    Summarize GitHub webhook events as HTML (safe for Telegram parse_mode='HTML').

    Args:
        event (str): GitHub webhook event name.
        payload (dict): Webhook JSON payload.

    Returns:
        str: Formatted HTML summary.
    """
    event = (event or "").lower()

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
            "<b>GitHub webhook ping received</b>",
            f"repo: <code>{_esc_html(repo)}</code>",
            f"hook_id: <code>{_esc_html(hook_id)}</code>",
            (
                "events: <code>*</code>"
                if not events
                else "events: "
                + ", ".join(f"<code>{_esc_html(e)}</code>" for e in events)
            ),
            (
                "payload_url: "
                + (_link(payload_url) if payload_url else "<code>-</code>")
            ),
            f"last_response: <code>{_esc_html(last_resp)}</code>",
            f"created_at: <code>{_esc_html(created_at)}</code>",
            f"updated_at: <code>{_esc_html(updated_at)}</code>",
        ]
        if test_url:
            lines.append("test_url: " + _link(test_url))
        if ping_url:
            lines.append("ping_url: " + _link(ping_url))
        if zen:
            lines.append(f"zen: {_esc_html(zen)}")

        return "\n".join(lines)

    if event == "push":
        repo = (payload.get("repository") or {}).get("full_name", "?")
        branch = (payload.get("ref") or "refs/heads/?").split("/")[-1]
        pusher = (payload.get("pusher") or {}).get("name") or (
            payload.get("sender") or {}
        ).get("login", "?")
        commits = payload.get("commits") or []

        lines = [
            f"<b>[{_esc_html(repo)}]</b> push ke <b>{_esc_html(branch)}</b> oleh "
            f"<b>{_esc_html(pusher)}</b> ({len(commits)} commit)"
        ]

        for c in commits[:5]:
            sha = (c.get("id") or "")[:7]
            msg = (c.get("message") or "").split("\n")[0][:120]
            url = c.get("url") or ""
            lines.append(f"<code>{_esc_html(sha)}</code> {_esc_html(msg)}")
            if url:
                lines.append(_esc_html(url))
        if len(commits) > 5:
            lines.append(f"<i>+{len(commits) - 5} commit lainnya</i>")

        return "\n".join(lines)

    if event == "pull_request":
        action = payload.get("action") or ""
        repo = (payload.get("repository") or {}).get("full_name", "?")
        pr = payload.get("pull_request") or {}
        num = payload.get("number") or pr.get("number") or "?"
        title = pr.get("title") or ""
        user = (pr.get("user") or {}).get("login", "?")
        url = pr.get("html_url") or ""
        head = f"<b>PR</b> {_esc_html(repo)} #{_esc_html(num)} <b>{_esc_html(action)}</b> oleh <b>{_esc_html(user)}</b>"
        body = f"<b>{_esc_html(title)}</b>"
        link = _esc_html(url)
        return f"{head}\n{body}\n{link}"

    if event == "issues":
        action = payload.get("action") or ""
        repo = (payload.get("repository") or {}).get("full_name", "?")
        issue = payload.get("issue") or {}
        num = issue.get("number") or payload.get("number") or "?"
        title = issue.get("title") or ""
        user = (issue.get("user") or {}).get("login", "?")
        url = issue.get("html_url") or ""
        head = f"<b>Issue</b> {_esc_html(repo)} #{_esc_html(num)} <b>{_esc_html(action)}</b> oleh <b>{_esc_html(user)}</b>"
        body = f"<b>{_esc_html(title)}</b>"
        link = _esc_html(url)
        return f"{head}\n{body}\n{link}"

    if event == "release":
        action = payload.get("action") or ""
        repo = (payload.get("repository") or {}).get("full_name", "?")
        rel = payload.get("release") or {}
        tag = rel.get("tag_name") or ""
        url = rel.get("html_url") or ""
        return f"<b>Release</b> {_esc_html(repo)} <b>{_esc_html(action)}</b>: <b>{_esc_html(tag)}</b>\n{_esc_html(url)}"

    if event == "workflow_run":
        repo = (payload.get("repository") or {}).get("full_name", "?")
        wr = payload.get("workflow_run") or {}
        name = wr.get("name") or ""
        status = wr.get("status") or ""
        conclusion = wr.get("conclusion") or ""
        url = wr.get("html_url") or ""
        return (
            f"<b>CI</b> {_esc_html(repo)}: <b>{_esc_html(name)}</b> — "
            f"<b>{_esc_html(status)}</b> {_esc_html(conclusion)}\n{_esc_html(url)}"
        )

    return f"<b>Event</b>: {_esc_html(event)} diterima (diringkas)"
