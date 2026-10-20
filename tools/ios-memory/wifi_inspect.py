"""Read-only, identity-pinned Wi-Fi discovery. No pairing or device settings writes.

Run only from the existing pymobiledevice3 11.40.0 venv. Discovery and a paired
lockdown handshake are preparation, never evidence of DVT or memory capture.
"""
import argparse
import asyncio
import importlib.metadata
import json
import plistlib
from datetime import datetime, timezone
from pathlib import Path

from pmd3_probe import ROOT, anonymous_id, write_json


async def inspect(context):
    from pymobiledevice3 import usbmux
    from pymobiledevice3.lockdown import create_using_usbmux, get_mobdev2_lockdowns
    from pymobiledevice3.osu.os_utils import get_os_utils

    expected = context["device"]["anonymous_id"]
    result = {"utc": datetime.now(timezone.utc).isoformat(), "version": "11.40.0",
              "device_anonymous_id": expected, "writes_requested": False,
              "dvt_capture": "NOT_TESTED", "offline_away_from_lan_is_expected": True}
    devices = await usbmux.list_devices()
    targets = [device for device in devices if anonymous_id(device.serial) == expected]
    result["usbmux_matching_connection_types"] = [device.connection_type for device in targets]
    serials = {device.serial for device in targets}
    # Read only the requested phone's pairing metadata. Do not copy certificates,
    # HostID, keys, UDID, MAC or the pairing records into the output.
    utils = get_os_utils()
    folders = [utils.get_home_folder_path(), utils.pair_record_path]
    pair_metadata = []
    for folder in folders:
        if not folder.is_dir():
            continue
        for file in folder.glob("*.plist"):
            if anonymous_id(file.stem) != expected:
                continue
            serials.add(file.stem)
            try:
                record = plistlib.loads(file.read_bytes())
                pair_metadata.append({"source": "system" if folder == utils.pair_record_path else "pmd3",
                                      "host_identity_present": "HostID" in record,
                                      "wifi_mac_present": "WiFiMACAddress" in record})
            except (OSError, plistlib.InvalidFileException) as error:
                pair_metadata.append({"error_type": type(error).__name__})
    result["pair_record_metadata"] = pair_metadata
    if len(serials) != 1:
        result["discovery"] = "No unique pinned serial available; use USB when the user returns"
        return result
    serial = next(iter(serials))
    remote_file = folders[0] / f"remote_{serial}.plist"
    result["remote_pair_record_present"] = remote_file.exists()
    if remote_file.exists():
        try:
            remote = plistlib.loads(remote_file.read_bytes())
            result["remote_pair_altIRK_present"] = "peer_alt_irk" in remote
        except (OSError, plistlib.InvalidFileException) as error:
            result["remote_pair_record_error_type"] = type(error).__name__
    if targets:
        try:
            lockdown = await create_using_usbmux(serial=serial, autopair=False)
            try:
                if anonymous_id(lockdown.udid) != expected:
                    raise RuntimeError("Lockdown identity mismatch")
                result["paired"] = lockdown.paired
                result["model"] = lockdown.product_type
                result["ios"] = lockdown.product_version
                if lockdown.paired:
                    result["enable_wifi_connections"] = await lockdown.get_enable_wifi_connections()
                    result["developer_mode"] = await lockdown.get_developer_mode_status()
            finally:
                await lockdown.close()
        except Exception as error:
            result["lockdown_read_error"] = {"type": type(error).__name__, "message": str(error)}
    found = []
    async def browse():
        iterator = get_mobdev2_lockdowns(udid=serial, only_paired=True, timeout=3)
        try:
            async for address, lockdown in iterator:
                try:
                    if anonymous_id(lockdown.udid) != expected:
                        raise RuntimeError("Bonjour identity mismatch")
                    found.append({"paired": lockdown.paired, "model": lockdown.product_type,
                                  "ios": lockdown.product_version})
                finally:
                    await lockdown.close()
        finally:
            await iterator.aclose()
    try:
        await asyncio.wait_for(browse(), timeout=12)
    except Exception as error:
        result["bonjour_error"] = {"type": type(error).__name__, "message": str(error)}
    result["bonjour_paired_target_matches"] = found
    result["discovery"] = "paired target found" if found else "target not discovered now; not a memory-capture failure"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-context", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    if importlib.metadata.version("pymobiledevice3") != "11.40.0":
        parser.error("Use the existing verified 11.40.0 venv")
    context_file = Path(args.device_context).resolve(strict=True)
    context_file.relative_to((ROOT / ".local").resolve())
    context = json.loads(context_file.read_text(encoding="utf-8"))
    if context.get("device", {}).get("model") != "iPhone17,1" or context["device"].get("ios") != "18.3.1":
        parser.error("Wrong investigation device/iOS")
    out = Path(args.out).resolve()
    out.relative_to((ROOT / ".local").resolve())
    out.mkdir(parents=True, exist_ok=False)
    try:
        result = asyncio.run(asyncio.wait_for(inspect(context), timeout=22))
    except Exception as error:
        result = {"utc": datetime.now(timezone.utc).isoformat(), "stage": "read-only-preflight",
                  "error_type": type(error).__name__, "error": str(error), "dvt_capture": "NOT_TESTED"}
        write_json(out / "inspection.private.json", result)
        raise
    write_json(out / "inspection.private.json", result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

