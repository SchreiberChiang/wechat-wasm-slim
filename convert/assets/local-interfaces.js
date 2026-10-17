/* 游戏自己的 JS 接口放这里（在 Godot callMain 之前加载）。
 * GDScript 里用 JavaScriptBridge.get_interface("名字") 取到的全局对象，就在这个文件里挂到 GameGlobal / window 上。
 * convert 默认生成这个空文件；用 --interfaces <文件> 可以换成游戏自己的实现。
 * split 工具的训练等待门默认也追加在这个文件末尾（配置项 trainingGateHost）。
 */
