"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSession, resolveUserTier, signOut, type AuthSession } from "@/lib/auth";

const SESSION_KEY = ["auth", "session"] as const;

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: session, isLoading, refetch } = useQuery({
    queryKey: SESSION_KEY,
    queryFn: getSession,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const tier = resolveUserTier(session ?? null);

  const logout = async () => {
    await signOut();
    queryClient.setQueryData<AuthSession | null>(SESSION_KEY, null);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: SESSION_KEY });
  };

  return {
    session: session ?? null,
    user: session?.user ?? null,
    tier,
    isLoggedIn: Boolean(session?.user),
    isLoading,
    logout,
    refetch,
    invalidate,
  };
}
