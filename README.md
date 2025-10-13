# GitHub → Telegram Notifier (Next.js + Express rewrite)

This repository now ships a JavaScript/TypeScript stack built with **Next.js 14** (App Router) for the admin UI and an **Express 4** backend for webhook handling, Telegram delivery, and persistence in SQLite. The original FastAPI implementation is kept under `app/` for reference while the rewrite is stabilised.

## Project layout

```
backend/   Express API, GitHub + Telegram webhook handlers, SQLite persistence
frontend/  Next.js dashboard, Tailwind CSS, shadcn/ui components
app/       Legacy FastAPI application (to be removed once migration completes)
```

## Backend (Express)

### Setup

```bash
cd backend
npm install
cp ../.env.example ../.env    # reuse existing environment variables
npm run dev                    # starts on http://localhost:4000
```

Core environment variables (same keys as legacy app):

| Name                    | Default                         | Purpose                                                   |
| ----------------------- | ------------------------------- | --------------------------------------------------------- |
| `DB_URL`                | `sqlite:///./github_tg.sqlite3` | SQLite DSN (Prisma-style paths are resolved automatically) |
| `PUBLIC_BASE_URL`       | `http://localhost:4000`         | Public URL used when registering Telegram webhooks        |
| `ADMIN_USER_IDS`        | `""`                           | Comma separated Telegram user IDs with admin privileges   |
| `LOGIN_BOT_TOKEN`       | _empty_                         | Telegram bot token used for the web login flow            |
| `LOGIN_BOT_USERNAME`    | _empty_                         | Telegram bot username (without `@`) for the login widget  |
| `SESSION_COOKIE_NAME`   | `app_session`                   | Cookie that stores admin session tokens                   |
| `SESSION_DURATION_HOURS`| `24`                            | Session lifetime                                          |
| `TIMEZONE`              | `Asia/Jakarta`                  | Timezone for persisted timestamps                         |

### Features

- RESTful admin endpoints under `/api/*` for bots, destinations, subscriptions, and sessions
- Telegram login verification (`POST /api/auth/telegram/verify`) shares logic with the legacy version
- GitHub webhook endpoint `/wh/:hookId` validates `X-Hub-Signature-256` and records deliveries in `webhook_event_logs`
- Telegram webhook sink `/tg/:botId/:token` keeps Bot API hooks alive while the service remains outbound-only

## Frontend (Next.js)

### Setup

```bash
cd frontend
npm install
cp .env.example .env.local  # create if needed; see variables below
npm run dev                 # starts on http://localhost:3000
```

Add the following environment variables in `frontend/.env.local`:

```
NEXT_PUBLIC_API_BASE=http://localhost:4000
NEXT_PUBLIC_TELEGRAM_LOGIN_BOT=your_bot_username_without_at
```

### Screens

- `/login` – Telegram Login Widget integrated with the backend verification endpoint
- `/dashboard` – Client-side dashboard for managing bots, destinations, and subscriptions (consumes the Express API)

Tailwind CSS powers styling and shadcn/ui-inspired primitives (see `src/components/ui`).

## Running both services

1. Start the backend (`npm run dev` inside `backend/`)
2. Start the frontend (`npm run dev` inside `frontend/`)
3. Visit `http://localhost:3000/login`

## Next steps

- Port advanced GitHub event summarisation (currently simplified) from the Python service
- Harden auth flows (rate limiting, CSRF guards) and add role-based admin tooling
- Migrate remaining templates/features from the legacy FastAPI app before removing `app/`

## Legacy FastAPI code

The original Python implementation remains under `app/` together with its routers, models, and templates. Keep it until the new stack reaches feature parity.
