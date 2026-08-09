import { setRequestLocale } from "next-intl/server";
import { ProfileHubClient } from "./ProfileHubClient";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProfileHubClient />;
}
