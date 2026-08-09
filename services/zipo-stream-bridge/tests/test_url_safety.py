import pytest

from url_safety import (
    OutboundUrlError,
    host_matches_allowlist,
    is_public_ip_address,
    validate_outbound_url_shape,
)


def test_rejects_private_reserved_and_metadata_addresses():
    for address in (
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "::1",
        "fc00::1",
        "::ffff:127.0.0.1",
    ):
        assert not is_public_ip_address(address)
    assert is_public_ip_address("1.1.1.1")
    assert is_public_ip_address("2606:4700:4700::1111")


def test_host_allowlist_requires_exact_host_unless_suffix_is_explicit():
    assert host_matches_allowlist("cdn.example.com", {"cdn.example.com"})
    assert not host_matches_allowlist("evilcdn.example.com", {"cdn.example.com"})
    assert host_matches_allowlist("media.cdn.example.com", {".cdn.example.com"})


def test_url_shape_requires_https_allowlist_and_no_credentials():
    assert validate_outbound_url_shape(
        "https://cdn.example.com/master.m3u8",
        {"cdn.example.com"},
    ).startswith("https://")
    for value in (
        "http://cdn.example.com/master.m3u8",
        "https://user:secret@cdn.example.com/master.m3u8",
        "https://cdn.example.com:8443/master.m3u8",
        "https://cdn.example.com:not-a-port/master.m3u8",
        "https://evil.example/master.m3u8",
        "file:///etc/passwd",
    ):
        with pytest.raises(OutboundUrlError):
            validate_outbound_url_shape(value, {"cdn.example.com"})
