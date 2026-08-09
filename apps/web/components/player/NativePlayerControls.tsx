"use client";

import {
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { EmbedSource } from "./types";
import { formatPlayerTime } from "./utils";

interface QualityLevel {
  value: number;
  label: string;
}

interface NativePlayerControlsProps {
  currentTime: number;
  duration: number;
  buffered: number;
  isPlaying: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
  isFullscreen: boolean;
  /** Kept for API compatibility; player switch lives only in the top bar. */
  servers: EmbedSource[];
  sourceUrl: string;
  qualityLevels: QualityLevel[];
  selectedQuality: number;
  playbackLocked?: boolean;
  labels: {
    play: string;
    pause: string;
    mute: string;
    unmute: string;
    volume: string;
    speed: string;
    quality: string;
    server: string;
    fullscreen: string;
    exitFullscreen: string;
    skipBack?: string;
    skipForward?: string;
  };
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onToggleMute: () => void;
  onVolume: (volume: number) => void;
  onPlaybackRate: (rate: number) => void;
  onQuality: (level: number) => void;
  onServer: (url: string) => void;
  onPictureInPicture: () => void;
  onFullscreen: () => void;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function NativePlayerControls({
  currentTime,
  duration,
  buffered,
  isPlaying,
  muted,
  volume,
  playbackRate,
  isFullscreen,
  qualityLevels,
  selectedQuality,
  playbackLocked = false,
  labels,
  onTogglePlay,
  onSeek,
  onToggleMute,
  onVolume,
  onPlaybackRate,
  onQuality,
  onPictureInPicture,
  onFullscreen,
}: NativePlayerControlsProps) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrent = Math.min(safeDuration || currentTime, Math.max(0, currentTime));
  const progress = safeDuration ? (safeCurrent / safeDuration) * 100 : 0;
  const bufferedProgress = safeDuration
    ? Math.min(100, Math.max(0, (buffered / safeDuration) * 100))
    : 0;

  const skip = (delta: number) => {
    if (playbackLocked) return;
    const next = Math.max(0, Math.min(safeDuration || Number.MAX_SAFE_INTEGER, safeCurrent + delta));
    onSeek(next);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#0f1410] via-[#0f1410]/85 to-transparent px-3 pb-3 pt-14 text-[#f2f5f1] sm:px-4">
      <div className="pointer-events-auto relative h-5 touch-none">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/15">
          <div className="h-full bg-white/25" style={{ width: `${bufferedProgress}%` }} />
          <div className="absolute inset-y-0 left-0 bg-zipo-accent" style={{ width: `${progress}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={safeDuration || 0}
          step={0.1}
          value={safeCurrent}
          disabled={playbackLocked}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Progresso da reprodução"
          className="absolute inset-0 h-5 w-full cursor-pointer appearance-none bg-transparent accent-zipo-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zipo-accent/80 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-zipo-accent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-0.5 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zipo-accent"
        />
      </div>

      <div className="pointer-events-auto flex min-w-0 items-center gap-0.5 sm:gap-1.5">
        <button type="button" onClick={() => skip(-10)} disabled={playbackLocked} className="player-utility-button min-h-11 min-w-11 disabled:cursor-not-allowed disabled:opacity-50" aria-label={labels.skipBack ?? "Voltar 10s"}>
          <RotateCcw className="h-4 w-4" />
        </button>
        <button type="button" onClick={onTogglePlay} disabled={playbackLocked} className="player-utility-button min-h-11 min-w-11 rounded-full bg-zipo-accent/20 text-zipo-accent hover:bg-zipo-accent/30 disabled:cursor-not-allowed disabled:opacity-50" aria-label={isPlaying ? labels.pause : labels.play}>
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
        </button>
        <button type="button" onClick={() => skip(10)} disabled={playbackLocked} className="player-utility-button min-h-11 min-w-11 disabled:cursor-not-allowed disabled:opacity-50" aria-label={labels.skipForward ?? "Avançar 10s"}>
          <RotateCw className="h-4 w-4" />
        </button>
        <button type="button" onClick={onToggleMute} className="player-utility-button min-h-11 min-w-11" aria-label={muted ? labels.unmute : labels.mute}>
          {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(event) => onVolume(Number(event.target.value))}
          aria-label={labels.volume}
          className="hidden h-11 w-20 cursor-pointer accent-zipo-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zipo-accent/70 sm:block lg:w-24"
        />
        <span className="whitespace-nowrap text-[11px] tabular-nums text-white/80 sm:text-xs">
          {formatPlayerTime(safeCurrent)} / {formatPlayerTime(safeDuration)}
        </span>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          {qualityLevels.length > 1 && (
            <select
              value={selectedQuality}
              onChange={(event) => onQuality(Number(event.target.value))}
              aria-label={labels.quality}
              className="hidden h-11 rounded-lg border border-white/15 bg-[#121412]/95 px-2 text-xs text-[#f2f5f1] outline-none focus-visible:ring-2 focus-visible:ring-zipo-accent/70 sm:block"
            >
              {qualityLevels.map((level) => (
                <option key={level.value} value={level.value}>{level.label}</option>
              ))}
            </select>
          )}
          <select
            value={playbackRate}
            disabled={playbackLocked}
            onChange={(event) => onPlaybackRate(Number(event.target.value))}
            aria-label={labels.speed}
            className="hidden h-11 rounded-lg border border-white/15 bg-[#121412]/95 px-2 text-xs text-[#f2f5f1] outline-none focus-visible:ring-2 focus-visible:ring-zipo-accent/70 md:block"
          >
            {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
          </select>
          <button type="button" onClick={onPictureInPicture} className="player-utility-button hidden min-h-11 min-w-11 sm:inline-flex" aria-label="Picture in Picture">
            <PictureInPicture2 className="h-5 w-5" />
          </button>
          <button type="button" onClick={onFullscreen} className="player-utility-button min-h-11 min-w-11" aria-label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}>
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
