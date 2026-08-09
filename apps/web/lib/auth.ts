import { getApiBaseUrl } from "./api-client";
import { siteModeHeaders } from "./site-mode";

function authBase(): string {
  return `${getApiBaseUrl()}/api/auth`;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isSupporter?: boolean;
  adultConfirmedAt?: string | Date | null;
}

export interface AuthSession {
  user: AuthUser;
  session: {
    id: string;
    expiresAt: string;
  };
}

async function authFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${authBase()}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...siteModeHeaders(),
      ...options?.headers,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : `Auth error ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

export async function getSession(): Promise<AuthSession | null> {
  try {
    const data = await authFetch<{ user: AuthUser | null; session: AuthSession["session"] | null }>(
      "/get-session",
    );
    if (!data.user || !data.session) return null;
    return { user: data.user, session: data.session };
  } catch {
    return null;
  }
}

export async function signInEmail(email: string, password: string): Promise<AuthSession> {
  const data = await authFetch<{ user: AuthUser; token?: string }>("/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const session = await getSession();
  if (!session) {
    return {
      user: data.user,
      session: { id: "", expiresAt: new Date(Date.now() + 86400000).toISOString() },
    };
  }
  return session;
}

export async function signUpEmail(
  name: string,
  email: string,
  password: string,
): Promise<AuthSession> {
  await authFetch("/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  return signInEmail(email, password);
}

export async function signOut(): Promise<void> {
  await authFetch("/sign-out", { method: "POST" });
}

export function resolveUserTier(
  session: AuthSession | null,
): "guest" | "member" | "supporter" {
  if (!session?.user) return "guest";
  if (session.user.isSupporter) return "supporter";
  return "member";
}
