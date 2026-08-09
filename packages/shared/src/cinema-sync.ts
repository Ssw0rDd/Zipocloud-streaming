export type CinemaDriftCorrection =
  | { action: "none"; playbackRate: number }
  | { action: "speed"; playbackRate: number }
  | { action: "seek"; positionSeconds: number; playbackRate: number };

export function cinemaDriftCorrection(
  currentSeconds: number,
  targetSeconds: number,
  playbackRate: number,
): CinemaDriftCorrection {
  const drift = targetSeconds - currentSeconds;
  const absoluteDrift = Math.abs(drift);
  if (absoluteDrift > 2) {
    return { action: "seek", positionSeconds: Math.max(0, targetSeconds), playbackRate };
  }
  if (absoluteDrift >= 0.75) {
    return {
      action: "speed",
      playbackRate: Math.min(2, Math.max(0.5, playbackRate + Math.sign(drift) * 0.05)),
    };
  }
  return { action: "none", playbackRate };
}
