"""Offline evidence guards; these tests never open a device connection."""
import importlib.util
import unittest
import tempfile
import json
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("probe", Path(__file__).resolve().parents[1] / "tools/ios-memory/pmd3_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
wifi_spec = importlib.util.spec_from_file_location("wifi_lan", Path(__file__).resolve().parents[1] / "tools/ios-memory/wifi_lan.py")
wifi = importlib.util.module_from_spec(wifi_spec)
wifi_spec.loader.exec_module(wifi)


class ProbeTests(unittest.TestCase):
    def test_wifi_endpoint_rejects_stale_other_device_and_external_network(self):
        endpoint = {"anonymous_id": "target", "auth_tag_matches": True,
                    "discovered_utc": datetime.now(timezone.utc).isoformat(),
                    "address": "192.168.1.10", "local_network": "192.168.1.0/24",
                    "remote_port": 1234, "lockdown_port": 62078}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "endpoint.json"
            path.write_text(json.dumps(endpoint))
            self.assertEqual(wifi.load_endpoint(path, "target")["address"], endpoint["address"])
            cases = [{"anonymous_id": "other"}, {"auth_tag_matches": False},
                     {"discovered_utc": (datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat()},
                     {"address": "8.8.8.8"}, {"address": "192.168.2.10"}, {"remote_port": 0}]
            for change in cases:
                path.write_text(json.dumps(dict(endpoint, **change)))
                with self.assertRaises(ValueError):
                    wifi.load_endpoint(path, "target")
            earlier = dict(endpoint, discovered_utc=(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat())
            path.write_text(json.dumps(earlier))
            hinted = wifi.load_endpoint(path, "target", reauthenticate_hint=True)
            self.assertTrue(hinted["used_locator_hint"])
            self.assertEqual(hinted["discovered_utc"], earlier["discovered_utc"])
            self.assertGreater(hinted["locator_age_seconds"], 120)
            path.write_text(json.dumps(dict(earlier, address="8.8.8.8")))
            with self.assertRaises(ValueError):
                wifi.load_endpoint(path, "target", reauthenticate_hint=True)

    def device(self, serial, connection_type):
        return SimpleNamespace(serial=serial, connection_type=connection_type,
                               is_usb=connection_type == "USB", is_network=connection_type == "Network")

    def test_wifi_requires_pinned_device_and_rejects_usb_fallback(self):
        phone = self.device("target", "Network")
        expected = probe.anonymous_id("target")
        self.assertIs(probe.select_transport_device([phone], "wifi-usbmux", expected), phone)
        for devices, identity in [([phone], None), ([], expected),
                                  ([self.device("other", "Network")], expected),
                                  ([phone, self.device("target", "USB")], expected),
                                  ([phone, phone], expected)]:
            with self.assertRaises(RuntimeError):
                probe.select_transport_device(devices, "wifi-usbmux", identity)

    def test_usb_default_is_retained_and_never_chooses_network(self):
        phone = self.device("target", "USB")
        self.assertIs(probe.select_transport_device([self.device("other", "Network"), phone], "usb"), phone)
        for devices, identity in [([self.device("target", "Network")], None),
                                  ([phone], probe.anonymous_id("other")),
                                  ([phone, self.device("other", "USB")], None)]:
            with self.assertRaises(RuntimeError):
                probe.select_transport_device(devices, "usb", identity)

    def test_native_pid_is_preserved_and_mismatches_fail(self):
        row = {"Processes": {17: ["com.apple.WebKit.WebContent", 1024]}}
        self.assertEqual(probe.decode(row, ["name", "physFootprint"])[0]["pid"], 17)
        with self.assertRaises(ValueError):
            probe.decode({"Processes": {17: [18, "WeChat"]}}, ["pid", "name"])
        with self.assertRaises(ValueError):
            probe.decode(row, ["name"])

    def test_all_candidates_are_retained_without_size_selection(self):
        result = probe.decode({"Processes": {1: ["WeChat", 100], 2: ["com.apple.WebKit.WebContent", 10],
                                             3: ["com.apple.WebKit.WebContent", 9999], 4: ["Other", 99999]}},
                              ["name", "physFootprint"])
        self.assertEqual([x["pid"] for x in result], [1, 2, 3])

    def rows(self, value):
        return [{"elapsed_ms": i*1000, "processes": [{"pid": 17, "name": "WeChat", "physFootprint": value(i),
                  "memResidentSize": 200, "memVirtualSize": 999999999999}]} for i in range(61)]

    def test_empty_zero_constant_and_virtual_only_never_pass(self):
        self.assertFalse(probe.analyze([])["has_minute_of_varying_memory"])
        for value in (lambda _: 0, lambda _: 100):
            self.assertFalse(probe.analyze(self.rows(value))["has_minute_of_varying_memory"])
        rows = self.rows(lambda i: i+1)
        for row in rows:
            del row["processes"][0]["physFootprint"]
        self.assertFalse(probe.analyze(rows)["has_minute_of_varying_memory"])
        sparse = self.rows(lambda i: i+1)
        for row in sparse[1:-1]:
            del row["processes"][0]["physFootprint"]
        self.assertFalse(probe.analyze(sparse)["has_minute_of_varying_memory"])

    def test_fields_are_separate_and_transport_success_is_not_game_acceptance(self):
        summary = probe.analyze(self.rows(lambda i: 100+i))
        self.assertTrue(summary["has_minute_of_varying_memory"])
        self.assertEqual(summary["processes"][0]["fields"]["physFootprint"]["max"], 160)
        self.assertEqual(summary["processes"][0]["fields"]["memResidentSize"]["max"], 200)
        self.assertEqual(summary["complete_game_flow"], "NOT_TESTED")
        self.assertEqual(summary["physical_total"], "NOT_CLAIMED")



    def test_short_capture_and_invalid_numbers_do_not_pass(self):
        self.assertFalse(probe.analyze(self.rows(lambda i: 100+i)[:46])["has_minute_of_varying_memory"])
        for value in [True, float("nan"), float("inf")]:
            self.assertFalse(probe.analyze(self.rows(lambda i: value))["has_minute_of_varying_memory"])

    def test_stop_and_screenshot_requests_do_not_connect_to_phone(self):
        private_root = Path(__file__).resolve().parents[1] / ".local"
        private_root.mkdir(exist_ok=True)
        script = private_root.parent / "tools/ios-memory/pmd3_probe.py"
        with tempfile.TemporaryDirectory(dir=private_root) as temporary:
            folder = Path(temporary)
            (folder / "ready.private.json").write_text(json.dumps({"ready": True, "game_screenshots": False}))
            stopped = subprocess.run([sys.executable, str(script), "stop", "--out", str(folder)], capture_output=True)
            self.assertEqual(stopped.returncode, 0, stopped.stderr)
            self.assertTrue((folder / "stop.request.private.json").exists())
            shot = subprocess.run([sys.executable, str(script), "screenshot", "--out", str(folder), "--phase", "lobby"], capture_output=True)
            self.assertNotEqual(shot.returncode, 0)
            self.assertFalse((folder / "screenshot.request.private.json").exists())
            (folder / "summary.private.json").write_text("{}")
            self.assertNotEqual(subprocess.run([sys.executable, str(script), "stop", "--out", str(folder)], capture_output=True).returncode, 0)

    def test_export_keeps_pid_metric_and_missing_batch_separate(self):
        private_root = Path(__file__).resolve().parents[1] / ".local"
        private_root.mkdir(exist_ok=True)
        script = private_root.parent / "tools/ios-memory/export.py"
        with tempfile.TemporaryDirectory(dir=private_root) as temporary:
            folder = Path(temporary) / "run"
            folder.mkdir()
            (folder / "summary.private.json").write_text(json.dumps({"clock_origin_monotonic_ms": 10000, "capture_complete": False, "cleanup_confirmed": False}))
            (folder / "context.private.json").write_text(json.dumps({"actual_mode": "unknown"}))
            (folder / "processes-before.private.json").write_text("[]")
            rows = [{"elapsed_ms": 0, "processes": [{"pid": 1, "name": "</script><script>bad()</script>", "physFootprint": 1048576, "memVirtualSize": 9999999}]},
                    {"elapsed_ms": 500, "processes": []},
                    {"elapsed_ms": 1000, "processes": [{"pid": 1, "name": "WebContent", "physFootprint": 2097152}, {"pid": 2, "name": "WeChat", "physFootprint": 50}]}]
            (folder / "samples.private.jsonl").write_text("\n".join(map(json.dumps, rows)))
            out = Path(temporary) / "export"
            result = subprocess.run([sys.executable, str(script), "--runs", str(folder), "--out", str(out)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads((out / "index.private.json").read_text())
            self.assertEqual(len(payload["series"]), 2)
            self.assertEqual([p[-1] for p in payload["series"][0]["points"]], [0, 2])
            self.assertIsNone(payload["series"][0]["points"][1][2])
            self.assertFalse(payload["runs"][0]["complete"])
            self.assertNotIn("</script><script>bad()", (out / "memory.private.html").read_text())
            self.assertNotEqual(subprocess.run([sys.executable, str(script), "--runs", str(folder), "--out", str(out)], capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()

