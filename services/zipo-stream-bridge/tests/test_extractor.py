from pathlib import Path

from extractor import _pick_stream_url, build_embed_url

FIXTURE = Path(__file__).parent / "fixtures" / "superflix_embed.html"


def test_build_superflix_movie_embed_url():
    url = build_embed_url(
        content_type="movie",
        imdb_id="tt0111161",
        tmdb_id=278,
        season=None,
        episode=None,
        base_url="https://superflixapi.pro",
    )
    assert url == "https://superflixapi.pro/filme/278#noEpList#noLink#transparent#color:16a34a"


def test_build_superflix_series_embed_url():
    url = build_embed_url(
        content_type="series",
        imdb_id=None,
        tmdb_id=1399,
        season=1,
        episode=1,
        base_url="https://superflixapi.pro",
    )
    assert url.startswith("https://superflixapi.pro/serie/1399/1/1")


def test_pick_master_m3u8_from_fixture():
    html = FIXTURE.read_text(encoding="utf-8")
    picked = _pick_stream_url(html)
    assert picked is not None
    url, stream_type = picked
    assert stream_type == "hls"
    assert url.endswith("master.m3u8?token=abc")


def test_pick_quoted_file_url():
    body = 'var cfg = { file: "https://cdn.example.test/vod/playlist.m3u8?sig=1" };'
    picked = _pick_stream_url(body)
    assert picked is not None
    assert picked[1] == "hls"


def test_pick_atob_embedded_m3u8():
    import base64
    encoded = base64.b64encode(b"https://cdn.example.test/hidden/master.m3u8").decode()
    body = f"const u = atob('{encoded}');"
    picked = _pick_stream_url(body)
    assert picked is not None
    assert "master.m3u8" in picked[0]
