import { obfuscatedAdClass } from "@/lib/ads";
import type { AdUnitConfig } from "@/lib/ads-config";

interface AdSlotProps {
  unit: AdUnitConfig;
  sessionSeed: string;
  label?: string;
}

/**
 * AdSlot — SSR injection with obfuscated class names.
 * When ads are disabled, never inject third-party HTML.
 */
export function AdSlot({ unit, sessionSeed, label }: AdSlotProps) {
  if (process.env.NEXT_PUBLIC_ADS_ENABLED !== "true") return null;
  if (!unit.enabled) return null;

  const obfuscatedClass = obfuscatedAdClass(sessionSeed, unit.placement);

  const formatClass =
    unit.type === "sidebar"
      ? "zp-ad-sidebar"
      : unit.type === "native"
        ? "zp-ad-inline"
        : "zp-ad-banner";

  return (
    <div
      className={`zp-ad-slot glass-card zp-ad-${unit.type} ${formatClass}`}
      data-zp="ad-slot"
      data-zp-unit={unit.id}
    >
      <div
        className={obfuscatedClass}
        data-zp-ad={unit.id}
        data-zp-placement={unit.placement}
      >
        <ins
          className="adsbygoogle block"
          data-ad-client="ca-pub-zipo-placeholder"
          data-ad-slot={unit.adUnitId}
        />
        <span
          data-zp="ad-label"
          className="text-[10px] uppercase tracking-[0.1em] text-zinc-400"
        >
          {label}
        </span>
      </div>
    </div>
  );
}
