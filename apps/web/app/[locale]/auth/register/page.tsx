"use client";

import { useState, FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Link } from "@/i18n/routing";
import { Loader2 } from "lucide-react";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { signUpEmail } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { invalidate } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signUpEmail(name, email, password);
      invalidate();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("registerError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthPanel title={t("registerTitle")}>
            <form onSubmit={handleSubmit} className="zipo-auth-form">
              <div>
                <label htmlFor="register-name" className="mb-1.5 block text-sm text-zipo-muted">
                  {t("name")}
                </label>
                <input
                  type="text"
                  id="register-name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="zipo-auth-input"
                />
              </div>
              <div>
                <label htmlFor="register-email" className="mb-1.5 block text-sm text-zipo-muted">
                  {t("email")}
                </label>
                <input
                  type="email"
                  id="register-email"
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
                <label htmlFor="register-password" className="mb-1.5 block text-sm text-zipo-muted">
                  {t("password")}
                </label>
                <input
                  type="password"
                  id="register-password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={15}
                  maxLength={128}
                  autoComplete="new-password"
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
                {t("registerButton")}
              </button>
            </form>

            <p className="zipo-auth-switch">
              {t("hasAccount")}{" "}
              <Link href="/auth/login">
                {t("loginButton")}
              </Link>
            </p>
    </AuthPanel>
  );
}
