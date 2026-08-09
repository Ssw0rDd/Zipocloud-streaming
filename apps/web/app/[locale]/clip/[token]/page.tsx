import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";
import { fetchClipServer, fetchContentPoster } from "@/lib/api-server";
import { formatPlayerTime } from "@/components/player/utils";
import { ClipPageClient } from "./ClipPageClient";

interface ClipPageProps {
  params: Promise<{ token: string; locale: string }>;
}

export async function generateMetadata({ params }: ClipPageProps): Promise<Metadata> {
  const { token, locale } = await params;
  const t = await getTranslations({ locale, namespace: "clip" });

  try {
    const clip = await fetchClipServer(token);
    const poster = await fetchContentPoster(clip.contentType, clip.contentId);
    const description = t("ogDescription", {
      start: formatPlayerTime(clip.startTime),
      end: formatPlayerTime(clip.endTime),
    });

    return {
      title: `${clip.title} | ZiPo`,
      description,
      openGraph: {
        title: clip.title,
        description,
        type: "video.other",
        siteName: "ZiPo",
        ...(poster ? { images: [{ url: poster, width: 1200, height: 630, alt: clip.title }] } : {}),
      },
      twitter: {
        card: poster ? "summary_large_image" : "summary",
        title: clip.title,
        description,
        ...(poster ? { images: [poster] } : {}),
      },
    };
  } catch {
    return {
      title: t("sharedClip"),
      description: "ZiPo",
    };
  }
}

export default async function ClipPage({ params }: ClipPageProps) {
  const { token } = await params;

  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl px-4 py-8">
          <Skeleton className="aspect-video w-full rounded-xl" />
        </div>
      }
    >
      <ClipPageClient token={token} />
    </Suspense>
  );
}
