from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote, urljoin, urlparse

import httpx

from config import settings
from url_safety import OutboundUrlError, assert_public_outbound_url

LOGGER = logging.getLogger(__name__)
IMDB_PATTERN = re.compile(r"^tt\d{7,8}$")
M3U8_PATTERN = re.compile(
    r"https?://[^\s\"'<>\\]+?\.m3u8(?:\?[^\s\"'<>\\]*)?",
    re.IGNORECASE,
)
MPD_PATTERN = re.compile(
    r"https?://[^\s\"'<>\\]+?\.mpd(?:\?[^\s\"'<>\\]*)?",
    re.IGNORECASE,
)
MP4_PATTERN = re.compile(
    r"https?://[^\s\"'<>\\]+?\.mp4(?:\?[^\s\"'<>\\]*)?",
    re.IGNORECASE,
)
ROLA3_ORIGIN = "https://embedplayer2.xyz"
VOLTZ_ORIGIN = "https://vods.faz-o-eli.online"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
MAX_BODY_BYTES = 1_500_000
MAX_CRAWL_DEPTH = 4
RETRY_DELAYS = (1.0, 2.0, 4.0)
MAX_REDIRECTS = 3
ContentType = Literal["movie", "series", "anime"]
StreamType = Literal["hls", "dash", "mp4"]
ProviderId = Literal["superflix", "warezcdn", "megafrix"]


@dataclass(frozen=True)
class ExtractResult:
    stream_url: str
    stream_type: StreamType
    provider_id: ProviderId
    embed_url: str


class ExtractError(Exception):
    """Raised when no authorized playable source can be resolved."""


def _positive_int(value: int | None) -> bool:
    return value is not None and isinstance(value, int) and value > 0


def build_embed_url(
    *,
    content_type: ContentType,
    imdb_id: str | None,
    tmdb_id: int | None,
    season: int | None,
    episode: int | None,
    base_url: str,
) -> str | None:
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or not parsed.netloc:
        return None

    if content_type == "movie":
        movie_id = str(tmdb_id) if _positive_int(tmdb_id) else None
        if not movie_id and imdb_id and IMDB_PATTERN.fullmatch(imdb_id):
            movie_id = imdb_id
        if not movie_id:
            return None
        path = f"/filme/{movie_id}"
    else:
        if not (_positive_int(tmdb_id) and _positive_int(season) and _positive_int(episode)):
            return None
        path = f"/serie/{tmdb_id}/{season}/{episode}"

    return f"{parsed.scheme}://{parsed.netloc}{path}#noEpList#noLink#transparent#color:16a34a"


async def resolve_content_ids(content_type: ContentType, content_id: str) -> tuple[str | None, int | None]:
    url = (
        f"{settings.internal_api_url.rstrip('/')}/api/v1/content/"
        f"{content_type}/{quote(content_id, safe='')}"
    )
    async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "ZiPo-Stream-Bridge/1.0"}) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()
    external = payload.get("externalIds") or {}
    imdb_id = external.get("imdb")
    tmdb_raw = external.get("tmdb")
    tmdb_id = int(tmdb_raw) if tmdb_raw is not None else None
    if not imdb_id and IMDB_PATTERN.fullmatch(content_id):
        imdb_id = content_id
    return imdb_id, tmdb_id


def _decode_embedded_urls(text: str) -> list[str]:
    found: list[str] = []
    for match in re.finditer(r"atob\(\s*['\"]([A-Za-z0-9+/=]{16,})['\"]\s*\)", text):
        try:
            decoded = base64.b64decode(match.group(1)).decode("utf-8", errors="ignore")
            found.extend(M3U8_PATTERN.findall(decoded))
            found.extend(MPD_PATTERN.findall(decoded))
            found.extend(MP4_PATTERN.findall(decoded))
        except Exception:  # noqa: BLE001
            continue
    return found


def _json_blob_urls(text: str) -> list[str]:
    urls: list[str] = []
    for match in re.finditer(r"\{[^{}]{0,4000}?\}", text):
        chunk = match.group(0)
        if ".m3u8" not in chunk and ".mpd" not in chunk and ".mp4" not in chunk:
            continue
        try:
            payload = json.loads(chunk.replace("'", '"'))
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            for key in ("file", "source", "url", "src", "hls", "hlsUrl", "securedLink", "videoSource", "stream"):
                value = payload.get(key)
                if isinstance(value, str) and (
                    ".m3u8" in value or ".mpd" in value or ".mp4" in value
                ):
                    urls.append(value)
    return urls


def _quoted_media_urls(text: str) -> list[str]:
    patterns = [
        r"""["'](https?://[^"']+\.m3u8[^"']*)["']""",
        r"""["'](https?://[^"']+\.mpd[^"']*)["']""",
        r"""["'](https?://[^"']+\.mp4[^"']*)["']""",
        r"""file\s*:\s*["'](https?://[^"']+)["']""",
        r"""source\s*:\s*["'](https?://[^"']+)["']""",
        r"""hlsUrl\s*:\s*["'](https?://[^"']+)["']""",
        r"""playlistUrl\s*:\s*["'](https?://[^"']+)["']""",
        r"""securedLink\s*:\s*["'](https?://[^"']+)["']""",
        r"""videoSource\s*:\s*["'](https?://[^"']+)["']""",
    ]
    urls: list[str] = []
    for pattern in patterns:
        urls.extend(re.findall(pattern, text, flags=re.IGNORECASE))
    return urls


def _pick_stream_url(body: str) -> tuple[str, StreamType] | None:
    for url in _decode_embedded_urls(body):
        picked = _rank_url(url)
        if picked:
            return picked
    for url in _json_blob_urls(body):
        picked = _rank_url(url)
        if picked:
            return picked
    for url in _quoted_media_urls(body):
        picked = _rank_url(url)
        if picked:
            return picked

    master = re.search(r"https?://[^\s\"'<>\\]+?master\.m3u8[^\s\"'<>\\]*", body, re.IGNORECASE)
    if master:
        return master.group(0), "hls"

    m3u8_matches = M3U8_PATTERN.findall(body)
    if m3u8_matches:
        preferred = next((url for url in m3u8_matches if "master" in url.lower()), m3u8_matches[0])
        return preferred, "hls"

    mpd_matches = MPD_PATTERN.findall(body)
    if mpd_matches:
        return mpd_matches[0], "dash"

    mp4_matches = [url for url in MP4_PATTERN.findall(body) if _valid_voltz_mp4(url)]
    if mp4_matches:
        return mp4_matches[0], "mp4"

    return None


def _rank_url(url: str) -> tuple[str, StreamType] | None:
    lower = url.lower()
    if ".m3u8" in lower:
        return url, "hls"
    if ".mpd" in lower:
        return url, "dash"
    if ".mp4" in lower and _valid_voltz_mp4(url):
        return url, "mp4"
    return None


def _valid_voltz_mp4(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return (
            parsed.scheme == "https"
            and re.search(r"\.vod\d{2}e\d{3}\.fun$", parsed.hostname or "", re.IGNORECASE)
            and parsed.path.lower().endswith(".mp4")
        )
    except Exception:  # noqa: BLE001
        return False


def _collect_links(html: str, base_url: str) -> list[str]:
    origin = f"{urlparse(base_url).scheme}://{urlparse(base_url).netloc}"
    links: list[str] = []
    for pattern in (
        r"""<iframe[^>]+src=["']([^"']+)["']""",
        r"""<script[^>]+src=["']([^"']+)["']""",
        r"""<source[^>]+src=["']([^"']+)["']""",
        r"""href=["']([^"']+)["']""",
    ):
        for match in re.finditer(pattern, html, re.IGNORECASE):
            src = match.group(1).strip()
            if src.startswith("//"):
                src = f"https:{src}"
            elif src.startswith("/"):
                src = urljoin(origin, src)
            if src.startswith("http"):
                links.append(src)
    return links


def _parse_rola3(raw_url: str) -> tuple[str, str] | None:
    try:
        url = urlparse(raw_url)
        hash_match = re.match(r"^/rola3/([a-f0-9]{32})/?$", url.path, re.IGNORECASE)
        if url.scheme == "https" and url.netloc == urlparse(ROLA3_ORIGIN).netloc and hash_match:
            return ROLA3_ORIGIN, hash_match.group(1)
    except Exception:  # noqa: BLE001
        return None
    return None


async def _extract_rola3(client: httpx.AsyncClient, embed_url: str, referer: str) -> tuple[str, StreamType] | None:
    parsed = _parse_rola3(embed_url)
    if not parsed:
        return None
    origin, hash_value = parsed
    endpoint = f"{origin}/player/index.php?{httpx.QueryParams({'data': hash_value, 'do': 'getVideo'})}"
    response = await client.post(
        endpoint,
        data={"hash": hash_value, "r": ""},
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": origin,
            "Referer": f"{origin}/rola3/{hash_value}",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict):
        for key in ("securedLink", "videoSource"):
            value = payload.get(key)
            if isinstance(value, str):
                ranked = _rank_url(value)
                if ranked:
                    return ranked
    return None


async def _extract_voltz(client: httpx.AsyncClient, embed_url: str) -> tuple[str, StreamType] | None:
    try:
        url = urlparse(embed_url)
        if url.netloc != urlparse(VOLTZ_ORIGIN).netloc or url.path != "/voltz.php":
            return None
    except Exception:  # noqa: BLE001
        return None
    response = await client.get(
        embed_url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html",
            "Referer": f"{VOLTZ_ORIGIN}/",
        },
    )
    response.raise_for_status()
    html = response.text
    raw = re.search(r"\b(?:const|let|var)\s+stream\s*=\s*(['\"])(https:[^'\"]+)\1", html)
    if raw:
        ranked = _rank_url(raw.group(2))
        if ranked:
            return ranked
    return None


async def _fetch_text(
    client: httpx.AsyncClient,
    url: str,
    allowed_hosts: set[str],
    referer: str | None = None,
) -> str:
    current = url
    for redirect_count in range(MAX_REDIRECTS + 1):
        try:
            await assert_public_outbound_url(current, allowed_hosts)
        except OutboundUrlError as error:
            raise ExtractError(str(error)) from error
        async with client.stream(
            "GET",
            current,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/json,*/*",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                **({"Referer": referer} if referer else {}),
            },
            follow_redirects=False,
        ) as response:
            if response.is_redirect:
                location = response.headers.get("location")
                if not location or redirect_count >= MAX_REDIRECTS:
                    raise ExtractError("Embed redirect rejected")
                current = urljoin(current, location)
                continue
            response.raise_for_status()
            raw_declared_size = response.headers.get("content-length", "0") or "0"
            try:
                declared_size = int(raw_declared_size)
            except ValueError as error:
                raise ExtractError("Embed response has an invalid content length") from error
            if declared_size > MAX_BODY_BYTES:
                raise ExtractError("Embed response is too large")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BODY_BYTES:
                    raise ExtractError("Embed response is too large")
            return body.decode(response.encoding or "utf-8", errors="ignore")
    raise ExtractError("Embed redirect rejected")


async def _validate_media_url(
    picked: tuple[str, StreamType],
    allowed_hosts: set[str],
) -> tuple[str, StreamType]:
    url, _stream_type = picked
    effective_hosts = set(allowed_hosts)
    if _valid_voltz_mp4(url):
        hostname = urlparse(url).hostname
        if hostname:
            effective_hosts.add(hostname)
    try:
        await assert_public_outbound_url(url, effective_hosts)
    except OutboundUrlError as error:
        raise ExtractError(str(error)) from error
    return picked


async def _extract_from_page(
    client: httpx.AsyncClient,
    page_url: str,
    referer: str | None,
    depth: int,
    seen: set[str],
    allowed_hosts: set[str],
) -> tuple[str, StreamType]:
    if page_url in seen or depth > MAX_CRAWL_DEPTH:
        raise ExtractError("Crawl depth exceeded")
    seen.add(page_url)

    try:
        await assert_public_outbound_url(page_url, allowed_hosts)
    except OutboundUrlError as error:
        raise ExtractError(str(error)) from error

    rola3 = await _extract_rola3(client, page_url, referer or page_url)
    if rola3:
        return await _validate_media_url(rola3, allowed_hosts)

    voltz = await _extract_voltz(client, page_url)
    if voltz:
        return await _validate_media_url(voltz, allowed_hosts)

    html = await _fetch_text(client, page_url, allowed_hosts, referer=referer)
    picked = _pick_stream_url(html)
    if picked:
        return await _validate_media_url(picked, allowed_hosts)

    for link in _collect_links(html, page_url):
        if link in seen:
            continue
        if not any(token in link for token in (".m3u8", ".mpd", ".mp4", "rola3", "voltz", "player", "embed")):
            continue
        try:
            if _parse_rola3(link):
                nested = await _extract_rola3(client, link, page_url)
                if nested:
                    return await _validate_media_url(nested, allowed_hosts)
            if "voltz.php" in link:
                nested = await _extract_voltz(client, link)
                if nested:
                    return await _validate_media_url(nested, allowed_hosts)
            nested = await _extract_from_page(
                client,
                link,
                page_url,
                depth + 1,
                seen,
                allowed_hosts,
            )
            return nested
        except (ExtractError, httpx.HTTPError):
            continue

    raise ExtractError("No HLS, DASH or MP4 stream found")


async def extract_stream(
    *,
    content_type: ContentType,
    content_id: str,
    season: int | None = None,
    episode: int | None = None,
) -> ExtractResult:
    imdb_id, tmdb_id = await resolve_content_ids(content_type, content_id)
    providers: list[tuple[str, ProviderId]] = []
    if settings.superflix_enabled:
        providers.append((settings.superflix_base_url, "superflix"))
    if settings.warezcdn_enabled:
        providers.append((settings.warezcdn_base_url, "warezcdn"))

    if not providers:
        raise ExtractError("No catalog provider enabled (SUPERFLIX_ENABLED / WAREZCDN_ENABLED)")

    allowed_hosts = {
        hostname
        for base_url, _provider_id in providers
        if (hostname := urlparse(base_url).hostname)
    }
    allowed_hosts.update({"embedplayer2.xyz", "vods.faz-o-eli.online"})
    allowed_hosts.update(settings.allowed_media_hosts)

    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=15.0) as client:
        for base_url, provider_id in providers:
            embed_url = build_embed_url(
                content_type=content_type,
                imdb_id=imdb_id,
                tmdb_id=tmdb_id,
                season=season,
                episode=episode,
                base_url=base_url,
            )
            if not embed_url:
                continue
            for delay in RETRY_DELAYS:
                try:
                    fetch_url = embed_url.split("#", 1)[0]
                    stream_url, stream_type = await _extract_from_page(
                        client,
                        fetch_url,
                        referer=fetch_url,
                        depth=0,
                        seen=set(),
                        allowed_hosts=allowed_hosts,
                    )
                    stream_url, stream_type = await _validate_media_url(
                        (stream_url, stream_type),
                        allowed_hosts,
                    )
                    resolved_provider: ProviderId = provider_id
                    if "embedplayer2.xyz" in stream_url or "rola3" in embed_url:
                        resolved_provider = "megafrix"
                    return ExtractResult(
                        stream_url=stream_url,
                        stream_type=stream_type,
                        provider_id=resolved_provider,
                        embed_url=embed_url,
                    )
                except Exception as error:  # noqa: BLE001
                    last_error = error
                    LOGGER.warning("Extract attempt failed (%s): %s", provider_id, error)
                    await asyncio.sleep(delay)

    raise ExtractError(str(last_error) if last_error else "Stream extraction failed")
