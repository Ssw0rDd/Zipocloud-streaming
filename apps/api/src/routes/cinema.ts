import { and, desc, eq, isNull } from "drizzle-orm";
import { Elysia, t } from "elysia";
import sharp from "sharp";
import {
  cinemaPrintBodySchema,
  createCinemaRoomBodySchema,
  joinCinemaRoomBodySchema,
  type CinemaEvent,
} from "@zipo/shared";
import { db } from "../db";
import {
  cinemaMessages,
  cinemaRooms,
  mediaAttachments,
} from "../db/schema";
import { env } from "../env";
import { getSession } from "../auth";
import { getRedis } from "../lib/redis";
import { isValidContentId } from "../lib/id-validation";
import { deleteMediaObject, putMediaObject, signedMediaPreview } from "../media/storage";
import {
  handleCinemaClientEvent,
  publishCinemaEvent,
  registerCinemaSocket,
  sendSnapshot,
  unregisterCinemaSocket,
} from "../cinema/realtime";
import {
  type CinemaAccess,
  assertCinemaAccessActive,
  CinemaServiceError,
  createCinemaRoom,
  effectivePosition,
  getCinemaState,
  getRoomByToken,
  issueWsTicket,
  joinCinemaRoom,
  listParticipants,
  touchCinemaRoom,
  redeemWsTicket,
  verifyCinemaAccess,
} from "../cinema/service";
import { nanoid } from "nanoid";
import { assertItemForSite, assertSiteAccess } from "../services/site-mode";

interface SocketLike {
  data: { query?: { ticket?: string } };
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}

const socketAccess = new WeakMap<object, CinemaAccess>();

function disabled(set: { status?: number | string }) {
  if (env.CINEMA_ENABLED) return false;
  set.status = 404;
  return true;
}

function bearerAccess(request: Request): CinemaAccess | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer ([A-Za-z0-9_.-]{40,3000})$/);
  return match ? verifyCinemaAccess(match[1]) : null;
}

function serviceError(error: unknown, set: { status?: number | string }) {
  if (error instanceof CinemaServiceError) {
    set.status = error.code === "ROOM_NOT_FOUND" || error.code === "SITE_CONTENT_BLOCKED" ? 404
      : error.code === "ROOM_FULL" ? 409
        : error.code === "ADULT_LOGIN_REQUIRED" || error.code === "INVALID_ACCESS" ? 401
          : error.code === "BANNED" ? 403
            : error.code === "CINEMA_REQUIRES_MEGAFRIX_HLS" ? 422
            : 400;
    return { error: error.message, code: error.code };
  }
  set.status = 500;
  return { error: "Cinema operation failed", code: "CINEMA_ERROR" };
}

function timestampLabel(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

async function processCinemaPrint(access: CinemaAccess, image: string, timestamp: number) {
  const state = await getCinemaState(access.roomId);
  if (!state || Math.abs(effectivePosition(state) - timestamp) > 5) {
    throw new Error("PRINT_TIMESTAMP_INVALID");
  }
  const accepted = await getRedis().set(
    `cinema:print:rate:${access.roomId}:${access.participantId}`,
    "1",
    "EX",
    10,
    "NX",
  );
  if (accepted !== "OK") throw new Error("PRINT_RATE_LIMITED");
  const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("PRINT_INVALID_MIME");
  const input = Buffer.from(match[2], "base64");
  if (input.byteLength === 0 || input.byteLength > 2 * 1024 * 1024) {
    throw new Error("PRINT_TOO_LARGE");
  }
  const metadata = await sharp(input, { limitInputPixels: 30_000_000 }).metadata();
  if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format)) {
    throw new Error("PRINT_INVALID_IMAGE");
  }
  if (metadata.format !== match[1]) throw new Error("PRINT_MIME_MISMATCH");
  const label = timestampLabel(timestamp);
  const watermark = Buffer.from(
    `<svg width="720" height="72" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="72" rx="16" fill="rgba(0,0,0,.68)"/><text x="24" y="47" fill="white" font-family="Arial,sans-serif" font-size="30" font-weight="700">ZiPo • ${label}</text></svg>`,
  );
  const pipeline = sharp(input, { limitInputPixels: 30_000_000 })
    .rotate()
    .resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true })
    .composite([{ input: watermark, gravity: "southeast" }]);
  let output = await pipeline.clone().webp({ quality: 82 }).toBuffer();
  if (output.byteLength > 2 * 1024 * 1024) {
    output = await pipeline.clone().webp({ quality: 62 }).toBuffer();
  }
  if (output.byteLength > 2 * 1024 * 1024) throw new Error("PRINT_TOO_LARGE");
  const info = await sharp(output).metadata();
  await assertCinemaAccessActive(access);
  const expiresAt = await touchCinemaRoom(access.roomId);
  const attachmentId = crypto.randomUUID();
  const storageKey = `cinema/${access.roomId}/prints/${attachmentId}.webp`;
  await putMediaObject({ key: storageKey, body: output, contentType: "image/webp" });
  let message: typeof cinemaMessages.$inferSelect;
  let attachment: typeof mediaAttachments.$inferSelect;
  try {
    [message, attachment] = await db.transaction(async (tx) => {
    const [createdAttachment] = await tx.insert(mediaAttachments).values({
      id: attachmentId,
      roomId: access.roomId,
      kind: "print",
      storageKey,
      mimeType: "image/webp",
      sizeBytes: output.byteLength,
      width: info.width,
      height: info.height,
      expiresAt,
    }).returning();
    const [createdMessage] = await tx.insert(cinemaMessages).values({
      roomId: access.roomId,
      participantId: access.participantId,
      userId: access.userId,
      participantName: access.name,
      guest: access.guest,
      type: "print",
      status: "ready",
      body: label,
      attachmentId,
    }).returning();
    return [createdMessage, createdAttachment] as const;
    });
  } catch (error) {
    await deleteMediaObject(storageKey).catch(() => undefined);
    throw error;
  }
  const url = await signedMediaPreview(storageKey, 900);
  const event: CinemaEvent = {
    id: nanoid(16),
    type: "chat",
    roomId: access.roomId,
    participantId: access.participantId,
    payload: {
      message: {
        id: message.id,
        roomId: message.roomId,
        participantId: message.participantId,
        participantName: message.participantName,
        guest: message.guest,
        type: "print",
        status: "ready",
        body: label,
        attachment: {
          id: attachment.id,
          kind: "print",
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          width: attachment.width,
          height: attachment.height,
          url,
          expiresAt: attachment.expiresAt.toISOString(),
        },
        createdAt: message.createdAt.toISOString(),
      },
    },
    serverTime: Date.now(),
  };
  await publishCinemaEvent(access.roomId, event);
  return event.payload?.message;
}

export const cinemaRoutes = new Elysia({ prefix: "/api/v1/cinema" })
  .post("/rooms", async ({ body, request, set }) => {
    if (disabled(set)) return { error: "Not found", code: "NOT_FOUND" };
    const session = await getSession(request);
    if (!session?.user) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHORIZED" };
    }
    const parsed = createCinemaRoomBodySchema.safeParse(body);
    if (!parsed.success || !isValidContentId(parsed.data?.contentType ?? "movie", parsed.data?.contentId ?? "")) {
      set.status = 400;
      return { error: "Invalid room", code: "VALIDATION_ERROR" };
    }
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    try {
      return await createCinemaRoom({
        ...parsed.data,
        hostUserId: session.user.id,
        hostName: session.user.name,
        siteMode: access.mode,
      });
    } catch (error) {
      return serviceError(error, set);
    }
  })
  .get("/rooms/:token", async ({ params, request, set }) => {
    if (disabled(set)) return { error: "Not found", code: "NOT_FOUND" };
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    const room = await getRoomByToken(params.token);
    if (!room) {
      set.status = 404;
      return { error: "Cinema room not found", code: "ROOM_NOT_FOUND" };
    }
    const gate = assertItemForSite({ isAdult: room.isAdult }, access.mode);
    if (!gate.ok) {
      set.status = gate.status;
      return { error: gate.error, code: gate.code };
    }
    const state = await getCinemaState(room.id);
    if (!state) {
      set.status = 404;
      return { error: "Cinema room expired", code: "ROOM_NOT_FOUND" };
    }
    return {
      token: room.token,
      contentType: room.contentType,
      contentId: room.contentId,
      hasPassword: Boolean(room.passwordHash),
      isAdult: room.isAdult,
      participantCount: (await listParticipants(room.id)).length,
      maxParticipants: room.maxParticipants,
      expiresAt: room.expiresAt.toISOString(),
      embedCinemaChatOnly: env.EMBED_CINEMA_CHAT_ONLY,
    };
  }, { params: t.Object({ token: t.String() }) })
  .post("/rooms/:token/join", async ({ params, body, request, set }) => {
    if (disabled(set)) return { error: "Not found", code: "NOT_FOUND" };
    const parsed = joinCinemaRoomBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid join request", code: "VALIDATION_ERROR" };
    }
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    const session = await getSession(request).catch(() => null);
    try {
      return await joinCinemaRoom({
        request,
        token: params.token,
        ...parsed.data,
        siteMode: access.mode,
        user: session?.user ? { id: session.user.id, name: session.user.name } : undefined,
      });
    } catch (error) {
      return serviceError(error, set);
    }
  }, { params: t.Object({ token: t.String() }) })
  .post("/rooms/:token/tickets", async ({ params, request, set }) => {
    if (disabled(set)) return { error: "Not found", code: "NOT_FOUND" };
    const access = bearerAccess(request);
    if (!access || access.roomToken !== params.token) {
      set.status = 401;
      return { error: "Invalid Cinema access", code: "INVALID_ACCESS" };
    }
    try {
      await assertCinemaAccessActive(access);
    } catch (error) {
      return serviceError(error, set);
    }
    return { wsTicket: await issueWsTicket(access) };
  }, { params: t.Object({ token: t.String() }) })
  .get("/rooms/:token/messages", async ({ params, request, set }) => {
    if (disabled(set)) return { error: "Not found", code: "NOT_FOUND" };
    const access = bearerAccess(request);
    if (!access || access.roomToken !== params.token) {
      set.status = 401;
      return { error: "Invalid Cinema access", code: "INVALID_ACCESS" };
    }
    try {
      await assertCinemaAccessActive(access);
    } catch (error) {
      return serviceError(error, set);
    }
    const rows = await db.select({ message: cinemaMessages, attachment: mediaAttachments })
      .from(cinemaMessages)
      .leftJoin(mediaAttachments, eq(mediaAttachments.id, cinemaMessages.attachmentId))
      .where(and(eq(cinemaMessages.roomId, access.roomId), isNull(cinemaMessages.deletedAt)))
      .orderBy(desc(cinemaMessages.createdAt))
      .limit(50);
    const messages = await Promise.all(rows.reverse().map(async ({ message, attachment }) => ({
      id: message.id,
      roomId: message.roomId,
      participantId: message.participantId ?? undefined,
      participantName: message.participantName,
      guest: message.guest,
      type: message.type,
      status: message.status,
      body: message.body ?? undefined,
      attachment: attachment ? {
        id: attachment.id,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width ?? undefined,
        height: attachment.height ?? undefined,
        url: await signedMediaPreview(attachment.storageKey, 900),
        expiresAt: attachment.expiresAt.toISOString(),
      } : undefined,
      createdAt: message.createdAt.toISOString(),
    })));
    return { messages };
  }, { params: t.Object({ token: t.String() }) })
  .post("/rooms/:token/prints", async ({ params, body, request, set }) => {
    if (disabled(set)) return { error: "Not found", code: "NOT_FOUND" };
    if (env.EMBED_CINEMA_CHAT_ONLY) {
      set.status = 403;
      return {
        error: "Prints require controlled media; Cinema is chat-only",
        code: "EMBED_CINEMA_CHAT_ONLY",
      };
    }
    const access = bearerAccess(request);
    if (!access || access.roomToken !== params.token) {
      set.status = 401;
      return { error: "Invalid Cinema access", code: "INVALID_ACCESS" };
    }
    const parsed = cinemaPrintBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid print", code: "VALIDATION_ERROR" };
    }
    try {
      const message = await processCinemaPrint(access, parsed.data.image, parsed.data.timestamp);
      set.status = 201;
      return { message };
    } catch (error) {
      if (error instanceof CinemaServiceError) return serviceError(error, set);
      const code = error instanceof Error ? error.message : "PRINT_FAILED";
      set.status = code === "PRINT_RATE_LIMITED" ? 429 : 400;
      return { error: "Print rejected", code };
    }
  }, { params: t.Object({ token: t.String() }) })
  .ws("/ws", {
    query: t.Object({ ticket: t.String({ minLength: 32, maxLength: 32 }) }),
    beforeHandle({ request, set }) {
      if (!env.CINEMA_ENABLED) {
        set.status = 404;
        return;
      }
      const origin = request.headers.get("origin");
      const allowed = new Set(
        [env.FRONTEND_URL, env.NSFW_FRONTEND_URL, ...env.CORS_ORIGINS].filter(Boolean),
      );
      if (origin && !allowed.has(origin)) {
        set.status = 403;
      }
    },
    async open(rawSocket) {
      const socket = rawSocket as unknown as SocketLike;
      const access = await redeemWsTicket(socket.data.query?.ticket ?? "");
      if (!access) {
        socket.close(4003, "Sessao da sala expirada");
        return;
      }
      socketAccess.set(rawSocket as object, access);
      await registerCinemaSocket(access, socket);
      await sendSnapshot(access, socket);
    },
    async message(rawSocket, message) {
      const socket = rawSocket as unknown as SocketLike;
      const access = socketAccess.get(rawSocket as object);
      if (!access) {
        socket.close(4003, "Sessao da sala expirada");
        return;
      }
      try {
        await handleCinemaClientEvent(access, String(message));
      } catch (error) {
        const code = error instanceof Error ? error.message : "CINEMA_EVENT_REJECTED";
        socket.send(JSON.stringify({
          id: nanoid(16),
          type: "error",
          roomId: access.roomId,
          participantId: access.participantId,
          payload: { code },
          serverTime: Date.now(),
        } satisfies CinemaEvent));
      }
    },
    close(rawSocket) {
      const access = socketAccess.get(rawSocket as object);
      if (!access) return;
      unregisterCinemaSocket(access, rawSocket as unknown as SocketLike);
      socketAccess.delete(rawSocket as object);
    },
  });
