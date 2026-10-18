# 配套 Local Console

此目录保存 Windows 发行包使用的 Local Console 0.12.3 组件，首次导入自本机已安装版本（2026-10-18）。`src` 为服务源码，`dist` 为实际交付的 Web 管理前端；依赖锁和 Node 校验清单随组件一起版本控制。前端当前以发行产物形式维护，此目录不包含其独立前端开发工程。

账号、配对信息、安装路径和运行数据库不在此目录。Gateway 与 Android 的权威源码仍在仓库原目录。

`installer/build-release.py` 默认读取这里的组件内容。`--console-dir` 可显式选择另一份组件；`--console-runtime-dir` 只提供已安装的 npm 依赖和 Node 缓存。打包时逐项校验生产依赖版本以及 Node 文件完整性，不从安装目录覆盖本目录的源码或前端。

升级此组件时一起更新源码、前端、包元数据、依赖锁与 Node 清单，并核对管理桥接口。仓库提交由此能够确定所交付的组件内容；无需在项目中再复制 node_modules 和 Node 二进制。
