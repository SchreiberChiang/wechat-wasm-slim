# 局部不透明视口 alpha 兼容候选

从 `../glx-case4-alpha-mix` 的自有源拆出，沿用 `renderer_round3.gd`、`renderer_base.gd`、bridge、原第3项；移除四模式诊断扩展，只新增第4项左侧局部兼容。无字体/引擎/作者资产二进制，无 AppID。

`renderer.gd` 的 `ENABLE_ANDROID_GLX_OPAQUE_COMPAT=true` 是独立候选显式开关。必须同时满足 cached bridge 的 `actualMode=glx`、`modeEvidence=observed` 与缓存device字段确认安卓：若device.platform字段存在，只接受精确小写android；该字段缺失时，严格匹配device.system的Android+数字版本（例如Android 10或Android10）。缓存来自既有wx.getSystemInfoSync结果，不新增API查询。iOS、WebGL、缺系统或伪Android字符串拒绝。resultTrack可保留unknown，绝不改写为android；snapshot.platformEvidence记录实际判断来源。

`opaque_viewport_compat.gd` 仅接受显式注册的非透明 SubViewport 的原始 ViewportTexture、普通 TextureRect（get_script()必须为空，明确排除GDScript自定义子类）、无已有/父材质。帧绘制前复核，纹理改源、源变透明或材质变化时只撤掉自己仍持有的材质，不覆盖外部新材质。切回同一允许源可恢复。NinePatch、其他纹理/透明源不启用。不要将这个 allow-list 当通用资源自动分类器。

shader 为 MIX；vertex 保存采样前 UI/父节点 alpha；fragment 保留默认一次采样所得 RGB，仅将 alpha 恢复为该 UI alpha。Canvas 调制仍由引擎后续处理。本候选不是附件写入/采样根因补丁，不修第3项。

## 电脑复现

使用 Godot 4.7.2 原生编辑器。先将本目录复制到一个新的私有目录 `$work`（不要在基线上导入）。字体可按原 `build_font.py` 运行，要求 fontTools 4.60.0 与源码内固定 SHA 的 Noto Sans SC 2.002；输出另一个新目录，再将生成的 AcceptanceCJK.otf/FONT.json 复制到 `$work/fonts/`。字体和截图保持 `.local`，不进入 Git。候选中文变化后须重新生成子集，不能靠旧覆盖记录认证新文本。

```powershell
& $python "$work/build_font.py" --source $auditedSourceFont --output $newFontDir
Copy-Item "$newFontDir/*" "$work/fonts"
# GUI exe 在自动化中用 Start-Process -WindowStyle Hidden -PassThru，重定向stdout/stderr并等待退出。
& $godot --headless --path $work --editor --import --quit
& $godot --path $work --script res://compat_verify.gd -- "--out=$newNativeEvidenceDir"
& $godot --headless --path $work --export-pack Web "$newPckPath"
node engine/opaque-viewport-compat/audit.mjs $newPckPath
```

`compat_verify.gd` 是外部原生测试，导出排除。运行时只在测试里注入模拟 Android GLX 上下文；不会把注入值当实际平台证据。其测试源包括普通不透明2D视口与显式blend_disabled写低alpha的人工fixture，后者用于证明UI alpha保留，不是手机故障复现。另保留原生3D源页面的默认关闭及注入门禁截图。

通过范围：原生shader编译/图形绘制、UI/父alpha、裁剪、门禁、撤销、源/PCK审计。手机和实际微信WebGL未执行。无需重编JS/WASM；后续独立宿主应复用冻结父包、只替换导出的场景PCK，由外层组合/身份流程另行处理。这里未修改预热。

补充小型门禁：`compat_gate_verify.gd` 使用原生headless单独检查脚本子类与状态保留，调用 `--script res://compat_gate_verify.gd -- --out=<new-result.json>`。此输出为新的JSON文件路径，区别于图形harness的新目录；同样导出排除。
