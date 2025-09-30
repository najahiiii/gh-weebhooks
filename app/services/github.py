# "Yet another gh services"

from __future__ import annotations

from html import escape as _esc

MAX_COMMITS = 5  # tampilkan maksimal 5 commit


def _esc_html(value) -> str:
    return _esc(str(value or ""), quote=True)


def _link(url: str | None, text: str | None = None) -> str:
    if not url:
        return ""
    t = text or url
    return f'<a href="{_esc_html(url)}">{_esc_html(t)}</a>'


def _first_line(s: str, limit: int = 120) -> str:
    return (s or "").split("\n")[0][:limit]


def summarize_event(event: str, payload: dict) -> str:
    """
    Summarize GitHub webhook events as HTML (safe for Telegram parse_mode='HTML').
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
            "payload_url: " + (_link(payload_url) if payload_url else "<code>-</code>"),
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

    if event == "create":
        repo = (payload.get("repository") or {}).get("full_name", "?")
        ref_type = payload.get("ref_type") or "ref"
        ref = payload.get("ref") or "?"
        sender = (payload.get("sender") or {}).get("login", "?")
        return (
            f"<b>Create</b> {_esc_html(repo)}: {_esc_html(ref_type)} "
            f"<code>{_esc_html(ref)}</code> oleh <b>{_esc_html(sender)}</b>"
        )

    if event == "delete":
        repo = (payload.get("repository") or {}).get("full_name", "?")
        ref_type = payload.get("ref_type") or "ref"
        ref = payload.get("ref") or "?"
        sender = (payload.get("sender") or {}).get("login", "?")
        return (
            f"<b>Delete</b> {_esc_html(repo)}: {_esc_html(ref_type)} "
            f"<code>{_esc_html(ref)}</code> dihapus oleh <b>{_esc_html(sender)}</b>"
        )

    if event == "push":
        repo_obj = payload.get("repository") or {}
        repo = repo_obj.get("full_name", "?")
        repo_url = repo_obj.get("html_url") or ""
        ref = payload.get("ref") or ""
        is_tag = ref.startswith("refs/tags/")
        name = ref.split("/")[-1] if ref else "?"
        deleted = bool(payload.get("deleted"))
        forced = bool(payload.get("forced"))
        pusher = (payload.get("pusher") or {}).get("name") or (
            payload.get("sender") or {}
        ).get("login", "?")
        commits = payload.get("commits") or []
        compare_url = payload.get("compare") or ""

        target_label = "tag" if is_tag else "branch"
        act = "deleted" if deleted else "push ke"
        repo_disp = _link(repo_url, repo) if repo_url else _esc_html(repo)

        head = (
            f"<b>[{repo_disp}]</b> {act} <b>{_esc_html(name)}</b> "
            f"({target_label}) oleh <b>{_esc_html(pusher)}</b>"
        )
        if not deleted:
            head += f" ({len(commits)} commit)"
        if forced:
            head += " <i>(forced)</i>"

        lines = [head]

        if compare_url and not deleted:
            lines.append(_link(compare_url, "compare"))

        if commits and not deleted:
            lines.append("")

        shown = min(len(commits), MAX_COMMITS)
        for i, c in enumerate(commits[:MAX_COMMITS]):
            sha = (c.get("id") or "")[:7]
            msg = _first_line(c.get("message"))
            url = c.get("url") or ""
            lines.append(f"<code>{_esc_html(sha)}</code> {_esc_html(msg)}")
            if url:
                lines.append(_esc_html(url))
            if i < shown - 1:
                lines.append("")  # baris kosong antar commit

        if len(commits) > MAX_COMMITS:
            lines.append(f"<i>+{len(commits) - MAX_COMMITS} commit lainnya</i>")

        return "\n".join(lines)

    if event == "pull_request":
        action = payload.get("action") or ""
        repo = (payload.get("repository") or {}).get("full_name", "?")
        pr = payload.get("pull_request") or {}
        num = pr.get("number") or payload.get("number") or "?"
        title = pr.get("title") or ""
        user = (pr.get("user") or {}).get("login", "?")
        url = pr.get("html_url") or ""
        head_ref = (pr.get("head") or {}).get("ref") or "?"
        base_ref = (pr.get("base") or {}).get("ref") or "?"

        merged = bool(pr.get("merged"))
        action_disp = "merged" if (action == "closed" and merged) else action

        head = (
            f"<b>PR</b> {_esc_html(repo)} #{_esc_html(num)} "
            f"<b>{_esc_html(action_disp)}</b> oleh <b>{_esc_html(user)}</b>"
        )
        body = f"<b>{_esc_html(title)}</b>"
        extra = f"{_esc_html(head_ref)} → {_esc_html(base_ref)}"
        link = _link(url, "lihat PR") if url else ""

        lines = [head, body, extra]
        if link:
            lines.append(link)
        return "\n".join(lines)

    if event == "issues":
        action = payload.get("action") or ""
        repo = (payload.get("repository") or {}).get("full_name", "?")
        issue = payload.get("issue") or {}
        num = issue.get("number") or payload.get("number") or "?"
        title = issue.get("title") or ""
        user = (issue.get("user") or {}).get("login", "?")
        url = issue.get("html_url") or ""
        head = (
            f"<b>Issue</b> {_esc_html(repo)} #{_esc_html(num)} "
            f"<b>{_esc_html(action)}</b> oleh <b>{_esc_html(user)}</b>"
        )
        body = f"<b>{_esc_html(title)}</b>"
        link = _link(url, "lihat issue") if url else ""
        lines = [head, body]
        if link:
            lines.append(link)
        return "\n".join(lines)

    if event == "release":
        action = payload.get("action") or ""
        repo = (payload.get("repository") or {}).get("full_name", "?")
        rel = payload.get("release") or {}
        tag = rel.get("tag_name") or ""
        url = rel.get("html_url") or ""
        lines = [
            f"<b>Release</b> {_esc_html(repo)} <b>{_esc_html(action)}</b>: <b>{_esc_html(tag)}</b>"
        ]
        if url:
            lines.append(_link(url, "lihat release"))
        return "\n".join(lines)

    if event == "workflow_run":
        repo = (payload.get("repository") or {}).get("full_name", "?")
        wr = payload.get("workflow_run") or {}
        name = wr.get("name") or ""
        status = wr.get("status") or ""
        conclusion = wr.get("conclusion") or ""
        url = wr.get("html_url") or ""
        run_no = wr.get("run_number")
        head = (
            f"<b>CI</b> {_esc_html(repo)}: <b>{_esc_html(name)}</b>"
            f"{' #' + _esc_html(run_no) if run_no else ''} — "
            f"<b>{_esc_html(status)}</b> {_esc_html(conclusion)}"
        )
        if url:
            return f"{head}\n{_link(url, 'lihat run')}"
        return head

    # fallback
    return f"<b>Event</b>: {_esc_html(event)} diterima (diringkas)"
