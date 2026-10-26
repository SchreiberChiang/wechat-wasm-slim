"""Only self-authored fakes and owned Python children. No device package, selector or connection."""
import asyncio
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace as Obj
import unittest

from enumeration import (APP_LIST, LISTING, CONNECTED, DISCONNECTED, GET_APPS, GET_LISTING,
                         MetadataSelectorBlocked, RecordedMetadataMixin, ResponseRecord,
                         ObservationWindowEnded, await_or_disabled_once, close_once, collect, handshake_once)
from device_enumerator import validate_selector
from launch_once import run_owned


WX = {"WIRApplicationIdentifierKey": "fake-wx", "WIRApplicationBundleIdentifierKey": "com.tencent.xin"}
OTHER = {"WIRApplicationIdentifierKey": "fake-other", "WIRApplicationBundleIdentifierKey": "com.example.other"}


def apps(*values):
    return {"__selector": APP_LIST, "__argument": {"WIRApplicationDictionaryKey": {
        value["WIRApplicationIdentifierKey"]: dict(value) for value in values}}}


def listing(key="fake-wx", count=0):
    return {"__selector": LISTING, "__argument": {"WIRApplicationIdentifierKey": key, "WIRListingKey": {
        str(i): {"WIRPageIdentifierKey": i, "WIRTypeKey": "WIRTypeJavaScript"} for i in range(count)}}}


class FakeBase:
    """Tiny protocol fake, including upstream's automatic listing sends and cache replacement."""
    def __init__(self, provider, record, mode):
        self.response_record, self.mode = record, mode
        self._recv_task, self._connection_lost = None, False
        self.application_pages = {}
        self.incoming = asyncio.Queue()
        self.calls, self.sent_selectors = provider.calls, []

    async def connect(self):
        self.calls.append("connect")
        if self.mode == "connect-timeout":
            await asyncio.sleep(10)
        if self.mode == "handshake-list":
            await self._handle_recv(apps(WX))
        self._recv_task = asyncio.create_task(self.receive())
        if self.mode == "pre-query-drop":
            await self.incoming.put("drop")
            await asyncio.sleep(0)

    async def receive(self):
        while True:
            message = await self.incoming.get()
            if message == "drop":
                self._connection_lost = True
                return
            if message == "end":
                return
            if message == "error":
                raise EOFError("self-authored fake")
            await self._handle_recv(message)

    async def _get_connected_applications(self):
        await self._send_message(GET_APPS, {})

    async def _send_message(self, selector, args=None):
        self.sent_selectors.append(selector)
        if selector == GET_APPS:
            if self.mode == "send-error":
                raise OSError("fake")
            if self.mode == "send-timeout":
                await asyncio.sleep(10)
            if self.mode in ("no-app-reply", "handshake-list"):
                return
            if self.mode in ("drop", "end", "error"):
                await self.incoming.put(self.mode)
            elif self.mode == "empty-apps":
                await self.incoming.put(apps())
            elif self.mode == "other-app":
                await self.incoming.put(apps(OTHER))
            elif self.mode == "notification-only":
                await self.incoming.put({"__selector": CONNECTED, "__argument": WX})
            elif self.mode == "malformed":
                await self.incoming.put({"__selector": APP_LIST, "__argument": {"WIRApplicationDictionaryKey": None}})
            elif self.mode == "auto-inspection":
                await self.incoming.put({"__selector": "_rpc_reportAutomaticInspectionCandidate:", "__argument": {}})
            else:
                if self.mode == "partial-wechat":
                    await self.incoming.put(apps(WX, {**WX, "WIRApplicationIdentifierKey": "fake-wx-2"}))
                else:
                    await self.incoming.put(apps(WX, OTHER) if self.mode == "privacy" else apps(WX))
        elif selector == GET_LISTING:
            key = args["WIRApplicationIdentifierKey"]
            if self.mode == "listing-send-timeout":
                await asyncio.sleep(10)
            if self.mode == "no-listing" or (self.mode == "partial-wechat" and key == "fake-wx-2"):
                return
            await self.incoming.put(listing(key, 0 if self.mode == "empty-listing" else 1))
            if self.mode == "replace-empty":
                await self.incoming.put(listing(key, 0))
            if self.mode == "disconnect":
                await self.incoming.put({"__selector": DISCONNECTED, "__argument": {"WIRApplicationIdentifierKey": key}})

    async def _handle_recv(self, message):
        selector, arg = message["__selector"], message["__argument"]
        if selector == APP_LIST:
            for key in arg["WIRApplicationDictionaryKey"]:
                await self._send_message(GET_LISTING, {"WIRApplicationIdentifierKey": key})
        elif selector == LISTING:
            self.application_pages[arg["WIRApplicationIdentifierKey"]] = {
                key: Obj(id_=key, type_=Obj(value="WIRTypeJavaScript"), web_title="fake-private-title", web_url="")
                for key in arg["WIRListingKey"]}
        elif selector == "_rpc_reportAutomaticInspectionCandidate:":
            await self._send_message("_rpc_forwardDidClose:", {})

    async def close(self):
        self.calls.append("inspector-close")
        if self.mode == "close-timeout":
            await asyncio.sleep(10)
        if self.mode == "close-error":
            raise OSError("fake close")
        if self.mode == "cleanup-late-record":
            self.response_record.application_reply["processingErrors"].append("FakeCleanupMutation")
        await close_once(self, self.close_service)

    async def close_service(self):
        self.calls.append("service-close")


class FakeInspector(RecordedMetadataMixin, FakeBase):
    pass


class FakeTests(unittest.IsolatedAsyncioTestCase):
    async def run_mode(self, mode, budgets=(.2, .2, .12, .6, .04)):
        calls = []
        provider = Obj(paired=mode != "unpaired", udid="wrong" if mode == "mismatch" else "fake", calls=calls)
        async def close():
            calls.append("provider-close")
        provider.close = close
        async def create(**kwargs):
            calls.append("provider-create")
            self.assertEqual(kwargs, {"serial": "fake", "connection_type": "USB", "autopair": False})
            if mode == "provider-timeout":
                await asyncio.sleep(10)
            return provider
        holders = []
        def factory(p, record):
            inspector = FakeInspector(p, record, mode)
            holders.append(inspector)
            return inspector
        result = await collect("fake", create, factory, budgets)
        self.assertEqual(calls.count("provider-create"), 1)
        self.assertLessEqual(calls.count("connect"), 1)
        self.assertEqual(result["currentGameSession"], "UNKNOWN_NOT_ASSOCIATED_WITH_ORIGINAL_FREEZE")
        # Cleanup timeout fake deliberately leaves its fake receiver; clean it ONLY in test harness.
        for inspector in holders:
            if inspector._recv_task is not None:
                inspector._recv_task.cancel()
                await asyncio.gather(inspector._recv_task, return_exceptions=True)
        return result, calls

    async def test_app_list_no_reply_is_timeout(self):
        result, _ = await self.run_mode("no-app-reply")
        self.assertEqual(result["outcome"], "application-list-reply-timeout")
        self.assertEqual(result["applicationList"]["reply"]["received"], 0)
        self.assertIsNone(result["applicationList"]["reply"]["lastCount"])
        self.assertTrue(result["applicationList"]["replyDeadlineExpired"])

    async def test_received_empty_app_list(self):
        result, _ = await self.run_mode("empty-apps")
        self.assertEqual(result["outcome"], "application-list-received-empty")
        self.assertEqual(result["applicationList"]["responseState"], "received-empty")
        self.assertFalse(result["applicationList"]["replyDeadlineExpired"])

    async def test_other_app_is_not_no_reply(self):
        result, _ = await self.run_mode("other-app")
        self.assertEqual(result["outcome"], "wechat-not-in-received-list")
        self.assertFalse(result["wechatObserved"])

    async def test_wechat_no_listing_reply(self):
        result, _ = await self.run_mode("no-listing")
        self.assertEqual(result["outcome"], "wechat-listing-reply-timeout")
        self.assertTrue(result["wechatObserved"])
        self.assertIsNone(result["wechatApplications"][0]["listing"]["reply"]["lastCount"])

    async def test_wechat_listing_received_empty(self):
        result, _ = await self.run_mode("empty-listing")
        self.assertEqual(result["outcome"], "wechat-listing-received-empty")
        self.assertEqual(result["wechatApplications"][0]["listing"]["responseState"], "received-empty")

    async def test_wechat_target_metadata(self):
        result, _ = await self.run_mode("success")
        self.assertEqual(result["outcome"], "wechat-target-metadata-found")
        self.assertEqual(len(result["targets"]), 1)
        self.assertEqual(result["receiverBeforeCleanup"]["taskState"], "running")

    async def test_handshake_reply_not_lost_or_claimed_as_query_reply(self):
        result, _ = await self.run_mode("handshake-list")
        self.assertEqual(result["applicationList"]["reply"]["beforeQuery"], 1)
        self.assertEqual(result["outcome"], "application-list-reply-timeout")
        self.assertTrue(result["wechatObserved"])
        self.assertTrue(result["applicationList"]["replyDeadlineExpired"])

    async def test_notification_not_full_list_reply(self):
        result, _ = await self.run_mode("notification-only")
        self.assertEqual(result["outcome"], "application-list-reply-timeout")
        self.assertTrue(result["wechatObserved"])
        self.assertEqual(result["applicationNotifications"]["connected"], 1)

    async def test_listing_full_replacement(self):
        result, _ = await self.run_mode("replace-empty")
        self.assertEqual(result["outcome"], "wechat-listing-received-empty")
        self.assertEqual(result["wechatApplications"][0]["listing"]["reply"]["received"], 2)
        self.assertEqual(result["targets"], [])

    async def test_disconnect_does_not_publish_old_pages(self):
        result, _ = await self.run_mode("disconnect")
        self.assertEqual(result["outcome"], "wechat-disconnected")
        self.assertEqual(result["targets"], [])

    async def test_receiver_connection_drop_normal_return(self):
        result, _ = await self.run_mode("drop")
        self.assertEqual(result["outcome"], "connection-lost")
        self.assertIsNone(result["receiverBeforeCleanup"]["errorType"])
        self.assertTrue(result["receiverBeforeCleanup"]["connectionLost"])
        self.assertFalse(result["applicationList"]["replyDeadlineExpired"])

    async def test_receiver_error(self):
        result, calls = await self.run_mode("error")
        self.assertEqual(result["outcome"], "receiver-failed")
        self.assertEqual(result["receiverBeforeCleanup"]["errorType"], "EOFError")
        self.assertIn("service-close", calls)
        self.assertIn("provider-close", calls)

    async def test_receiver_unexpected_normal_end(self):
        result, _ = await self.run_mode("end")
        self.assertEqual(result["outcome"], "receiver-ended-before-deadline")

    async def test_automatic_inspection_control_blocked(self):
        result, _ = await self.run_mode("auto-inspection")
        self.assertEqual(result["outcome"], "receiver-failed")
        self.assertEqual(result["blockedSendCount"], 1)
        self.assertEqual(result["receiverBeforeCleanup"]["errorType"], "MetadataSelectorBlocked")

    async def test_malformed_reply_is_failure(self):
        result, _ = await self.run_mode("malformed")
        self.assertEqual(result["outcome"], "receiver-failed")
        self.assertEqual(result["processingErrorTypes"], ["TypeError"])
        self.assertEqual(result["applicationList"]["reply"]["selectorObserved"], 1)
        self.assertEqual(result["applicationList"]["responseState"], "reply-processing-failed")

    async def test_send_error_is_not_empty_response(self):
        result, _ = await self.run_mode("send-error")
        self.assertEqual(result["outcome"], "operation-failed")
        self.assertEqual(result["errorType"], "OSError")
        self.assertEqual(result["applicationList"]["request"]["sendErrorTypes"], ["OSError"])

    async def test_request_send_not_completed(self):
        result, _ = await self.run_mode("send-timeout")
        self.assertEqual(result["outcome"], "application-list-send-incomplete-at-deadline")
        self.assertEqual(result["applicationList"]["request"]["sendCompleted"], 0)
        self.assertTrue(result["applicationList"]["sendIncompleteAtDeadline"])
        self.assertFalse(result["applicationList"]["replyDeadlineExpired"])

    async def test_lost_connection_before_query_sends_no_request(self):
        result, _ = await self.run_mode("pre-query-drop")
        self.assertEqual(result["outcome"], "connection-lost")
        self.assertEqual(result["applicationList"]["request"]["attempts"], 0)

    async def test_multiple_wechat_instances_partial_reply_not_complete(self):
        result, _ = await self.run_mode("partial-wechat")
        self.assertEqual(result["outcome"], "wechat-listing-reply-timeout")
        self.assertEqual(result["wechatCountInLatestFullList"], 2)
        self.assertEqual(len(result["targets"]), 1)
        self.assertEqual([app["listing"]["responseState"] for app in result["wechatApplications"]],
                         ["received-nonempty", "not-received-within-window"])

    async def test_listing_send_not_completed(self):
        result, _ = await self.run_mode("listing-send-timeout")
        self.assertEqual(result["outcome"], "wechat-listing-send-incomplete-at-deadline")
        self.assertTrue(result["wechatApplications"][0]["listing"]["sendIncompleteAtDeadline"])
        self.assertFalse(result["wechatApplications"][0]["listing"]["replyDeadlineExpired"])

    async def test_provider_connect_and_total_deadlines(self):
        for mode, phase, budgets in (("provider-timeout", "provider", (.03, .2, .12, .6, .04)),
                                     ("connect-timeout", "webinspector-connect", (.2, .03, .12, .6, .04)),
                                     ("no-app-reply", "metadata-window", (.2, .2, 10, .15, .04))):
            with self.subTest(mode=mode):
                result, _ = await self.run_mode(mode, budgets)
                self.assertEqual(result["outcome"], "local-operation-timeout")
                self.assertEqual(result["phase"], phase)
                self.assertFalse(result["applicationList"]["replyDeadlineExpired"])

    async def test_pair_and_identity_failure_do_not_connect(self):
        for mode in ("unpaired", "mismatch"):
            result, calls = await self.run_mode(mode)
            self.assertEqual(result["outcome"], "operation-failed")
            self.assertNotIn("connect", calls)
            self.assertEqual(calls, ["provider-create", "provider-close"])

    async def test_cleanup_timeout_still_attempts_provider(self):
        result, calls = await self.run_mode("close-timeout")
        self.assertEqual(result["cleanup"][0]["errorType"], "TimeoutError")
        self.assertIn("provider-close", calls)
        self.assertEqual(result["receiverBeforeCleanup"]["taskState"], "running")

    async def test_cleanup_error_still_attempts_provider(self):
        result, calls = await self.run_mode("close-error")
        self.assertEqual(result["cleanup"][0]["errorType"], "OSError")
        self.assertIn("provider-close", calls)

    async def test_before_cleanup_record_is_immutable(self):
        result, _ = await self.run_mode("cleanup-late-record")
        self.assertEqual(result["applicationList"]["reply"]["processingErrors"], [])

    async def test_other_titles_and_ids_not_saved(self):
        result, _ = await self.run_mode("privacy")
        encoded = json.dumps(result)
        self.assertNotIn("com.example.other", encoded)
        self.assertNotIn("fake-other", encoded)
        self.assertEqual(len(result["targets"]), 1)

    async def test_handshake_one_attempt_and_original_error(self):
        for step in (None, "connect", "identifier", "receive"):
            calls, original = [], RuntimeError("fake")
            async def operation(name):
                calls.append(name)
                if name == step:
                    raise original
                return {"fake": True}
            class Inspector:
                async def _await_or_raise_disabled(self, coro, disabled): return await coro
                async def _report_identifier(self): return await operation("identifier")
                async def _recv_message(self): return await operation("receive")
                async def _handle_recv(self, value): calls.append("handle")
            try:
                await handshake_once(Inspector(), None, lambda: operation("connect"))
                self.assertIsNone(step)
            except RuntimeError as error:
                self.assertIs(error, original)
            self.assertEqual(calls.count("connect"), 1)
            if step:
                self.assertEqual(calls[-1], step)

    async def test_handshake_timeout_collects_its_child(self):
        ended = asyncio.Event()
        async def child():
            try:
                await asyncio.Future()
            finally:
                ended.set()
        async def disabled():
            await asyncio.Future()
        disabled_task = asyncio.create_task(disabled())
        try:
            with self.assertRaises(TimeoutError):
                await asyncio.wait_for(await_or_disabled_once(child(), disabled_task), .01)
            self.assertTrue(ended.is_set())
            self.assertFalse(disabled_task.done())  # owned by the outer notification context
        finally:
            disabled_task.cancel()
            await asyncio.gather(disabled_task, return_exceptions=True)

    async def test_disabled_signal_propagates_original_and_collects_child(self):
        ended, started = asyncio.Event(), asyncio.Event()
        fault = RuntimeError("fake disabled")
        async def child():
            try:
                started.set()
                await asyncio.Future()
            finally:
                ended.set()
        async def disabled():
            await started.wait()
            raise fault
        disabled_task = asyncio.create_task(disabled())
        with self.assertRaises(RuntimeError) as caught:
            await await_or_disabled_once(child(), disabled_task)
        self.assertIs(caught.exception, fault)
        self.assertTrue(ended.is_set())


class RecordTests(unittest.TestCase):
    def test_id_reappears_discards_previous_generation(self):
        record = ResponseRecord()
        record.observe(APP_LIST, apps(WX)["__argument"])
        record.sent(GET_LISTING, {"WIRApplicationIdentifierKey": "fake-wx"})
        record.observe(LISTING, listing(count=1)["__argument"])
        record.observe(DISCONNECTED, {"WIRApplicationIdentifierKey": "fake-wx"})
        record.observe(CONNECTED, WX)
        result = record.snapshot(True, {}, "observation-window-ended")
        app = result["wechatApplications"][0]
        self.assertEqual(app["generation"], 2)
        self.assertEqual(app["listing"]["reply"]["received"], 0)
        self.assertEqual(result["discardedPriorGenerationReplyCount"], 1)

    def test_unassociated_listing_not_hidden_or_claimed_fresh(self):
        record = ResponseRecord()
        record.observe(LISTING, listing(count=1)["__argument"])
        record.observe(CONNECTED, WX)
        result = record.snapshot(True, {}, "observation-window-ended")
        self.assertEqual(result["unassociatedListingReplyCount"], 1)
        self.assertEqual(result["wechatApplications"][0]["lastHistoricalReply"]["reply"]["lastCount"], 1)
        self.assertFalse(result["wechatApplications"][0]["listing"]["replyObservedAfterLatestRequest"])

    def test_previous_reply_does_not_answer_new_request(self):
        record = ResponseRecord()
        record.sent(GET_APPS, {})
        record.sent(GET_APPS, {}, completed=True)
        record.observe(APP_LIST, apps()["__argument"])
        record.sent(GET_APPS, {})
        record.sent(GET_APPS, {}, completed=True)
        self.assertEqual(record.snapshot(True, {}, "observation-window-ended")["outcome"], "application-list-reply-timeout")

    def test_automation_availability_not_named_inspectability(self):
        record = ResponseRecord()
        record.observe("_rpc_reportCurrentState:", {"WIRAutomationAvailabilityKey": "WIRAutomationAvailabilityNotAvailable"})
        result = record.snapshot(False, {}, "not-started")
        self.assertEqual(result["firstIncomingMessageKind"], "automation-state")
        self.assertEqual(result["reportedAutomationAvailability"], "WIRAutomationAvailabilityNotAvailable")
        self.assertNotIn("webInspectorDisabled", result)

    def test_replies_after_deadline_not_counted_as_in_window(self):
        now = [0.0]
        record = ResponseRecord(clock=lambda: now[0])
        record.query_started, record.deadline = True, 2.0
        record.sent(GET_APPS, {})
        record.sent(GET_APPS, {}, completed=True)
        now[0] = 2.001
        with self.assertRaises(ObservationWindowEnded):
            record.observe(APP_LIST, apps()["__argument"])
        self.assertEqual(record.application_reply["received"], 0)
        self.assertEqual(record.snapshot(True, {}, "observation-window-ended")["outcome"], "application-list-reply-timeout")

    def test_late_listing_request_blocked_before_send(self):
        record = ResponseRecord()
        record.closed = True
        with self.assertRaises(ObservationWindowEnded):
            record.sent(GET_LISTING, {"WIRApplicationIdentifierKey": "fake-wx"})
        self.assertEqual(record.applications, {})

    def test_no_request_by_deadline_not_called_reply_timeout(self):
        record = ResponseRecord()
        result = record.snapshot(True, {}, "observation-window-ended")
        self.assertEqual(result["outcome"], "application-list-not-requested-before-deadline")
        self.assertEqual(result["applicationList"]["responseState"], "not-requested")

    def test_selector_validation(self):
        for good in ("0" * 40, "01234567-0123456789ABCDEF"):
            self.assertEqual(validate_selector(good), good)
        for bad in ("", "fake", "0" * 40 + "\n", "0" * 40 + " " + "1" * 40, "--help", "０" * 40, "C:/private"):
            with self.assertRaises(ValueError): validate_selector(bad)

    def test_no_real_device_module_imported(self):
        self.assertFalse(any(name.startswith("pymobiledevice3") for name in sys.modules))

    def test_cli_gates_do_not_read_missing_selector_or_import_device_package(self):
        root = Path(__file__).parent
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            out = folder / "existing.json"
            out.write_bytes(b"KEEP")
            for extra in ([], ["--approved-metadata-only"]):
                child = subprocess.run([sys.executable, "-B", str(root / "device_enumerator.py"), *extra,
                                        "--udid-file", str(folder / "missing"), "--out", str(out)], capture_output=True, text=True)
                self.assertNotEqual(child.returncode, 0)
                self.assertNotIn("FileNotFoundError", child.stderr)
                self.assertNotIn("ModuleNotFoundError", child.stderr)
            self.assertEqual(out.read_bytes(), b"KEEP")
            help_result = subprocess.run([sys.executable, "-B", str(root / "device_enumerator.py"), "--help"], capture_output=True)
            self.assertEqual(help_result.returncode, 0)
            launch = subprocess.run([sys.executable, "-B", str(root / "launch_once.py"), "--python", sys.executable,
                                     "--udid-file", str(folder / "missing"), "--out-dir", str(folder / "new")], capture_output=True)
            self.assertNotEqual(launch.returncode, 0)
            self.assertFalse((folder / "new").exists())

    def test_owned_children_success_failure_and_hard_cutoff(self):
        success = run_owned([sys.executable, "-B", "-c", "print('fake only')"], timeout=3)
        self.assertEqual(success["exitCode"], 0)
        failure = run_owned([sys.executable, "-B", "-c", "raise SystemExit(7)"], timeout=3)
        self.assertEqual(failure["exitCode"], 7)
        timeout = run_owned([sys.executable, "-B", "-c", "import time; time.sleep(5)"], timeout=.1)
        self.assertEqual(timeout["status"], "owned-helper-hard-timeout")
        self.assertFalse(timeout["retry"])

    def test_owned_hard_cutoff_of_uncooperative_fake_cancellation(self):
        source = ("import asyncio\n"
                  "async def stubborn():\n"
                  " while True:\n"
                  "  try: await asyncio.sleep(1)\n"
                  "  except asyncio.CancelledError: pass\n"
                  "async def main():\n"
                  " task=asyncio.create_task(stubborn())\n"
                  " await asyncio.wait_for(task, .01)\n"
                  "asyncio.run(main())\n")
        result = run_owned([sys.executable, "-B", "-c", source], timeout=.5)
        self.assertEqual(result["status"], "owned-helper-hard-timeout")
        self.assertFalse(result["retry"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
