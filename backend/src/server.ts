import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config";
import "./db";
import { sessionMiddleware } from "./middleware/session";
import authRouter from "./routes/auth";
import botsRouter from "./routes/bots";
import destinationsRouter from "./routes/destinations";
import eventsRouter from "./routes/events";
import githubWebhookRouter from "./routes/githubWebhook";
import githubIntegrationRouter from "./routes/githubIntegration";
import meRouter from "./routes/me";
import statsRouter from "./routes/stats";
import subscriptionsRouter from "./routes/subscriptions";
import telegramWebhookRouter from "./routes/telegramWebhook";

const app = express();

app.set("trust proxy", true);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan("dev"));
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = Buffer.from(buf);
    }
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "gh-weebhooks-backend" });
});

app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/bots", botsRouter);
app.use("/api/destinations", destinationsRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/github", githubIntegrationRouter);
app.use("/wh", githubWebhookRouter);
app.use("/tg", telegramWebhookRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(config.port, () => {
  console.log(`Backend listening on port ${config.port}`);
});
