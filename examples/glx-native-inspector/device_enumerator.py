"""One explicitly approved USB metadata enumeration. No default device, auto-pair, attach or JS."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re

from enumeration import RecordedMetadataMixin, await_or_disabled_once, close_once, collect, handshake_once


def validate_selector(value):
    if not re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{8}-[0-9a-fA-F]{16})", value):
        raise ValueError("Invalid single private device selector")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approved-metadata-only", action="store_true")
    parser.add_argument("--udid-file", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.approved_metadata_only:
        parser.error("Explicit human authorization required; no private input opened")
    if not args.udid_file.is_absolute() or not args.out.is_absolute() or args.out.exists():
        parser.error("Absolute selector/output required; output must be new")
    # Real library is not imported on help, refusal or fake-test paths.
    try:
        expected = validate_selector(args.udid_file.read_text(encoding="utf-8-sig").removesuffix("\n").removesuffix("\r"))
    except ValueError:
        parser.error("Invalid private target input")
    from importlib.metadata import version, distribution
    if version("pymobiledevice3") != "11.40.0":
        parser.error("Unexpected library version; no device connection")
    installed = distribution("pymobiledevice3")
    for name, expected_hash in {
        "cli/webinspector.py": "1c18914c536369a35ed5392ff716e2a740e94be74f164b047e1085fb0c7031df",
        "services/webinspector.py": "f25dcacf7e0ce423ae6e779aff8ee52da3ead23fef23fe4c5e70f5da784a692d",
    }.items():
        if hashlib.sha256(Path(installed.locate_file("pymobiledevice3/" + name)).read_bytes()).hexdigest() != expected_hash:
            parser.error("Installed source differs; no device connection")
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.lockdown_service import LockdownService
    from pymobiledevice3.services.webinspector import WebinspectorService

    class MetadataOnlyInspector(RecordedMetadataMixin, WebinspectorService):
        def __init__(self, provider, record):
            self.response_record = record
            super().__init__(provider)

        async def _handshake(self, disabled_task):
            return await handshake_once(self, disabled_task, lambda: LockdownService.connect(self))

        async def _await_or_raise_disabled(self, coro, disabled_task):
            return await await_or_disabled_once(coro, disabled_task)

        async def _recv_message(self):
            return await self.service.recv_plist()  # no upstream EOF retry loop

        async def close(self):
            return await close_once(self, lambda: LockdownService.close(self))

    # Exclusive-create BEFORE contacting device; fail closed on an existing result.
    with args.out.open("x", encoding="utf-8") as output:
        result = asyncio.run(collect(expected, create_using_usbmux, MetadataOnlyInspector))
        json.dump(result, output, ensure_ascii=False, indent=2)
    print(json.dumps({"outcome": result["outcome"], "session": "UNKNOWN", "phoneJsExecuted": False}))


if __name__ == "__main__":
    main()
