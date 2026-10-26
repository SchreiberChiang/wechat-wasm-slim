"""Metadata-only response accounting. Standard library only; importing never contacts a device."""
import asyncio
from copy import deepcopy
import time


APP_LIST = "_rpc_reportConnectedApplicationList:"
LISTING = "_rpc_applicationSentListing:"
CONNECTED = "_rpc_applicationConnected:"
UPDATED = "_rpc_applicationUpdated:"
DISCONNECTED = "_rpc_applicationDisconnected:"
GET_APPS = "_rpc_getConnectedApplications:"
GET_LISTING = "_rpc_forwardGetListing:"
ALLOWED_SEND = frozenset(("_rpc_reportIdentifier:", GET_APPS, GET_LISTING))


class MetadataSelectorBlocked(RuntimeError):
    pass


class ObservationWindowEnded(RuntimeError):
    pass


def is_wechat(bundle):
    return isinstance(bundle, str) and (bundle == "com.tencent.xin" or bundle.startswith("com.tencent.xin."))


def request_record():
    return {"attempts": 0, "sendCompleted": 0, "sendErrorTypes": [], "lastSequence": None,
            "lastSendState": "not-attempted", "lastAttemptAtMs": None, "lastCompletedAtMs": None}


def reply_record():
    return {"selectorObserved": 0, "received": 0, "beforeQuery": 0, "lastSequence": None, "lastCount": None,
            "lastAtMs": None, "handlerCompleted": 0, "processingErrors": []}


class ResponseRecord:
    """No raw protocol bodies, non-WeChat titles/URLs, account IDs or device IDs are retained."""
    def __init__(self, clock=time.monotonic):
        self.clock, self.started = clock, clock()
        self.sequence = 0
        self.query_started = False
        self.application_request = request_record()
        self.application_reply = reply_record()
        self.applications = {}
        self.notification_counts = {"connected": 0, "updated": 0, "disconnected": 0}
        self.blocked_sends = 0
        self.received_selectors = 0
        self.processing_errors = []
        self.unassociated_listing_replies = 0
        self.replaced_generation_replies = 0
        self.last_full_list_wechat_count = None
        self.first_incoming_kind = None
        self.reported_automation_availability = None
        self.listing_message_count = 0
        self.deadline = None
        self.closed = False

    def ensure_open(self):
        if self.closed or (self.deadline is not None and self.clock() >= self.deadline):
            raise ObservationWindowEnded("Metadata observation deadline reached")

    def tick(self):
        self.sequence += 1
        return self.sequence

    def app(self, app_id):
        return self.applications.setdefault(app_id, {
            "reference": "app-" + str(len(self.applications) + 1),
            "bundle": None, "present": False, "everWechat": False, "generation": 0,
            "request": request_record(), "reply": reply_record(), "targetTypes": {},
            "historicalReplyCount": 0, "lastHistoricalReply": None,
        })

    def sent(self, selector, args, completed=False, error=None):
        # Called before and after the original send; no additional protocol messages.
        if selector not in ALLOWED_SEND:
            self.blocked_sends += 1
            raise MetadataSelectorBlocked("Non-metadata selector blocked")
        self.ensure_open()
        seq = self.tick()
        record = self.application_request if selector == GET_APPS else (
            self.app(args["WIRApplicationIdentifierKey"])["request"] if selector == GET_LISTING else None)
        if record is not None:
            if completed:
                record["sendCompleted"] += 1
                record["lastSendState"] = "send-completed"
                record["lastCompletedAtMs"] = round((self.clock() - self.started) * 1000, 3)
            elif error is not None:
                record["sendErrorTypes"].append(type(error).__name__)
                record["lastSendState"] = "send-failed"
            else:
                record["attempts"] += 1
                record["lastSequence"] = seq
                record["lastSendState"] = "send-started-not-completed"
                record["lastAttemptAtMs"] = round((self.clock() - self.started) * 1000, 3)

    def reply(self, record, count):
        record["received"] += 1
        record["beforeQuery"] += int(not self.query_started)
        record["lastSequence"] = self.sequence
        record["lastCount"] = count
        record["lastAtMs"] = round((self.clock() - self.started) * 1000, 3)

    def observe(self, selector, args):
        self.ensure_open()
        self.tick()
        self.received_selectors += 1
        if self.first_incoming_kind is None:
            self.first_incoming_kind = {APP_LIST: "application-list", LISTING: "target-listing",
                                        "_rpc_reportCurrentState:": "automation-state"}.get(selector, "other")
        if selector == "_rpc_reportCurrentState:":
            value = args.get("WIRAutomationAvailabilityKey")
            self.reported_automation_availability = value if value in {
                "WIRAutomationAvailabilityAvailable", "WIRAutomationAvailabilityNotAvailable",
                "WIRAutomationAvailabilityUnknown"} else "unrecognized-or-missing"
        if selector == APP_LIST:
            self.application_reply["selectorObserved"] += 1
            apps = args["WIRApplicationDictionaryKey"]
            if not isinstance(apps, dict):
                raise TypeError("Application list is not a dictionary")
            self.reply(self.application_reply, len(apps))
            self.last_full_list_wechat_count = sum(is_wechat(raw.get("WIRApplicationBundleIdentifierKey")) for raw in apps.values())
            # Complete replacement, not a union with previously seen applications.
            prior = {key for key, app in self.applications.items() if app["present"]}
            for app in self.applications.values():
                app["present"] = False
            for key, raw in apps.items():
                self.discover(key, raw, was_present=key in prior)
        elif selector in (CONNECTED, UPDATED):
            self.notification_counts["connected" if selector == CONNECTED else "updated"] += 1
            key = args["WIRApplicationIdentifierKey"]
            self.discover(key, args, was_present=self.app(key)["present"])
        elif selector == DISCONNECTED:
            self.notification_counts["disconnected"] += 1
            self.app(args["WIRApplicationIdentifierKey"])["present"] = False
        elif selector == LISTING:
            self.listing_message_count += 1
            app = self.app(args["WIRApplicationIdentifierKey"])
            app["reply"]["selectorObserved"] += 1
            if app["bundle"] is None:
                self.unassociated_listing_replies += 1
            listing = args["WIRListingKey"]
            if not isinstance(listing, dict):
                raise TypeError("Target listing is not a dictionary")
            self.reply(app["reply"], len(listing))
            types = {}
            for target in listing.values():
                kind = target.get("WIRTypeKey", "missing")
                # Fixed categories only; unknown vendor strings are not copied.
                if kind not in {"WIRTypeJavaScript", "WIRTypeWeb", "WIRTypeWebPage", "WIRTypePage",
                                "WIRTypeServiceWorker", "WIRTypeAutomation", "WIRTypeITML"}:
                    kind = "unknown"
                types[kind] = types.get(kind, 0) + 1
            app["targetTypes"] = types

    def discover(self, key, raw, was_present):
        app = self.app(key)
        if not was_present:
            # An app ID reappearing is not evidence its old pages are still current.
            self.replaced_generation_replies += app["reply"]["received"]
            if app["reply"]["received"]:
                app["historicalReplyCount"] += app["reply"]["received"]
                app["lastHistoricalReply"] = {"generation": app["generation"], "reply": dict(app["reply"])}
            app["generation"] += 1
            app["request"], app["reply"], app["targetTypes"] = request_record(), reply_record(), {}
        app["bundle"] = raw["WIRApplicationBundleIdentifierKey"]
        app["present"] = True
        app["everWechat"] |= is_wechat(app["bundle"])

    def processed(self, selector, args):
        if selector == APP_LIST:
            self.application_reply["handlerCompleted"] += 1
        elif selector == LISTING:
            self.app(args["WIRApplicationIdentifierKey"])["reply"]["handlerCompleted"] += 1

    def processing_failed(self, selector, error, args):
        name = type(error).__name__
        self.processing_errors.append(name)
        if selector == APP_LIST:
            self.application_reply["processingErrors"].append(name)
        elif selector == LISTING and isinstance(args, dict) and "WIRApplicationIdentifierKey" in args:
            self.app(args["WIRApplicationIdentifierKey"])["reply"]["processingErrors"].append(name)

    @staticmethod
    def response(request, reply, expired):
        after = (request["lastSequence"] is not None and reply["lastSequence"] is not None
                 and reply["lastSequence"] > request["lastSequence"])
        if reply["processingErrors"]:
            state = "reply-processing-failed"
        elif after:
            state = "received-empty" if reply["lastCount"] == 0 else "received-nonempty"
        elif request["attempts"]:
            state = "not-received-within-window" if expired else "not-received-before-stop"
        else:
            state = "not-requested"
        return {"request": dict(request), "reply": dict(reply), "replyObservedAfterLatestRequest": after,
                "responseState": state,
                "replyDeadlineExpired": bool(expired and request["lastSendState"] == "send-completed"
                                             and not after and not reply["processingErrors"]),
                "sendIncompleteAtDeadline": bool(expired and request["lastSendState"] == "send-started-not-completed")}

    def snapshot(self, expired, receiver, finish):
        apps = []
        for app in self.applications.values():
            if app["everWechat"]:
                apps.append({"applicationRef": app["reference"], "present": app["present"], "generation": app["generation"],
                             "currentBundleMatchesWechat": is_wechat(app["bundle"]),
                             "listing": self.response(app["request"], app["reply"], expired),
                             "historicalReplyCount": app["historicalReplyCount"],
                             "lastHistoricalReply": app["lastHistoricalReply"],
                             "targetTypes": dict(app["targetTypes"])})
        application = self.response(self.application_request, self.application_reply, expired)
        current = [app for app in apps if app["present"] and app["currentBundleMatchesWechat"]]
        if finish != "observation-window-ended":
            outcome = finish
        elif self.processing_errors:
            outcome = "reply-processing-failed"
        elif not self.application_request["attempts"]:
            outcome = "application-list-not-requested-before-deadline"
        elif not application["replyObservedAfterLatestRequest"]:
            outcome = ("application-list-send-incomplete-at-deadline" if self.application_request["lastSendState"] == "send-started-not-completed"
                       else "application-list-reply-timeout")
        elif not current:
            outcome = "wechat-disconnected" if apps else (
                "application-list-received-empty" if application["reply"]["lastCount"] == 0 else "wechat-not-in-received-list")
        elif any(not app["listing"]["replyObservedAfterLatestRequest"] for app in current):
            outcome = "wechat-listing-send-incomplete-at-deadline" if any(
                app["listing"]["sendIncompleteAtDeadline"] for app in current) else (
                    "wechat-listing-not-requested" if any(not app["listing"]["request"]["attempts"] for app in current)
                    else "wechat-listing-reply-timeout")
        else:
            outcome = "wechat-target-metadata-found" if any(app["listing"]["reply"]["lastCount"] for app in current) else "wechat-listing-received-empty"
        return deepcopy({"schema": "inspector-response-observation-v2", "outcome": outcome,
                "currentGameSession": "UNKNOWN_NOT_ASSOCIATED_WITH_ORIGINAL_FREEZE",
                "requestCorrelation": "temporal-only; protocol has no per-request correlation ID",
                "observationWindowEnded": expired, "applicationList": application,
                "wechatObserved": bool(apps), "wechatCurrentlyListed": bool(current), "wechatApplications": apps,
                "wechatCountInLatestFullList": self.last_full_list_wechat_count,
                "applicationNotifications": dict(self.notification_counts), "receivedSelectorCount": self.received_selectors,
                "targetListingMessageObservedCount": self.listing_message_count,
                "firstIncomingMessageKind": self.first_incoming_kind,
                "reportedAutomationAvailability": self.reported_automation_availability,
                "blockedSendCount": self.blocked_sends, "processingErrorTypes": list(self.processing_errors),
                "unassociatedListingReplyCount": self.unassociated_listing_replies,
                "discardedPriorGenerationReplyCount": self.replaced_generation_replies,
                "receiverBeforeCleanup": receiver})


class RecordedMetadataMixin:
    """Wrap original boundaries without adding sends, attach, evaluation or retries."""
    async def _send_message(self, selector, args=None):
        self.response_record.sent(selector, args)
        try:
            result = await super()._send_message(selector, args)
        except ObservationWindowEnded:
            raise
        except Exception as error:
            self.response_record.sent(selector, args, error=error)
            raise
        self.response_record.sent(selector, args, completed=True)
        return result

    async def _handle_recv(self, plist):
        selector = plist.get("__selector")
        args = plist.get("__argument")
        try:
            self.response_record.observe(selector, args)
            result = await super()._handle_recv(plist)
            self.response_record.processed(selector, args)
            return result
        except ObservationWindowEnded:
            raise
        except Exception as error:
            self.response_record.processing_failed(selector, error, args)
            raise


async def handshake_once(inspector, disabled_task, base_connect):
    await inspector._await_or_raise_disabled(base_connect(), disabled_task)
    await inspector._await_or_raise_disabled(inspector._report_identifier(), disabled_task)
    await inspector._handle_recv(await inspector._await_or_raise_disabled(inspector._recv_message(), disabled_task))


async def await_or_disabled_once(coro, disabled_task):
    """Own the handshake child even if the caller times out/cancels; no orphaned retry."""
    task = asyncio.create_task(coro)
    try:
        done, _ = await asyncio.wait({task, disabled_task}, return_when=asyncio.FIRST_COMPLETED)
        if disabled_task in done:
            await disabled_task  # propagate original disabled-notification exception
            raise RuntimeError("Disabled monitor ended unexpectedly")
        return await task
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def close_once(inspector, base_close):
    """A failed receive task must not prevent closing the underlying service."""
    if inspector._recv_task is not None:
        inspector._recv_task.cancel()
        await asyncio.gather(inspector._recv_task, return_exceptions=True)
        inspector._recv_task = None
    await base_close()


def receiver_state(inspector):
    if inspector is None:
        return {"taskState": "not-created", "connectionLost": None}
    task = inspector._recv_task
    state = {"taskState": "not-started", "connectionLost": bool(inspector._connection_lost), "errorType": None}
    if task is not None:
        state["taskState"] = "cancelled" if task.cancelled() else "done" if task.done() else "running"
        if task.done() and not task.cancelled():
            error = task.exception()
            state["errorType"] = type(error).__name__ if error is not None else None
    return state


def target_metadata(record, inspector, expired):
    targets = []
    if inspector is None:
        return targets
    for app_id, app in record.applications.items():
        if not app["present"] or not is_wechat(app["bundle"]):
            continue
        if not record.response(app["request"], app["reply"], expired)["replyObservedAfterLatestRequest"]:
            continue
        for page in inspector.application_pages.get(app_id, {}).values():
            targets.append({"bundle": app["bundle"], "applicationId": app_id, "applicationRef": app["reference"],
                            "pageId": page.id_, "type": page.type_.value, "title": page.web_title, "url": page.web_url})
    return targets


async def collect(expected, create, factory, budgets=(3, 3, 2, 8, 1)):
    """One connection; a fixed metadata window; independent bounded resource cleanup.

    factory(provider, record) installs accounting BEFORE connect/handshake. Budgets:
    provider, connect, metadata window including request send, total operation, EACH cleanup.
    An external owned-child deadline remains necessary for uncooperative cancellation.
    """
    record = ResponseRecord()
    provider = inspector = None
    phase, finish, expired, error_type = "provider", "not-started", False, None
    frozen_record = frozen_receiver = frozen_targets = copy_error = None
    provider_budget, connect_budget, window, total, cleanup_budget = budgets

    async def operation():
        nonlocal provider, inspector, phase, finish, expired
        nonlocal frozen_record, frozen_receiver, frozen_targets, copy_error
        provider = await asyncio.wait_for(create(serial=expected, connection_type="USB", autopair=False), provider_budget)
        canonical = lambda value: value.replace("-", "").lower() if isinstance(value, str) else None
        if not provider.paired or canonical(provider.udid) != canonical(expected):
            raise RuntimeError("Existing pairing and exact target required")
        phase = "webinspector-connect"
        inspector = factory(provider, record)
        await asyncio.wait_for(inspector.connect(), connect_budget)
        health = receiver_state(inspector)
        if health["connectionLost"] or health["taskState"] != "running":
            finish = "connection-lost" if health["connectionLost"] else (
                "receiver-failed" if health["errorType"] else "receiver-ended-before-deadline")
            return
        phase = "metadata-window"
        record.query_started = True
        record.deadline = record.clock() + window

        async def observe():
            await inspector._get_connected_applications()
            # A fixed deadline, not early success on a transient nonempty cache.
            await asyncio.Future()

        query = asyncio.create_task(observe())
        receiver = inspector._recv_task
        try:
            done, _ = await asyncio.wait({query, receiver}, timeout=window, return_when=asyncio.FIRST_COMPLETED)
            health = receiver_state(inspector)
            if receiver in done:
                finish = "connection-lost" if health["connectionLost"] else "receiver-ended-before-deadline"
                if health["errorType"]:
                    finish = "receiver-failed"
                if health["errorType"] == "ObservationWindowEnded":
                    expired, finish = True, "observation-window-ended"
            elif query in done:
                await query  # propagate send errors; never turn them into an empty reply
            else:
                expired, finish = True, "observation-window-ended"
        except ObservationWindowEnded:
            expired, finish = True, "observation-window-ended"
        finally:
            # Freeze before cancellation yields to any late incoming packets.
            record.closed = True
            frozen_record, frozen_receiver = deepcopy(record), receiver_state(inspector)
            try:
                frozen_targets = target_metadata(frozen_record, inspector, expired)
            except Exception as error:
                copy_error = type(error).__name__
            query.cancel()
            await asyncio.gather(query, return_exceptions=True)

    try:
        await asyncio.wait_for(operation(), total)
    except Exception as error:
        error_type = type(error).__name__
        finish = "local-operation-timeout" if isinstance(error, TimeoutError) else "operation-failed"
    # Freeze the record BEFORE cleanup cancels the receiver or closes a connection.
    result = (frozen_record or record).snapshot(expired, frozen_receiver or receiver_state(inspector), finish)
    result.update({"phase": phase, "errorType": error_type, "targets": frozen_targets or [], "targetAssociation": "UNVERIFIED"})
    if copy_error:
        result["outcome"], result["errorType"] = "metadata-copy-failed", copy_error
    result["cleanup"] = []
    for name, resource in (("inspector", inspector), ("provider", provider)):
        if resource is None:
            continue
        try:
            await asyncio.wait_for(resource.close(), cleanup_budget)
            result["cleanup"].append({"resource": name, "status": "closed"})
        except Exception as error:
            result["cleanup"].append({"resource": name, "status": "failed", "errorType": type(error).__name__})
    return result
