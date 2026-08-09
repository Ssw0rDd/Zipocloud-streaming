"use client";

import { useState, FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Link } from "@/i18n/routing";
import { Loader2 } from "lucide-react";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { signInEmail } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { invalidate } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInEmail(email, password);
      invalidate();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthPanel title={t("loginTitle")}>
            <form onSubmit={handleSubmit} className="zipo-auth-form">
              <div>
                <label htmlFor="login-email" className="mb-1.5 block text-sm text-zipo-muted">
                  {t("email")}
                </label>
                <input
                  type="email"
                  id="login-email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  spellCheck={false}
                  className="zipo-auth-input"
                />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-sm text-zipo-muted">
                  {t("password")}
                </label>
                <input
                  type="password"
                  id="login-password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="zipo-auth-input"
                />
              </div>
              {error && (
                <p className="text-sm text-red-400" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="zipo-auth-action"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("loginButton")}
              </button>
            </form>

            <p className="zipo-auth-switch">
              {t("noAccount")}{" "}
              <Link href="/auth/register">
                {t("registerButton")}
              </Link>
            </p>
    </AuthPanel>
  );
}
