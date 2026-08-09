import { Elysia } from "elysia";
import { z } from "zod";
import {
  getTVMazePerson,
  getTVMazePersonCredits,
  mapTVMazePerson,
  searchTVMazePeople,
} from "../services/tvmaze";
import { CACHE_TTL } from "../lib/cache-ttl";
import { cacheGet, cacheSet } from "../lib/redis";

const personIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const personSearchSchema = z.object({
  q: z.string().min(1).max(200),
});

export const personRoutes = new Elysia({ prefix: "/api/v1" })
  .get("/person/search", async ({ query, set }) => {
    const parsed = personSearchSchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid query", details: parsed.error.flatten() };
    }

    try {
      const people = await searchTVMazePeople(parsed.data.q);
      return {
        query: parsed.data.q,
        items: people.slice(0, 10).map(mapTVMazePerson),
      };
    } catch (err) {
      set.status = 502;
      return {
        error: err instanceof Error ? err.message : "Search failed",
        code: "UPSTREAM_ERROR",
      };
    }
  })
  .get(
    "/person/:id",
    async ({ params, set }) => {
      const parsed = personIdSchema.safeParse(params);
      if (!parsed.success) {
        set.status = 400;
        return { error: "Invalid person ID", code: "INVALID_ID" };
      }

      const cacheKey = `person:${parsed.data.id}`;
      const cached = await cacheGet<ReturnType<typeof mapTVMazePerson>>(cacheKey);
      if (cached) return cached;

      try {
        const person = await getTVMazePerson(parsed.data.id);
        const mapped = mapTVMazePerson(person);
        await cacheSet(cacheKey, mapped, CACHE_TTL.CONTENT);
        return mapped;
      } catch (err) {
        set.status = 404;
        return {
          error: err instanceof Error ? err.message : "Person not found",
          code: "NOT_FOUND",
        };
      }
    },
    { params: personIdSchema },
  )
  .get(
    "/person/:id/credits",
    async ({ params, set }) => {
      const parsed = personIdSchema.safeParse(params);
      if (!parsed.success) {
        set.status = 400;
        return { error: "Invalid person ID", code: "INVALID_ID" };
      }

      const cacheKey = `person:${parsed.data.id}:credits`;
      const cached = await cacheGet<
        Array<{ showName: string; character?: string }>
      >(cacheKey);
      if (cached) return { credits: cached };

      try {
        const credits = await getTVMazePersonCredits(parsed.data.id);
        const mapped = credits.map((credit) => ({
          showName:
            credit._links?.show?.name ??
            credit._links?.show?.href?.split("/").pop() ??
            "Unknown",
          character: credit.character?.name,
        }));
        await cacheSet(cacheKey, mapped, CACHE_TTL.CONTENT);
        return { credits: mapped };
      } catch (err) {
        set.status = 502;
        return {
          error: err instanceof Error ? err.message : "Failed to load credits",
          code: "UPSTREAM_ERROR",
        };
      }
    },
    { params: personIdSchema },
  );
