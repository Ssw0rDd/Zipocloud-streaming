import { apiFetch } from "./api-client";

export interface AccountMe {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isSupporter: boolean;
  adultConfirmed: boolean;
  adultConfirmedAt: string | null;
}

export async function fetchAccountMe(): Promise<AccountMe> {
  return apiFetch<AccountMe>("/api/v1/account/me");
}

export async function confirmAdult(): Promise<{ ok: boolean; adultConfirmed: boolean }> {
  return apiFetch("/api/v1/account/confirm-adult", { method: "POST" });
}
