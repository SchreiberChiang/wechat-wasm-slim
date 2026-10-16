# 云日志（可选）

手机上的中文汇总日志会通过云函数 `phoneLogIngest` 写入云数据库集合 `phone_log_batches`，电脑上用 `split/kit.mjs logs` 读取。不用云日志也行：手机 vConsole 里一样能看到这些汇总行。

部署：
1. 小游戏后台开通云开发，新建环境（可能产生费用）。
2. 把 `phoneLogIngest/relay-config.json` 里的 appid 改成你的 AppID。
3. 微信开发者工具里，把 `phoneLogIngest` 目录作为云函数上传并部署（安装云端依赖）。
4. 云数据库新建集合 `phone_log_batches`。
5. 在分包配置里填 `cloud.env`（环境 ID）。

安全：云函数只接受本 AppID 的调用，用服务端身份校验，不信任客户端传入的 OpenID；每批最多 24 条、单条不超过 4096 字。
