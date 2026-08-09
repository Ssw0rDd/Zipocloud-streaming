"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ExternalLink, Megaphone } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { AdUnitConfig } from "@/lib/ads-config";

interface NativeAdCardProps {
  unit: AdUnitConfig;
  tier: string;
  index?: number;
  title?: string;
  description?: string;
  imageUrl?: string;
  sponsorName?: string;
  href?: string;
  contentId?: string;
  contentType?: string;
}

export function NativeAdCard({
  unit,
  tier,
  index = 0,
  title,
  description,
  imageUrl,
  sponsorName,
  href,
  contentId,
  contentType,
}: NativeAdCardProps) {
  const t = useTranslations("ads");
  const safeHref = href && href !== "#" ? href : null;

  useEffect(() => {
    apiFetch("/api/v1/ads/impression", {
      method: "POST",
      body: JSON.stringify({
        adUnitId: unit.adUnitId,
        tier,
        placement: "grid",
        contentId,
        contentType,
      }),
    }).catch(() => {
      /* non-blocking */
    });
  }, [unit.adUnitId, tier, contentId, contentType]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35 }}
      whileHover={{ scale: 1.02 }}
      className="zp-native-ad group relative glass-card"
      data-zp="native-ad"
      data-zp-unit={unit.id}
    >
      <span className="zp-native-ad-label inline-flex items-center gap-1">
        <Megaphone className="h-3 w-3" aria-hidden="true" />
        {t("sponsored")}
      </span>

      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          width={640}
          height={360}
          sizes="(max-width: 640px) 100vw, 33vw"
          quality={55}
          className="zp-native-ad-image"
          loading="lazy"
        />
      ) : (
        <div className="flex h-[55%] items-center justify-center bg-gradient-to-br from-zipo-accent/20 to-zipo-elevated">
          <Megaphone className="h-10 w-10 text-zipo-accent/50" aria-hidden="true" />
        </div>
      )}

      <div className="zp-native-ad-body">
        <p className="zp-native-ad-sponsor">{sponsorName ?? t("partner")}</p>
        <h4>{title ?? t("nativeTitle")}</h4>
        <p>{description ?? t("nativeDescription")}</p>
        {safeHref ? (
          <a
            href={safeHref}
            className="zp-native-ad-cta inline-flex items-center gap-1 transition-colors hover:text-zipo-accent-hover"
            rel="sponsored noopener noreferrer"
            target="_blank"
            aria-label={t("learnMore")}
          >
            {t("learnMore")}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : (
          <span className="zp-native-ad-cta inline-flex items-center gap-1 text-zipo-muted">
            {t("learnMore")}
          </span>
        )}
      </div>
    </motion.article>
  );
}
