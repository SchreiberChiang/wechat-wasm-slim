"""IPv4 LAN discovery and existing RemotePairing tunnel for pmd3 11.40.0.

Uses upstream DNS helpers, pair-verify, userspace TUN factory and RSD dial plane.
Does not patch installed files, pair, modify routing, or start a system service.
"""
import argparse
import asyncio
import hashlib
import ipaddress
import json
import plistlib
import socket
import time
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path


def fingerprint(serial):
    return hashlib.sha256(serial.encode()).hexdigest()[:16]


def existing_pair(expected):
    from pymobiledevice3.osu.os_utils import get_os_utils
    utils = get_os_utils()
    matches = []
    for directory in [utils.pair_record_path, utils.get_home_folder_path()]:
        if directory.is_dir():
            matches.extend(file for file in directory.glob("*.plist") if fingerprint(file.stem) == expected)
    if not matches:
        raise RuntimeError("Existing ordinary pairing record not found; no automatic pairing")
    file = matches[0]
    return file.stem, plistlib.loads(file.read_bytes())


def discover(interface, expected, prefix_length, seconds=6):
    from pymobiledevice3.bonjour import (build_query, parse_mdns_message, QTYPE_PTR,
                                       MOBDEV2_SERVICE_NAME, REMOTEPAIRING_SERVICE_NAME)
    from pymobiledevice3.osu.os_utils import get_os_utils
    from pymobiledevice3.remote.siphash import validate_auth_tag
    serial, pair = existing_pair(expected)
    remote_file = get_os_utils().get_home_folder_path() / f"remote_{serial}.plist"
    if not remote_file.exists():
        raise RuntimeError("RemotePairing missing; never create it automatically")
    peer_irk = plistlib.loads(remote_file.read_bytes()).get("peer_alt_irk")
    if peer_irk is None:
        raise RuntimeError("RemotePairing has no peer_alt_irk; user-authorized re-pairing would be needed")
    local = ipaddress.IPv4Address(interface)
    network = ipaddress.IPv4Network(f"{interface}/{prefix_length}", strict=False)
    if not local.is_private or local.is_loopback:
        raise ValueError("Use the observed private physical LAN interface")
    records, packets = [], 0
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as stream:
        stream.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        stream.bind(("0.0.0.0", 5353))
        stream.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(interface))
        stream.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP,
                          socket.inet_aton("224.0.0.251") + socket.inet_aton(interface))
        stream.settimeout(0.5)
        queries = set()
        def query(name, kind):
            if (name, kind) not in queries:
                stream.sendto(build_query(name, kind), ("224.0.0.251", 5353))
                queries.add((name, kind))
        for kind in [MOBDEV2_SERVICE_NAME, REMOTEPAIRING_SERVICE_NAME]:
            query(kind, QTYPE_PTR)
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                data, _ = stream.recvfrom(65535)
            except socket.timeout:
                continue
            packets += 1
            for record in parse_mdns_message(data):
                if record.get("ttl", 0) > 0 and record not in records:
                    records.append(record)
                # Some responses omit additional SRV/TXT/A records. Resolve them
                # explicitly instead of treating a partial DNS answer as offline.
                if record.get("type") == 12 and any(kind in record.get("ptrdname", "") for kind in [MOBDEV2_SERVICE_NAME, REMOTEPAIRING_SERVICE_NAME]):
                    query(record["ptrdname"], 33)
                    query(record["ptrdname"], 16)
                if record.get("type") == 33 and any(kind in record["name"] for kind in [MOBDEV2_SERVICE_NAME, REMOTEPAIRING_SERVICE_NAME]):
                    query(record["target"], 1)
    endpoints = []
    matched_adverts = 0
    for record in records:
        if record.get("type") != 16 or REMOTEPAIRING_SERVICE_NAME not in record["name"]:
            continue
        props = record.get("txt", {})
        if not props.get("identifier") or not props.get("authTag"):
            continue
        if not validate_auth_tag(peer_irk, props["identifier"], props["authTag"]):
            continue
        matched_adverts += 1
        for srv in records:
            if srv.get("type") != 33 or srv["name"] != record["name"]:
                continue
            for address in records:
                if address.get("type") != 1 or address["name"] != srv.get("target"):
                    continue
                ip = ipaddress.IPv4Address(address["address"])
                if not ip.is_private or ip.is_loopback or ip not in network:
                    continue
                endpoint = {"address": str(ip), "remote_port": srv["port"], "lockdown_port": 62078,
                            "anonymous_id": expected, "interface": interface,
                            "local_network": str(network),
                            "discovered_utc": datetime.now(timezone.utc).isoformat(),
                            "auth_tag_matches": True, "identity_verification": "pair-verify required at use"}
                if not any(e["address"] == endpoint["address"] and e["remote_port"] == endpoint["remote_port"] for e in endpoints):
                    endpoints.append(endpoint)
    return {"utc": datetime.now(timezone.utc).isoformat(), "mdns_packets": packets,
            "matched_remote_adverts": matched_adverts,
            "paired_target_endpoints": endpoints, "settings_changed": False, "memory_capture": "NOT_TESTED"}


def load_endpoint(path, expected, reauthenticate_hint=False):
    endpoint = json.loads(Path(path).read_text(encoding="utf-8"))
    if endpoint.get("anonymous_id") != expected or endpoint.get("auth_tag_matches") is not True:
        raise ValueError("Endpoint does not match the pinned phone")
    address = ipaddress.IPv4Address(endpoint["address"])
    if not address.is_private or address.is_loopback or address not in ipaddress.IPv4Network(endpoint["local_network"]):
        raise ValueError("Refuse an endpoint outside the observed private LAN")
    for key in ["remote_port", "lockdown_port"]:
        if type(endpoint[key]) is not int or not 1 <= endpoint[key] <= 65535:
            raise ValueError("Invalid endpoint port")
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(endpoint["discovered_utc"])).total_seconds()
    if age < 0 or (age > 120 and not reauthenticate_hint):
        raise ValueError("Discovery endpoint expired; browse again, do not use old cache")
    if reauthenticate_hint:
        # Retain the original discovery time. A cached locator is not a fresh
        # discovery or memory sample; open_lockdown + remote_rsd must authenticate
        # it again before the new DVT session can produce any accepted sample.
        endpoint["used_locator_hint"] = True
        endpoint["locator_age_seconds"] = age
    return endpoint


async def open_lockdown(endpoint):
    from pymobiledevice3.lockdown import create_using_tcp
    serial, pair = existing_pair(endpoint["anonymous_id"])
    client = await asyncio.wait_for(create_using_tcp(endpoint["address"], port=endpoint["lockdown_port"],
                                     autopair=False, pair_record=pair), timeout=5)
    if not client.paired or fingerprint(client.udid) != endpoint["anonymous_id"]:
        await client.close()
        raise RuntimeError("Wi-Fi lockdown identity/pairing mismatch")
    return serial, client


@asynccontextmanager
async def remote_rsd(endpoint, protocol="tcp"):
    from pymobiledevice3.remote import tunnel_service
    from pymobiledevice3.remote.userspace_tunnel import UserspaceDialPlane, UserspaceTun
    from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
    serial, _ = existing_pair(endpoint["anonymous_id"])
    if tunnel_service.USE_USERSPACE_TUNNEL:
        raise RuntimeError("One userspace tunnel per process")
    try:
        async with AsyncExitStack() as stack:
            provider = await tunnel_service.create_core_device_tunnel_service_using_remotepairing(
                serial, endpoint["address"], endpoint["remote_port"], autopair=False)
            stack.push_async_callback(provider.close)
            # Upstream's documented factory flag, also used by UserspaceRsdTunnel.
            # It affects this process only; no monkeypatch or kernel adapter.
            tunnel_service.USE_USERSPACE_TUNNEL = True
            # This investigation's iOS 18.3.1 rejected QUIC. The prepared Python
            # 3.14 venv uses native TLS-PSK for TCP, without the broken 3.12 DLL.
            if protocol not in ("tcp", "quic"):
                raise ValueError("Unsupported remote tunnel protocol")
            channel = provider.start_quic_tunnel() if protocol == "quic" else provider.start_tcp_tunnel()
            result = await stack.enter_async_context(channel)
            if not isinstance(result.client.tun, UserspaceTun):
                raise RuntimeError("Refuse a kernel tunnel")
            result.client.tun.set_peer(result.address)
            plane = await stack.enter_async_context(UserspaceDialPlane(result.client.tun, result.address))
            rsd = RemoteServiceDiscoveryService((result.address, result.port), open_connection=plane.dial,
                                                 auxiliary_metadata=result.auxiliary_metadata)
            stack.push_async_callback(rsd.close)
            await rsd.connect()
            yield rsd
    finally:
        tunnel_service.USE_USERSPACE_TUNNEL = False


def main():
    import importlib.metadata
    from pmd3_probe import ROOT, write_json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-context", required=True)
    parser.add_argument("--lan-config", required=True, help="Saved physical IPv4 LAN interface JSON")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    if importlib.metadata.version("pymobiledevice3") != "11.40.0":
        parser.error("Use existing verified 11.40.0 venv")
    paths = [Path(p).resolve(strict=True) for p in [args.device_context, args.lan_config]]
    for path in paths:
        path.relative_to((ROOT / ".local").resolve())
    expected = json.loads(paths[0].read_text(encoding="utf-8"))["device"]["anonymous_id"]
    lan = json.loads(paths[1].read_text(encoding="utf-8-sig"))
    interface = lan["IPAddress"]
    out = Path(args.out).resolve()
    out.relative_to((ROOT / ".local").resolve())
    out.mkdir(parents=True, exist_ok=False)
    result = discover(interface, expected, lan["PrefixLength"])
    write_json(out / "discovery.private.json", result)
    if len(result["paired_target_endpoints"]) == 1:
        write_json(out / "endpoint.private.json", result["paired_target_endpoints"][0])
    print(json.dumps({"mdns_packets": result["mdns_packets"], "matched_endpoints": len(result["paired_target_endpoints"]),
                      "memory_capture": "NOT_TESTED"}))


if __name__ == "__main__":
    main()

