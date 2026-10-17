# Star Tap 示例：怎么跑

实测结果和做法要点见 [RESULT.md](RESULT.md)。

```
# 1. 生成音频（WAV，程序合成）
node tools/gen-audio.mjs game/audio

# 2. 测试服务（改 game/scripts/net.gd 的 DEFAULT_SERVER 指向它）
cd server && npm install && node server.mjs          # 默认 0.0.0.0:8888；HOST / PORT / DATA_DIR 可用环境变量改
cd ..

# 3. 电脑上自动测一局
godot --headless --editor --path game --import
godot --path game -- --server=http://127.0.0.1:8888 --qa-play=3d --qa-quit

# 4. 导出 PCK，转换成小游戏（引擎用 trim 编出的 artifacts）
godot --headless --path game --export-pack "Web" build/startap.pck
node ../../convert/convert.mjs convert --js <artifacts>/godot.js --wasm <artifacts>/godot.wasm --symbols <artifacts>/godot.js.symbols \
  --pck build/startap.pck --interfaces wx/demowx-gate2d.js --appid-from <已有小游戏工程> --name startap --out work

# 5. 裁剪（可选，先于第 4 步）
node ../../trim/trim.mjs scan --project game --out my.trim.json      # trim.config.json 是本例 balanced 的扫描结果
node ../../trim/trim.mjs build --config my.trim.json --work D:/wasm-build/startap --lto thin

# 6. 分包（方案二；方案一用 planA.kit.json + wx/demowx.js）。init、preview 前先确认
node ../../split/kit.mjs split init --config planB.kit.json
node ../../split/kit.mjs collect-pack --config planB.kit.json --from work/minigame --out collect-B --label STAR_B_COLLECT_01
node ../../split/kit.mjs preview --config planB.kit.json --project collect-B      # 手机上：改名、登录、登出、点 2D/3D 各几次
node ../../split/kit.mjs split release --config planB.kit.json
node ../../split/kit.mjs assemble --config planB.kit.json --from work/minigame --out release-B --label STAR_B_RELEASE_01
node ../../split/kit.mjs verify --config planB.kit.json --project release-B
node ../../split/kit.mjs preview --config planB.kit.json --project release-B
```

`planA.kit.json` / `planB.kit.json` 里的私钥路径、CLI 路径、PCK 路径要换成自己的；不用云日志就保持 `cloud.env` 为 `null`。
