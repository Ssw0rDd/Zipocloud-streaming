from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Iterable
from urllib.parse import urlparse


class OutboundUrlError(ValueError):
    """Raised when an outbound URL violates the bridge egress policy."""


def is_public_ip_address(raw_address: str) -> bool:
    try:
        address = ipaddress.ip_address(raw_address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.is_global


def host_matches_allowlist(hostname: str, allowed_hosts: Iterable[str]) -> bool:
    host = hostname.rstrip(".").lower()
    for raw_entry in allowed_hosts:
        entry = raw_entry.strip().rstrip(".").lower()
        if not entry:
            continue
        if entry.startswith("."):
            suffix = entry[1:]
            if host == suffix or host.endswith(f".{suffix}"):
                return True
        elif host == entry:
            return True
    return False


def validate_outbound_url_shape(url: str, allowed_hosts: Iterable[str]) -> str:
    if not url or len(url) > 4_096:
        raise OutboundUrlError("Outbound URL length rejected")
    parsed = urlparse(url)
    try:
        port = parsed.port
    except ValueError as error:
        raise OutboundUrlError("Outbound URL port rejected") from error
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or not host_matches_allowlist(parsed.hostname, allowed_hosts)
    ):
        raise OutboundUrlError("Outbound URL origin rejected")
    return url


async def assert_public_outbound_url(url: str, allowed_hosts: Iterable[str]) -> str:
    validate_outbound_url_shape(url, allowed_hosts)
    hostname = urlparse(url).hostname
    if not hostname:
        raise OutboundUrlError("Outbound URL hostname rejected")
    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            hostname,
            443,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as error:
        raise OutboundUrlError("Outbound hostname did not resolve") from error
    resolved = {entry[4][0] for entry in addresses if entry[4]}
    if not resolved or any(not is_public_ip_address(address) for address in resolved):
        raise OutboundUrlError("Outbound hostname resolved to a non-public address")
    return url
