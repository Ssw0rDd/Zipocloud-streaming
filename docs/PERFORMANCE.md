# Performance baseline and budgets

This file is the performance ledger for ZiPo. Measurements are repeated after changes to shared rendering, media preparation, compression, or caching.

## API response compression

The previous implementation used synchronous `gzipSync` on the Bun request loop. A synthetic local benchmark compressed 100 independent 512 KiB random payloads:

| Implementation | Event-loop delay | Wall time |
| --- | ---: | ---: |
| `gzipSync` | 1510.1 ms | 1510.3 ms |
| `CompressionStream` | 30.0 ms | 2543.7 ms |

The streaming implementation has lower serial throughput in this deliberately incompressible workload, but avoids blocking all concurrent requests for about 1.5 seconds. Production Nginx still handles edge Brotli/gzip; the API stream is the fallback for direct clients and SSR traffic. Correctness is covered by a gzip round-trip test.

## Browser bundle baseline

Measured from the Next.js production app manifest on 2026-08-08. Each route includes the locale layout and its page JavaScript. Gzip values are deterministic local estimates, not transfer telemetry.

| Route | Raw JS | Gzip JS | Enforced gzip budget |
| --- | ---: | ---: | ---: |
| Home | 759.1 KiB | 232.7 KiB | 260 KiB |
| Movie detail | 763.3 KiB | 234.4 KiB | 265 KiB |
| Watch | 768.3 KiB | 235.8 KiB | 270 KiB |
| Cinema | 797.9 KiB | 243.1 KiB | 275 KiB |
| Profile | 759.0 KiB | 233.0 KiB | 265 KiB |

Locale-layout CSS is 101.8 KiB raw and 18.2 KiB gzip, with budgets of 130 KiB and 22 KiB. Run `pnpm --filter @zipo/web check:bundle` after a production build. Budget increases require an explanation in this ledger and evidence that route-level code splitting cannot absorb the change.

## Real-user metrics

The browser reports CLS, FCP, FID, INP, LCP, and TTFB through Next.js `useReportWebVitals`. The API accepts only finite allowlisted metrics, normalizes locale/content/token path segments, emits structured logs, and stores no raw URL or user identifier. Recommended production alerts use p75 by normalized route: LCP <= 2.5 s, INP <= 200 ms, and CLS <= 0.1.

## CSP rendering trade-off

The locale layout reads request headers so every document is rendered with the
same nonce carried by its per-response Content Security Policy. This disables
static HTML generation for locale routes. `_next/static` assets remain immutable
and cacheable, while document TTFB must be controlled through data caches,
streaming SSR, keep-alive connections, and horizontal web replicas. Reintroducing
`generateStaticParams` requires replacing the nonce strategy first; otherwise
the generated HTML and response policy can diverge.
