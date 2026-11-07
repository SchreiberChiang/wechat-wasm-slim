// Pure pinned two-file source preparation; no filesystem/platform/engine execution.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
export const LIFECYCLE_JS='platform/web/js/libs/library_godot_display.js';
export const LIFECYCLE_CPP='platform/web/display_server_web.cpp';
export const LIFECYCLE_INPUTS=Object.freeze({
  [LIFECYCLE_JS]:Object.freeze({bytes:26928,sha256:'f1ddd92cff6b7fae79eac3c41007fdab9b4aa9c29513024fa1799427e5518aa5'}),
  [LIFECYCLE_CPP]:Object.freeze({bytes:49864,sha256:'e462b18a1f8f5be4e6b40c82fb549b93de78239387db1c30f7aac89f3a665eaa'}),
});
export const lifecyclePin=b=>({bytes:Buffer.byteLength(b),sha256:createHash('sha256').update(b).digest('hex')});
let parser;
export function lifecycleMembers(text){
  if(!parser){const m={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:m,exports:m.exports});parser=m.exports;}
  const ast=parser.parse(text,{ecmaVersion:2022}),out=new Map(),key=n=>n.key.name??n.key.value;
  function add(nodes,p){for(const n of nodes){const name=p+'.'+key(n);assert(!out.has(name),'LIFECYCLE_DUPLICATE_MEMBER');out.set(name,n);if(n.type==='Property'&&n.value.type==='ObjectExpression')add(n.value.properties,name);}}
  for(const n of ast.body)if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.init?.type==='ObjectExpression')add(d.init.properties,d.id.name);
  return out;
}
const canonical=n=>JSON.stringify(n,(k,v)=>['start','end','raw','loc','range'].includes(k)?undefined:v);
function once(s,a,b){assert.equal(s.split(a).length,2,'LIFECYCLE_UNIQUE_ANCHOR');return s.replace(a,()=>b);}
const members=`
        wechatLifecycle: null,
        closeWechatLifecycle: function (session) {
            if (!session) return;
            if (session.cleanupFailed) throw session.cleanupError;
            if (session.closing) throw new Error("GODOT_LIFECYCLE_CLEANUP_IN_PROGRESS");
            if (session.closed) return;
            // Retire callbacks before any potentially reentrant host cleanup.
            session.closed = true;
            session.ready = false;
            session.closing = true;
            const attempt = (operation) => {
                try { operation(); } catch (error) { session.cleanupErrors.push(error); }
            };
            if (session.hideAttempted) attempt(() => session.host.offHide(session.hide));
            if (session.showAttempted) attempt(() => session.host.offShow(session.show));
            session.closing = false;
            if (session.cleanupErrors.length) {
                session.cleanupFailed = true;
                session.cleanupError = session.cleanupErrors[0];
                throw session.cleanupError;
            }
        },
        initWechatLifecycle: function (notify) {
            if (typeof GameGlobal === "undefined" || GameGlobal === null || typeof wx === "undefined" || wx === null || typeof wx.getSystemInfoSync !== "function") return;
            const previous = GodotDisplay.wechatLifecycle;
            if (previous) GodotDisplay.closeWechatLifecycle(previous);
            const host = wx;
            if (["onHide", "offHide", "onShow", "offShow"].some((name) => typeof host[name] !== "function")) {
                throw new Error("GODOT_LIFECYCLE_API_REQUIRED");
            }
            const session = { host, closed:false, closing:false, ready:false, state:"UNCONFIRMED",
                startupEventObserved:false, hideAttempted:false, showAttempted:false,
                registrationFailed:false, registrationError:null, cleanupFailed:false,
                cleanupError:null, cleanupErrors:[], cleanupLogAttempted:false,
                loggingFailure:false, loggingErrors:[] };
            GodotDisplay.wechatLifecycle = session;
            const observe = (background) => {
                if (GodotDisplay.wechatLifecycle !== session || session.closed) return;
                if (!session.ready) { session.startupEventObserved = true; return; }
                if (background) {
                    if (session.state === "BACKGROUND") return;
                    session.state = "BACKGROUND";
                    notify(2015); // Attempt only: void ABI does not acknowledge native receipt.
                } else {
                    const resumed = session.state === "BACKGROUND";
                    session.state = "FOREGROUND";
                    if (resumed) notify(2014);
                }
            };
            session.hide = () => observe(true);
            session.show = () => observe(false);
            try {
                GodotOS.atexit(function (resolve) {
                    try { GodotDisplay.closeWechatLifecycle(session); }
                    catch (error) {
                        // This hook must not reject Promise.all in existing finish_async:
                        // that would skip the final FS sync. Cleanup remains failed/latched.
                        if (!session.cleanupLogAttempted) {
                            session.cleanupLogAttempted = true;
                            const causes = session.cleanupErrors.length ? session.cleanupErrors : [error];
                            for (let i = 0; i < Math.min(2, causes.length); i++) {
                                try { console.error("GODOT_WECHAT_LIFECYCLE_CLEANUP_FAILED", causes[i]); }
                                catch (loggingError) { session.loggingFailure = true; session.loggingErrors.push(loggingError); }
                            }
                        }
                    } finally { resolve(); }
                });
                session.hideAttempted = true;
                host.onHide(session.hide);
                if (GodotDisplay.wechatLifecycle !== session || session.closed) return;
                session.showAttempted = true;
                host.onShow(session.show);
                if (GodotDisplay.wechatLifecycle !== session || session.closed) return;
                session.ready = true;
            } catch (error) {
                session.registrationFailed = true;
                session.registrationError = error;
                try { GodotDisplay.closeWechatLifecycle(session); }
                catch (_) { /* all cleanup failures retained separately; original throw wins */ }
                throw error;
            }
        },
`;
const cppBlock=`#ifdef WECHAT_GLX_EXPERIMENTAL
    if (p_notification == MainLoop::NOTIFICATION_APPLICATION_PAUSED || p_notification == MainLoop::NOTIFICATION_APPLICATION_RESUMED) {
        OS_Web *os = OS_Web::get_singleton();
        MainLoop *main_loop = os ? os->get_main_loop() : nullptr;
        if (!main_loop) {
            WARN_PRINT_ONCE("GODOT_WECHAT_LIFECYCLE_MAIN_LOOP_NOT_READY");
            return;
        }
        main_loop->notification(p_notification);
        return;
    }
#endif
`;
export function prepareOfficialLifecycleNotifications(inputs){
  assert(inputs instanceof Map&&inputs.size===2,'LIFECYCLE_EXACT_INPUTS');
  for(const [name,pin]of Object.entries(LIFECYCLE_INPUTS)){const b=inputs.get(name);assert(Buffer.isBuffer(b),'LIFECYCLE_BUFFER');assert.deepEqual(lifecyclePin(b),pin,'LIFECYCLE_FIXED_SOURCE '+name);assert(Buffer.from(b.toString('utf8')).equals(b),'LIFECYCLE_UTF8');}
  const before=inputs.get(LIFECYCLE_JS).toString(),inventory=lifecycleMembers(before);
  let js=once(before,"'$GodotDisplayScreen', '$GodotDisplayVK'],","'$GodotDisplayScreen', '$GodotDisplayVK', '$GodotOS'],");
  js=once(js,"\t\twindow_icon: '',","\t\twindow_icon: '',"+members);
  const n=inventory.get('GodotDisplay.godot_js_display_notification_cb').value,body=before.slice(n.body.start,n.body.end);
  js=once(js,body,body.slice(0,-1)+'\tGodotDisplay.initWechatLifecycle(func);\n\t}');
  const after=lifecycleMembers(js),changed=new Set(['GodotDisplay.$GodotDisplay__deps','GodotDisplay.godot_js_display_notification_cb']);
  for(const [name,node]of inventory){if(node.value?.type==='ObjectExpression'||changed.has(name))continue;assert.equal(canonical(after.get(name)),canonical(node),'LIFECYCLE_UNRELATED_JS_CHANGED '+name);}
  const cpp=inputs.get(LIFECYCLE_CPP).toString(),anchor='\tif (p_notification == DisplayServerEnums::WINDOW_EVENT_MOUSE_ENTER || p_notification == DisplayServerEnums::WINDOW_EVENT_MOUSE_EXIT) {';
  const out=once(cpp,anchor,cppBlock+anchor);
  const sources=new Map([[LIFECYCLE_JS,Buffer.from(js)],[LIFECYCLE_CPP,Buffer.from(out)]]);
  return {sources,receipt:{schema:'wxslim-official-lifecycle-notifications-v1',status:'SOURCE_ONLY_NOT_APPLIED',inputs:LIFECYCLE_INPUTS,outputs:Object.fromEntries([...sources].map(([name,b])=>[name,lifecyclePin(b)])),
    changedExistingMembers:[...changed],addedMembers:['wechatLifecycle','closeWechatLifecycle','initWechatLifecycle'],explicitNewDependency:'$GodotOS',productionABI:'existing godot_js_display_notification_cb viiiii and callback(int), unchanged',domPath:'ORIGINAL_FOUR_EVENT_REGISTRATION_PRESERVED',nativeCodes:{paused:2015,resumed:2014},nativeScope:'WECHAT_GLX_EXPERIMENTAL only; main-loop guard before IME/window handling',
    atexitFailurePolicy:'Cleanup stays failed and blocks re-registration; log fixed code plus actual cause at most twice, retain logging failures, finally resolve so this hook cannot block existing final FS sync. Initialization still throws original errors.',
    limitations:['Registration-period callbacks are ignored for notification state; no replay or synthesis','Initial show only establishes foreground; first post-registration hide may attempt pause','Void callback has no native delivery acknowledgement; main-loop-not-ready drops event with fixed warning','No SceneTree pause policy, focus/blur synthesis, audio resume/replay/context recreation or OS finish_async changes'],engineExecuted:false,platformExecuted:false,build:'NOT_RUN',runtime:'NOT_RUN'}};
}
