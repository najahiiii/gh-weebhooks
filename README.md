# GitHub → Telegram Notifier (multi-user, multi-bot) with Topics & Channels

FastAPI app that lets multiple end-users connect their own Telegram bots and receive GitHub Webhook notifications in Telegram chats.
Supports personal chats (PM), groups (including Group Topics), and channels. Uses SQLite by default and stores time in WIB (Asia/Jakarta, UTC+7).

---

## Features

- Multi-user: each Telegram user has their own account.
- Multi-bot per user: users can register 1+ Telegram bot tokens.
- Destinations: PM / group / channel; optional `topic_id` for Group Topics.
- Subscriptions: bind `owner/repo` + `bot_id` + `destination_id` to forward GitHub events.
- Event summaries: `push`, `pull_request`, `issues`, `release`, `workflow_run`, `ping`.
- HMAC verification for GitHub (`X-Hub-Signature-256`).
- MarkdownV2-safe rendering for Telegram messages.
- Environment-based config with `.env` support (`python-dotenv`).
- No migrations required for a fresh setup (SQLite schema created on first run).

---

## Architecture (high level)

- `users`: Telegram users of the app (admin flag is app-level).
- `bots`: Telegram bot tokens registered by a user.
- `destinations`: Telegram chat targets (optionally with `topic_id`).
- `subscriptions`: GitHub webhook bindings per repo to a (bot, destination) pair.

Endpoints:

- `POST /tg/{bot_id}/{token}` – Telegram webhook for a specific user-bot.
- `POST /wh/{hook_id}` – GitHub webhook endpoint for a subscription.
- `GET /` – health.

---

## Requirements

- Python 3.9+ (uses `zoneinfo`; 3.11+ recommended).
- Telegram Bot API token(s).
- Publicly reachable HTTPS endpoint (for both Telegram and GitHub webhooks).

---

## Quickstart (with `venv`)

```bash
# 1) Clone
git clone https://github.com/najahiiii/gh-weebhooks.git
cd gh-weebhooks

# 2) Create & activate venv
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate

# 3) Install deps
pip install -U pip
pip install -r requirements.txt

# 4) Create .env
cp .env.example .env  # or create manually, see below

# 5) Run
uvicorn app.app:app --host 127.0.0.1 --port PORTS --workers 2 --proxy-headers --forwarded-allow-ips="*"
```

---

## Configuration

Create a `.env` file in the project root:

```ini
# Database (SQLite default is fine)
DB_URL=sqlite:///./github_tg.sqlite3

# Public base URL of your server (HTTPS)
PUBLIC_BASE_URL=https://yourdomain.exe

# Comma-separated Telegram numeric user IDs who should be admins in the app
ADMIN_USER_IDS=123456789,987654321
```

The app uses `python-dotenv` to load `.env` automatically.

---

## Telegram setup

This project is **multi-bot** per user. Each user can connect their own bot token.

1) Create a Telegram bot via BotFather and get the bot token (e.g. `123456789:AA...`).

2) Set the **Telegram webhook** for that bot to point to this app.
   Replace `{bot_id}` and `{token}` with your bot’s values:

    ```text
    https://yourdomain.exe/tg/{bot_id}/{token}
    ```

    - `{bot_id}` is the numeric part before `:` in the token.
    - Example:
    - Token: `123456789:AA...`
    - Webhook URL: `https://yourdomain.exe/tg/123456789/123456789:AA...`

3) Interact with your bot in Telegram and run `/start` to register yourself.

---

## Basic commands (Telegram chat)

```text
/start
/help

# Manage bots
/connectbot <token>
/listbot

# Destinations (PM/Group/Channel; Group Topic supported)
# Save current chat (and current topic if present)
# or specify <chat_id> and optional :<topic_id>
/adddest here [name]
/adddest <chat_id> [name]
/adddest <chat_id>:<topic_id> [name]
/listdest
/usedest <dest_id>
/testdest

# GitHub subscriptions
/subscribe <owner/repo> [event1,event2,...]
/listsubs
/unsubscribe <id>

# Admin (app-level)
/whoami
/promote <telegram_user_id>
/demote <telegram_user_id>
/listusers
/listsubs_all
/checkdest <dest_id>
```

Notes:

- For channels, add your bot as administrator of the channel.
- For groups, add your bot into the group; for Group Topics, either post in a topic and run `/adddest here`, or save with `<chat_id>:<topic_id>`.

---

## GitHub webhook setup

After adding a destination and choosing a default destination:

1) In Telegram, run:

    ```text
    /subscribe owner/repo push,pull_request
    ```

    If you omit events, `*` is used (all allowed by the app).

2) The bot replies with a Payload URL and Secret, for example:

    ```text
    Payload URL: https://yourdomain.exe/wh/abcd1234ef...
    Content type: application/json
    Secret: 9f7c...e21
    Events: pick as needed
    ```

3) Go to the GitHub repository → Settings → Webhooks → Add webhook:
   - Payload URL: the one provided (`/wh/<hook_id>`).
   - Content type: `application/json`.
   - Secret: as provided.
   - Select the events you want (they must match if you restricted them in `/subscribe`).

   The app verifies `X-Hub-Signature-256` using the secret.

---

## Running in development

```bash
# Activate venv
source .venv/bin/activate

# Launch
uvicorn app:app --reload --port 8000 --env-file .env
```

Health check:

```bash
curl -s https://yourdomain.exe/ | cat
```

---

## Database

- Default is SQLite; schema is created automatically on first run:
  - `users`, `bots`, `destinations`, `subscriptions`
- For a brand-new setup, you do not need migrations.
  If you later switch databases (PostgreSQL, MySQL), update `DB_URL` accordingly.

---

## Time zone

All timestamps are timezone-aware in WIB (Asia/Jakarta, UTC+7) via `zoneinfo`.
When displaying times, `.isoformat()` includes the `+07:00` offset.

---

## Security considerations

- Protect your database: bot tokens are stored in `bots.token`.
- Use HTTPS everywhere. Do not log raw tokens or secrets.
- The Telegram webhook path includes the bot token; treat logs carefully.
- Use strong, unique webhook secrets for GitHub.
- Restrict admin access via `ADMIN_USER_IDS`.

---

## Group Topics and Channels

- Group Topics: use `/adddest here` from within the topic thread or store `<chat_id>:<topic_id>`. The app sets `message_thread_id` when sending.
- Channels: your bot must be added as administrator. Use `/checkdest <dest_id>` to verify the bot’s status in that chat.

---

## Troubleshooting

- No messages arriving from GitHub:
  - Check the webhook delivery log in GitHub (redeliver if needed).
  - Ensure the Secret matches.
  - Confirm your server is reachable over HTTPS.
- Telegram webhook not firing:
  - Verify the webhook URL is set for the correct bot.
  - Ensure your server URL matches `PUBLIC_BASE_URL`.
  - Talk to the bot (`/start`) at least once to create your user.
- MarkdownV2 formatting issues:
  - The app escapes special characters; if you paste exotic text, verify the output.

---

## Extending

- Add more GitHub events in `pretty_github_event`.
- Add rate limiting, auditing, or message templates per subscription.
- Replace per-user multi-bot with a single master bot by removing `bots` and sourcing a single token from environment.

---

## Project layout

- `app.py` – FastAPI application, models, endpoints, and Telegram/GitHub helpers.
- `.env.example` – sample environment file (create your own `.env`).

---

## Example `.env.example`

```ini
DB_URL=sqlite:///./github_tg.sqlite3
PUBLIC_BASE_URL=https://yourdomain.exe
ADMIN_USER_IDS=123456789
```

---

## License

This project is licensed under the [MIT License](https://github.com/najahiiii/gh-weebhooks/blob/master/LICENSE).
