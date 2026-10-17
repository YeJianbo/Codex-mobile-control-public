# Android 0.6.139/code162 / Gateway 0.6.50

目标栏标题、耗时和状态按文字基线对齐，统一行高并去掉额外字体留白，图标保持居中。折叠和展开状态均检查实际文字基线。文件汇总与展开列表中新增行数使用绿色、删除行数使用红色，并适配深色模式。

置顶操作原本写入 thread_section_id，但列表仍使用旧 JSON 缓存及 is_pinned，导致刷新后状态回退。现在以可读的当前分组数据为准，旧版本缺少该列时保留兼容读取；取消置顶会清除缓存 ThreadRecord 的旧状态。Android 同步更新展开项目中的会话缓存。

Node 254/254、Web 52/52、JVM 181/181、原生定向 12/12 通过；lint 0 errors / 25 warnings。

额外启动隔离的真实 Codex app-server，创建空会话后执行置顶和取消置顶，分别加入相反的旧 JSON 缓存，确认读取结果仍正确。测试没有发送 turn 或调用模型，没有修改生产会话。

首次 Web 验证退出 1，原因是新增文件汇总局部变量与既有 summary 重名，浏览器报 Identifier summary has already been declared；重命名、通过语法检查后完整复验，保留首次日志。

正常 release 与隔离测试 APK 构建、原签名、模拟器截图均已检查。置顶服务端修复需要同步更新 Gateway 0.6.50。未部署生产服务、未安装实体手机、未调用付费模型；完整原生矩阵本轮未重跑。日志位于 artifacts/interaction-0.6.139/。
