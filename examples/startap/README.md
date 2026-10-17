# Star Tap 示例：怎么跑

实测结果和做法要点见 [RESULT.md](RESULT.md)。整个流程只用一份配置 [wxslim.json](wxslim.json)（方案二，去敏示例路径）。

```
# 1. 生成音频（WAV，程序合成）
node tools/gen-audio.mjs game/audio

# 2. 测试服务（改 game/scripts/net.gd 的 DEFAULT_SERVER 指向它）
cd server && npm install && node server.mjs          # 默认 0.0.0.0:8888；HOST / PORT / DATA_DIR 可用环境变量改
cd ..

# 3. 电脑上自动测一局
godot --headless --editor --path game --import
godot --path game -- --server=http://127.0.0.1:8888 --qa-play=3d --qa-quit

# 4. 配置：改 wxslim.json 里的 trim.work 等路径；在同目录新建 wxslim.private.json（不进仓库）：
#    {"game": {"appidFrom": "<已有小游戏工程>"}, "split": {"privateKeyPath": "<私钥 PEM 绝对路径>"}}
node ../../wxslim.mjs config --config wxslim.json

# 5. 裁剪（可选）。trim.config.json 是本例 balanced 的扫描结果（要重新扫描先删掉它，或改 trim.config）
node ../../trim/trim.mjs profile --config wxslim.json
node ../../trim/trim.mjs build --config wxslim.json                  # 编译到 trim.work，lto=thin

# 6. 导出 PCK，转换成小游戏（engine.fromTrim：用 <trim.work>/artifacts）
godot --headless --path game --export-pack "Web" build/startap.pck
node ../../convert/convert.mjs convert --config wxslim.json          # 输出到 out/convert
node ../../convert/convert.mjs verify --config wxslim.json

# 7. 分包（方案二）。init、preview 前先确认
node ../../split/kit.mjs split init --config wxslim.json
node ../../split/kit.mjs collect-pack --config wxslim.json --from out/convert/minigame --out collect-B --label STAR_B_COLLECT_01
node ../../split/kit.mjs preview --config wxslim.json --project collect-B      # 手机上：改名、登录、登出、点 2D/3D 各几次
node ../../split/kit.mjs split release --config wxslim.json
node ../../split/kit.mjs assemble --config wxslim.json --from out/convert/minigame --out release-B --label STAR_B_RELEASE_01
node ../../split/kit.mjs verify --config wxslim.json --project release-B
node ../../split/kit.mjs preview --config wxslim.json --project release-B
```

方案一（标题+2D 首包、3D 余包）：把 `wxslim.json` 的 `game.interfaces` 换成 `./wx/demowx.js`、`split.projectName` 换成 `Star Tap A`。不用云日志就保持 `split.cloud.env` 为 `null`；要用时把云环境 ID 写进 `wxslim.private.json` 的 `split.cloud.env`。

**旧写法（兼容）**：`planA.kit.json` / `planB.kit.json` 仍可直接给 split 用（私钥路径、CLI 路径、PCK 路径要换成自己的）；convert、trim 也可以逐个写参数：

```
node ../../convert/convert.mjs convert --js <artifacts>/godot.js --wasm <artifacts>/godot.wasm --symbols <artifacts>/godot.js.symbols \
  --pck build/startap.pck --interfaces wx/demowx-gate2d.js --appid-from <已有小游戏工程> --name startap --out work
node ../../trim/trim.mjs build --config trim.config.json --work D:/wasm-build/startap --lto thin
node ../../split/kit.mjs assemble --config planB.kit.json --from work/minigame --out release-B --label STAR_B_RELEASE_01
```
