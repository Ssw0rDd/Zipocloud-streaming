import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { getSession } from "../auth";
import { db } from "../db";
import { users } from "../db/schema";
import { isUserAdultConfirmed } from "../services/site-mode";

export const accountRoutes = new Elysia({ prefix: "/api/v1/account" })
  .get("/me", async ({ request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user) {
      set.status = 401;
      return { error: "Não autenticado", code: "UNAUTHORIZED" };
    }
    const user = session.user as {
      id: string;
      name: string;
      email: string;
      image?: string | null;
      isSupporter?: boolean;
      adultConfirmedAt?: Date | string | null;
    };
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      isSupporter: Boolean(user.isSupporter),
      adultConfirmed: isUserAdultConfirmed(user),
      adultConfirmedAt: user.adultConfirmedAt ?? null,
    };
  })
  .post("/confirm-adult", async ({ request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "Login necessário", code: "NSFW_LOGIN_REQUIRED" };
    }

    const now = new Date();
    await db
      .update(users)
      .set({ adultConfirmedAt: now, updatedAt: now })
      .where(eq(users.id, session.user.id));

    return {
      ok: true,
      adultConfirmed: true,
      adultConfirmedAt: now.toISOString(),
    };
  });
