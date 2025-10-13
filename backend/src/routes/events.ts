import { Router } from "express";
import { requireAuth } from "../middleware/session";
import { EVENT_NAMES } from "../services/github";

const router = Router();

router.get("/", requireAuth, (_req, res) => {
  res.json({ events: EVENT_NAMES.slice().sort() });
});

export default router;
