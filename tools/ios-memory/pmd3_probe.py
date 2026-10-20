"""Read-only local iOS process capture; requires the verified pymobiledevice3 venv.

No pairing, Developer Mode change, DDI mount, app control, kernel tunnel or upload.
One pinned iPhone, one userspace tunnel, one Sysmontap owner. All results stay .local. The bundled device profile is intentionally narrow.
"""
import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import math
import subprocess
import sys
import time
from contextlib import suppress
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ("pid", "name", "comm", "ppid", "responsiblePID", "coalitionID", "uniqueID",
          "startAbsTime", "timestamp", "physFootprint", "memResidentSize", "memVirtualSize",
          "memCompressed", "memRPrvt", "memRShrd", "cpuUsage", "cpuTotalUser", "cpuTotalSystem")
MEMORY = ("physFootprint", "memResidentSize", "memVirtualSize", "memCompressed", "memRPrvt", "memRShrd")


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def relevant(process):
    return "wechat" in str(process.get("name", "")).lower() or "webcontent" in str(process.get("name", "")).lower()


def anonymous_id(serial):
    return hashlib.sha256(serial.encode()).hexdigest()[:16]


def select_transport_device(devices, transport, expected_id=None):
    """Reject USB fallback and other phones in a Wi-Fi acceptance run."""
    if transport == "wifi-usbmux":
        if not expected_id:
            raise RuntimeError("Wi-Fi requires an identity pinned by an earlier wired context")
        matching = [device for device in devices if anonymous_id(device.serial) == expected_id]
        if any(device.is_usb for device in matching):
            raise RuntimeError("Target USB is still present; Wi-Fi-only validation requires unplugging it")
        candidates = [device for device in matching if device.is_network]
        if len(candidates) != 1:
            raise RuntimeError("Pinned phone is not uniquely discovered as Network; offline is expected away from LAN")
    else:
        candidates = [device for device in devices if device.is_usb]
        if len(candidates) != 1:
            raise RuntimeError("Expected exactly one USB iPhone")
        if expected_id and anonymous_id(candidates[0].serial) != expected_id:
            raise RuntimeError("USB phone differs from the pinned device")
    return candidates[0]


def decode(row, attributes):
    result = []
    for pid, values in row.get("Processes", {}).items():
        if len(values) != len(attributes):
            raise ValueError("Device value/attribute count differs")
        process = dict(zip(attributes, values))
        if "pid" in process and int(process["pid"]) != int(pid):
            raise ValueError("PID field differs from native process map key")
        process["pid"] = int(pid)
        if relevant(process):
            result.append({key: process[key] for key in FIELDS if key in process})
    return result


def analyze(rows):
    stats = {}
    for row in rows:
        for process in row["processes"]:
            key = str(process["pid"])
            slot = stats.setdefault(key, {"pid": process["pid"], "name": process.get("name"), "samples": 0,
                                          "first_ms": row["elapsed_ms"], "last_ms": row["elapsed_ms"], "fields": {}})
            slot["samples"] += 1
            slot["last_ms"] = row["elapsed_ms"]
            for name in MEMORY + ("cpuUsage",):
                value = process.get(name)
                if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                    continue
                item = slot["fields"].setdefault(name, {"count": 0, "first": value, "last": value,
                                                       "min": value, "max": value, "first_ms": row["elapsed_ms"],
                                                       "last_ms": row["elapsed_ms"]})
                item.update(count=item["count"] + 1, last=value, min=min(item["min"], value), max=max(item["max"], value),
                            last_ms=row["elapsed_ms"])
    valid = [s for s in stats.values() if s["samples"] >= 20 and s["last_ms"] - s["first_ms"] >= 60000
             and s["fields"].get("physFootprint", {}).get("min", 0) > 0
             and s["fields"]["physFootprint"]["count"] >= 20
             and s["fields"]["physFootprint"]["last_ms"]-s["fields"]["physFootprint"]["first_ms"] >= 60000
             and s["fields"]["physFootprint"]["max"] > s["fields"]["physFootprint"]["min"]]
    return {"processes": list(stats.values()), "valid_varying_memory_pids": [s["pid"] for s in valid],
            "has_minute_of_varying_memory": bool(valid), "game_pid_attribution": "requires before/after action evidence",
            "complete_game_flow": "NOT_TESTED", "physical_total": "NOT_CLAIMED"}


async def collect(args, out):
    from pymobiledevice3 import usbmux
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.installation_proxy import InstallationProxyService
    from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel
    from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
    from pymobiledevice3.services.dvt.instruments.device_info import DeviceInfo
    from pymobiledevice3.services.dvt.instruments.sysmontap import Sysmontap
    from pymobiledevice3.services.dvt.instruments.graphics import Graphics
    from pymobiledevice3.services.dvt.instruments.screenshot import Screenshot

    args.failure_stage = "device-discovery"
    endpoint = None
    if args.transport == "wifi-remote":
        from wifi_lan import load_endpoint, open_lockdown, remote_rsd
        endpoint = load_endpoint(args.wifi_endpoint, args.expected_id, args.wifi_reauthenticate_hint)
        if any(device.is_usb and anonymous_id(device.serial) == args.expected_id for device in await usbmux.list_devices()):
            raise RuntimeError("USB still present; refuse Wi-Fi acceptance")
        args.failure_stage = "wifi-lockdown-pairing-and-device-check"
        serial, lockdown = await open_lockdown(endpoint)
        device = SimpleNamespace(connection_type="Wi-Fi TCP; authenticated RemotePairing")
    else:
        device = select_transport_device(await usbmux.list_devices(), args.transport, args.expected_id)
        serial = device.serial
        args.failure_stage = "lockdown-pairing-and-device-check"
        lockdown = await create_using_usbmux(serial=serial, autopair=False)
    try:
        if not lockdown.paired:
            raise RuntimeError("Not paired; user action required")
        if lockdown.product_type != "iPhone17,1" or lockdown.product_version != "18.3.1":
            raise RuntimeError("Device differs from this investigation's iPhone/iOS")
        if not await lockdown.get_developer_mode_status():
            raise RuntimeError("Developer Mode off; user action required")
        metadata = {"schema": 1, "device": {"model": lockdown.product_type, "ios": lockdown.product_version,
                   "anonymous_id": anonymous_id(serial)},
                    "actual_mode": args.actual_mode, "mode_verified": args.actual_mode != "unknown",
                    "mode_source": "operator observation" if args.actual_mode != "unknown" else "not observed",
                    "pymobiledevice3": importlib.metadata.version("pymobiledevice3"),
                    "python": sys.version.split()[0], "transport": {"usb": "USB", "wifi-usbmux": "Wi-Fi Network via existing usbmux", "wifi-remote": "Wi-Fi TCP RemotePairing via observed physical LAN"}[args.transport] + " userspace; no kernel tunnel",
                    "connection_type": device.connection_type, "reconnect_policy": "none; a new run is required after loss",
                    "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                    "capture_script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    "start_utc": datetime.now(timezone.utc).isoformat(),
                    "field_units": {key: "bytes (vendor CLI _BYTE_FIELDS)" for key in MEMORY},
                    "field_scope": {"physFootprint": "process physical footprint accounting, not whole-device RAM",
                                    "memResidentSize": "resident set; different accounting from physFootprint",
                                    "memVirtualSize": "virtual address space; not physical usage"},
                    "boundary": "No memory fields or process values are added; no game attribution by size"}
        if args.pck:
            package = Path(args.pck).resolve(strict=True)
            package.relative_to((ROOT / ".local").resolve())
            metadata["package"] = {"file": str(package.relative_to(ROOT)), "bytes": package.stat().st_size,
                                   "sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
                                   "phone_identity": "operator opens existing preview; not remotely attested"}
        if endpoint:
            metadata["discovery_utc"] = endpoint["discovered_utc"]
            metadata["used_locator_hint"] = endpoint.get("used_locator_hint", False)
            metadata["locator_age_seconds"] = endpoint.get("locator_age_seconds")
            metadata["wifi_protocol"] = args.wifi_protocol
            metadata["wifi_transport_helper_sha256"] = hashlib.sha256((ROOT / "tools/ios-memory/wifi_lan.py").read_bytes()).hexdigest()
        args.failure_stage = "installation-proxy-version-metadata"
        try:
            async with InstallationProxyService(lockdown) as proxy:
                app = (await proxy.lookup({"BundleIDs": ["com.tencent.xin"],
                              "ReturnAttributes": ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"]}) or {}).get("com.tencent.xin", {})
                metadata["wechat"] = {key: app.get(key) for key in ("CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion")}
        except Exception as error:
            if args.transport == "usb":
                raise
            metadata["wechat"] = {"live_version_verified": False, "error_type": type(error).__name__,
                                   "error": str(error), "source": "Wi-Fi InstallationProxy unavailable; not a DVT sample"}
            if args.device_context:
                prior = json.loads(Path(args.device_context).read_text(encoding="utf-8"))
                metadata["last_wired_wechat"] = {"value": prior.get("wechat"), "captured_utc": prior.get("start_utc"),
                                                "current_wifi_version_verified": False}
        write_json(out / "context.private.json", metadata)
    finally:
        await lockdown.close()

    rows = []
    summary = {"capture_complete": False, "cleanup_confirmed": False, "screenshots": []}
    graphics_status = {"scope": "whole display Core Animation FPS; not game renderer FPS", "samples": 0}

    async def collect_fps(dvt, start):
        try:
            async with Graphics(dvt) as graphics:
                with (out / "display-fps.private.jsonl").open("w", encoding="utf-8") as file:
                    async for fps in graphics.fps():
                        file.write(json.dumps({"elapsed_ms": round((time.monotonic()-start)*1000),
                                               "display_core_animation_fps": fps}) + "\n")
                        file.flush()
                        graphics_status["samples"] += 1
        except Exception as error:
            graphics_status.update(error_type=type(error).__name__, error=str(error))
    try:
        # Explicitly prevent remote pairing fallback; never replace an existing proxy.
        args.failure_stage = "userspace-remotepairing-tunnel" if endpoint else "userspace-coredevice-tunnel"
        handle = remote_rsd(endpoint, args.wifi_protocol) if endpoint else UserspaceRsdTunnel(serial=serial, autopair=False, remotepairing_fallback=False)
        async with handle as rsd:
            if args.transport == "wifi-usbmux":
                # UserspaceRsdTunnel selects usbmux by serial. Check on both sides of
                # establishment so a USB-preferred connection cannot pass as Wi-Fi.
                select_transport_device(await usbmux.list_devices(), args.transport, args.expected_id)
                metadata["wifi_no_usb_at_tunnel_start"] = True
            elif args.transport == "wifi-remote":
                if any(device.is_usb and anonymous_id(device.serial) == args.expected_id for device in await usbmux.list_devices()):
                    raise RuntimeError("USB present at tunnel start; refuse Wi-Fi acceptance")
                metadata["wifi_no_usb_at_tunnel_start"] = True
            args.failure_stage = "dvt-process-list"
            async with DvtProvider(rsd) as dvt:
                async with DeviceInfo(dvt) as info:
                    before = await info.proclist()
                write_json(out / "processes-before.private.json", [p for p in before if relevant(p)])
                sysmon = await Sysmontap.create(dvt, interval=500)
                metadata["process_attributes"] = list(sysmon.process_attributes_cls.__dataclass_fields__)
                write_json(out / "context.private.json", metadata)
                async with sysmon:
                    args.failure_stage = "sysmontap-samples"
                    start = time.monotonic()
                    summary["clock_origin_monotonic_ms"] = round(start * 1000)
                    write_json(out / "ready.private.json", {"ready": True, "duration_seconds": args.seconds,
                                                           "game_screenshots": args.game_screenshots,
                                                           "clock_origin_monotonic_ms": round(start*1000)})
                    print("READY: native Sysmontap active", flush=True)
                    iterator = aiter(sysmon)
                    fps_task = asyncio.create_task(collect_fps(dvt, start)) if args.display_fps else None
                    try:
                      with (out / "samples.private.jsonl").open("w", encoding="utf-8") as file:
                        while (remaining := args.seconds - (time.monotonic() - start)) > 0:
                            request = out / "screenshot.request.private.json"
                            if args.game_screenshots and request.exists():
                                shot_request = json.loads(request.read_text(encoding="utf-8"))
                                request.unlink()
                                phase = shot_request.get("phase")
                                if phase not in ("lobby", "loading", "driving", "results", "restart"):
                                    raise ValueError("Screenshot must be requested for a reported game phase")
                                record = {"phase": phase, "requested": shot_request, "start_ms": round((time.monotonic()-start)*1000)}
                                try:
                                    async with Screenshot(dvt) as screen:
                                        pixels = await asyncio.wait_for(screen.get_screenshot(), timeout=5)
                                    extension = ".png" if pixels.startswith(b"\x89PNG") else ".jpg" if pixels.startswith(b"\xff\xd8") else None
                                    if extension is None:
                                        raise ValueError("Unrecognized screenshot format")
                                    name = f'screen-{record["start_ms"]}-{phase}.private{extension}'
                                    (out / name).write_bytes(pixels)
                                    record["file"] = name
                                except Exception as error:
                                    record.update(error_type=type(error).__name__, error=str(error))
                                record["end_ms"] = round((time.monotonic()-start)*1000)
                                summary["screenshots"].append(record)
                                write_json(out / "screenshots.private.json", summary["screenshots"])
                            if (out / "stop.request.private.json").exists():
                                summary["stop_reason"] = "operator requested; short captures remain unvalidated"
                                break
                            try:
                                row = await asyncio.wait_for(anext(iterator), timeout=min(10, remaining))
                            except asyncio.TimeoutError:
                                if remaining > 11:
                                    raise RuntimeError("No native sample for 10 seconds") from None
                                break
                            if "Processes" not in row:
                                continue
                            entry = {"elapsed_ms": round((time.monotonic() - start) * 1000),
                                     "received_utc": datetime.now(timezone.utc).isoformat(),
                                     "processes": decode(row, metadata["process_attributes"])}
                            rows.append(entry)
                            file.write(json.dumps(entry, ensure_ascii=False) + "\n")
                            file.flush()
                    finally:
                        if fps_task:
                            fps_task.cancel()
                            with suppress(asyncio.CancelledError):
                                await fps_task
                args.failure_stage = "final-process-list"
                async with DeviceInfo(dvt) as info:
                    after = await info.proclist()
                write_json(out / "processes-after.private.json", [p for p in after if relevant(p)])
            args.failure_stage = "tunnel-cleanup"
        summary.update(analyze(rows), capture_complete=True, cleanup_confirmed=True)
    except BaseException as error:
        summary.update(analyze(rows), error_type=type(error).__name__, error=str(error))
        raise
    finally:
        summary["display_fps"] = graphics_status if args.display_fps else "NOT_REQUESTED"
        write_json(out / "summary.private.json", summary)
    print(json.dumps({key: summary[key] for key in ("capture_complete", "cleanup_confirmed", "valid_varying_memory_pids")}), flush=True)
    if not summary["has_minute_of_varying_memory"]:
        raise SystemExit(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["capture", "mark", "screenshot", "stop", "analyze"])
    parser.add_argument("--out", required=True)
    parser.add_argument("--seconds", type=int, default=65)
    parser.add_argument("--transport", choices=["usb", "wifi-usbmux", "wifi-remote"], default="usb")
    parser.add_argument("--device-context", help="Earlier wired context.private.json; pins identity without a UDID argument")
    parser.add_argument("--wifi-endpoint", help="Fresh authenticated local discovery endpoint; wifi-remote only")
    parser.add_argument("--wifi-reauthenticate-hint", action="store_true", help="Use an earlier LAN locator only after new lockdown and RemotePairing identity verification; never reuses samples")
    parser.add_argument("--wifi-protocol", choices=["tcp", "quic"], default="tcp", help="Use TCP/native TLS-PSK on the prepared Python 3.14 venv for iOS 18.3.1")
    parser.add_argument("--actual-mode", choices=["unknown", "high-performance", "high-performance-plus"], default="unknown")
    parser.add_argument("--pck", help="Existing private package to hash; does not launch or upload it")
    parser.add_argument("--display-fps", action="store_true", help="Optional whole-display CA FPS in same DVT session")
    parser.add_argument("--game-screenshots", action="store_true", help="Allow explicit game-phase screenshots, local only, in same DVT session")
    parser.add_argument("--phase", choices=["game-closed", "game-opened", "game-exited", "lobby", "loading", "driving", "results", "restart", "warning", "exit"])
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.relative_to((ROOT / ".local").resolve())
    if args.action in ("mark", "screenshot", "stop"):
        if not (out / "ready.private.json").exists() or (out / "summary.private.json").exists():
            parser.error("requires an active run")
        if args.action == "stop":
            write_json(out / "stop.request.private.json", {"requested_utc": datetime.now(timezone.utc).isoformat()})
            return
        if args.action == "screenshot":
            ready = json.loads((out / "ready.private.json").read_text(encoding="utf-8"))
            if not ready.get("game_screenshots") or args.phase not in ("lobby", "loading", "driving", "results", "restart"):
                parser.error("Screenshot requires opt-in and a reported game phase")
            write_json(out / "screenshot.request.private.json", {"phase": args.phase,
                       "monotonic_ms": round(time.monotonic()*1000), "source": "operator reports game visible; screenshot may lag"})
            return
        if not args.phase:
            parser.error("mark requires a phase")
        with (out / "markers.private.jsonl").open("a", encoding="utf-8") as file:
            file.write(json.dumps({"phase": args.phase, "monotonic_ms": round(time.monotonic()*1000),
                                  "utc": datetime.now(timezone.utc).isoformat(), "source": "operator reported; may lag action"}) + "\n")
        return
    if args.action == "analyze":
        write_json(out / "analysis.private.json", analyze([json.loads(s) for s in (out / "samples.private.jsonl").read_text(encoding="utf-8").splitlines()]))
        return
    if importlib.metadata.version("pymobiledevice3") != "11.40.0" or not 60 <= args.seconds <= 900:
        parser.error("Expected verified 11.40.0 and 60..900 seconds")
    args.expected_id = None
    if args.device_context:
        context = Path(args.device_context).resolve(strict=True)
        context.relative_to((ROOT / ".local").resolve())
        prior = json.loads(context.read_text(encoding="utf-8"))
        if prior.get("device", {}).get("model") != "iPhone17,1" or prior["device"].get("ios") != "18.3.1":
            parser.error("Pinned context differs from the investigation's device/iOS")
        args.expected_id = prior["device"]["anonymous_id"]
    if args.transport != "usb" and not args.expected_id:
        parser.error("Wi-Fi requires --device-context from the saved wired capture")
    if args.transport == "wifi-remote":
        if not args.wifi_endpoint:
            parser.error("Wi-Fi RemotePairing requires --wifi-endpoint")
        Path(args.wifi_endpoint).resolve(strict=True).relative_to((ROOT / ".local").resolve())
    out.mkdir(parents=True, exist_ok=False)
    args.failure_stage = "initialization"
    try:
        asyncio.run(asyncio.wait_for(collect(args, out), timeout=args.seconds + 45))
    except Exception as error:
        write_json(out / "failure.private.json", {"utc": datetime.now(timezone.utc).isoformat(),
                   "stage": args.failure_stage, "error_type": type(error).__name__, "error": str(error),
                   "transport": args.transport, "automatic_reconnect": False})
        raise


if __name__ == "__main__":
    main()

