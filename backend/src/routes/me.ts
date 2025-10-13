import { Router } from "express";
import { requireAuth } from "../middleware/session";

const router = Router();

router.get("/", requireAuth, (req, res) => {
  const user = (req as any).user;
  return res.json({
    user: {
      id: user.id,
      username: user.username,
      telegramUserId: user.telegramUserId,
      isAdmin: Boolean(user.isAdmin)
    }
  });
});

export default router;
