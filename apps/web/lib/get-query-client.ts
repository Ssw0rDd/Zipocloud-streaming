import { QueryClient } from "@tanstack/react-query";
import { CATALOG_STALE_TIME } from "./query-config";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: CATALOG_STALE_TIME,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
