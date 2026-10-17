# 2026-10-16 Android 0.6.380 / 统一 Codex 重启

版本0.6.380/352：连接页、执行器管理和维护页使用同一重启流程；预览提示按桌面端实际运行状态区分桌面+CLI或仅CLI。纯远程重启不会打开桌面端，移除维护页旧的桌面单独重启按钮。等待时间覆盖桌面启动。assembleRelease通过，包名及签名保持，已更新三个APK入口并验证HTTPS下载；未在实体手机上执行重启。

# 2026-10-16 Gateway / 压缩摘要里的字面引用标签

BunCloud截图已核对原始记录：摘要9767字，保存后的压缩载荷9688字，差异来自摘要里字面量未闭合引用标签导致原生截断。网关匹配现在兼容该截断，并把完整原摘要放回压缩记录，避免正文残留；没有按标题或关键词删除普通回复。实时明确压缩窗口内的生成文字只在压缩记录完成时提供，不再作为正文流出；其他会话及压缩后的回复照常显示。

编译退出0，专项3/3通过。真实固定源样本只移除1条内部摘要，其他6条消息内容/顺序一致；折叠保留完整9767字。部署后真实会话HTTP200，正文摘要数量为0、折叠摘要9767字。仅部署两个网关模块并重启网关，共享后端与Web保持，未发送测试消息或手工恢复原会话。

Android沿用0.6.379/351，无需更新APK；补齐折叠内原文后，旧版客户端也能匹配其已收到的实时副本。未在实体手机复测；待验：BunCloud同步历史后摘要仅在上下文已自动压缩折叠内，后续正常回复不丢失。源码备份D:/codex/backups/Codex-mobile-control/before-compaction-citation-20261016；证据D:/codex/build/Codex-mobile-control下compaction-*和deploy-compaction-citation*。

# 2026-10-16 Gateway / 重复审批通知与运行中继续目标

截图待确认已核对：同一命令的原生记录已accepted，桌面桥副本仍pending。网关现在识别同一操作的直接/桥接副本，避免重复建单、回应和通知；自动审批开启时不发布手动审批提醒，失败记录仍可在待处理列表查看，需要用户填写的问题保持原交互。旧副本在本次启动的既有过期处理后读回expired，原生记录仍accepted，已不再pending；不宣称此次实际调用了批准。

运行中点继续现在可以恢复目标调度，不再由网关以任务仍在运行400拦截；不发送另一轮用户消息或turn/start。已经active且后端运行时幂等确认，预算耗尽、启动互斥与不确定回执规则保持。编译通过，目标15项及审批4项检查通过。首轮发现重复激活的1项失败已修正并重验目标15项通过。

已备份并部署两个网关模块，仅重启网关，共享后端和Web保持；真实审批状态、健康与13个桌面订阅已读回。Android沿用0.6.379/351，无需下载新包。未操作用户手机；待验：旧卡片同步后不再出现待确认按钮；自动审批不再弹手动确认通知；运行中恢复暂停目标不再报网关400。

备份D:/codex/backups/Codex-mobile-control/before-approval-goal-20261016；证据D:/codex/build/Codex-mobile-control下approval-click-live-*、approval-goal-*、deploy-approval-goal*。

# 2026-10-16 Android 0.6.379 / WebSocket 回调不再等待界面消费

GatewayClient打开、普通消息、关闭和失败回调统一改为非阻塞事件投递，保留256条有界缓冲。旧trySendBlocking在界面消费变慢、队列满后会阻塞OkHttp读取线程，连后续探测回包也无法及时读取；现connection.pong仍直接确认，不经过界面队列。缓冲满则关闭事件流，走原重连和历史/审批/队列/提交回执恢复；取消监听清理所属连接。没有改变连接探测超时、Fast设置或消息重发策略。

Release源码编译成功，SocketEventsTest 3/3通过，覆盖界面暂停期间128条事件后读取回调仍继续、恢复消费后顺序完整、有界溢出触发同步、取消只关闭一次。assembleRelease 2m29s成功。版本0.6.379/351，APK 3100980字节，应用ID及签名身份保持；aapt/元数据/DEX标识和实际HTTPS下载均已核对，三个交付入口逐字节一致。未重启网关/共享后端，未操作实体手机或NekoBox模拟器。

实体手机待验：覆盖安装379，在长会话持续输出期间切到后台再返回，观察连接与发送状态；正常应保持会话继续接收，真断网后应补齐历史。本轮验证的是导致回包延后的具体阻塞机制，未取得实体手机误断连现场，不认定所有卡顿都已解决。源码及378 APK备份D:/codex/backups/Codex-mobile-control/before-socket-inbox-20261016；交付D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.379.apk；证据D:/codex/build/Codex-mobile-control的android-0.6.379-*、deliver379.log与SocketEventsTest XML。

# 2026-10-16 Gateway / 会话列表合并开销

网关会话列表改用一次构建的标题/置顶/活跃查找表，减少每条会话的重复线性查找；项目侧栏的数据读取与目录检查并行。保留原会话名称、排序、子代理、归档与活跃占位规则。固定5000条桌面会话的新旧输出4956条全部字段和顺序一致；后6次读取上中位数182.22→163.69ms。Server构建和侧栏相关10项检查通过。

已备份并部署两个网关模块，仅重启网关，共享后端与Web保持。真实最近会话接口HTTP200，69条、26677字节；首次264→262ms、重复101→78ms。首次没有明显改善，本轮不据此认定手机断联解决。容量重试已连接并订阅13个桌面会话。Android沿用0.6.378/350，无需更新APK；实体手机未验证。手机待验：打开最近/项目侧栏并切换会话，名称、置顶和子代理树应保持正确。

备份D:/codex/backups/Codex-mobile-control/before-sidebar-merge-20261016；证据D:/codex/build/Codex-mobile-control下sidebar-merge-*、sidebar-latency-live-*和deploy-sidebar-merge*。

# 2026-10-16 Gateway / 健康状态与进程采样并行

健康管理继续减少首次等待：CLI状态和进程/内存采样原先串行，现在同时执行，全部完成后返回完整结果；没有让手机先拿不完整状态，也无需新增轮询。分段计时原CLI健康3748ms、系统采样2156ms。部署后的真实首次GET /api/agents/health为3441.4ms（上一轮5685.72ms），热读49.97ms，均HTTP200，7个助手版本与状态完整。

Server编译退出0，健康专项4/4通过。已备份并部署index与agentHealthMonitor两个模块，逐字节核对安装产物；仅重启网关，共享后端URL/token/PID与Web PID10616保持。容量重试开启且已连接，13个桌面订阅恢复，无测试消息。Android沿用0.6.378/350，无本轮APK或设备操作。手机待验：进入健康管理，运行状态、版本与内存应正常显示，再次进入应复用查询结果。本机接口时延不等同手机链路时延。

备份D:/codex/backups/Codex-mobile-control/before-health-parallel-20261016；证据D:/codex/build/Codex-mobile-control下health-timing-before.json、health-parallel-*与deploy-health-parallel*。

# 2026-10-16 Gateway / 健康检查与模型目录解耦

健康管理首次打开和显式刷新不再等待完整模型目录或ACP探测，改为独立并发发现本地CLI并查询--version。版本缓存按助手与命令路径隔离，并发查询共享；版本等待结束后重新取得实时任务状态，保留启用/公网限制与已知协议错误。未读目录时modelCount=null，现有Android解析已兼容。

Server编译退出0，agent-health专项3/3通过。已备份并部署单个agentSessions编译模块，仅重启网关；安装产物逐字节核对通过，共享后端URL/token/PID及Web PID10616保持。真实本机首次健康请求由19650.18ms降至5685.72ms，再次读取48ms，均HTTP200。首次仍等待CLI版本查询。容量重试开启、已连接并订阅13个桌面会话；未注入测试消息或制造真实容量错误。

Android沿用0.6.378/350，本轮无需新APK，未操作设备。手机待验：进入健康管理应正常显示版本与运行数，再次进入复用查询结果。备份D:/codex/backups/Codex-mobile-control/before-health-discovery-20261016；构建、3项检查、前后请求和部署证据在D:/codex/build/Codex-mobile-control的health-discovery-*及deploy-health-discovery*文件。

# 2026-10-16 Gateway / 历史图片与输出附件读取优化

继续排查未覆盖的主线程历史读取：用户消息、助手输出和嵌入图片byID原先仍从日志头逐行计数；history-image还可能为元数据和嵌入fallback各扫一次。现原文单行定位复用上一轮物理行偏移扫描器，公开byID helper进入既有历史worker，保留原调用兼容并支持AbortSignal；输出附件统一解析助手消息或图片操作，避免失败后再次扫描。图片一次取得元数据并选择合法本地文件或既有嵌入fallback，保持本地优先、项目范围、temp剪贴板例外、原尺寸/MIME与20MiB限制，不缓存整份原日志。worker回到主线程后恢复真正Buffer视图，避免Fastify把Uint8Array发成JSON；断开/预取消与多tab共享等待沿用既有机制。

Server编译退出0。唯一集中回归通过：真实production worker及编译GET handler验证PNG字节/MIME/Buffer和Fastify二进制、图片单行仅1次打开/1次JSON解析、12,586,621B样本从8,388,608偏移读取、超长目标行保持完整、本地优先/合法fallback/非法与超20MiB拒绝，以及预取消/共享取消。共用压缩读取路径的既有compressed-usage 9/9通过。首次测试命令因Windows --import路径缺少file URL退出1，修正命令为file:///后成功，未据此修改产品源码。

对真实原会话做了两次只读GET，不注入消息或手工resume：上一张历史截图同一eventId，旧接口HTTP 200、image/png、148239字节，5416.15ms；部署后HTTP 200、同MIME/长度，224.11ms。前后返回与原日志内嵌PNG逐字节相等。这是这张图的本机单次前后结果，不外推为所有图片/手机网络的时延；原1.7GB级日志保持原样。原生压缩日志保持原解压规则，未声称压缩流也有普通文件相同的随机定位速度。

已备份并部署index/codexSessions/historyWorker三个编译模块，安装文件逐字节核对通过，仅重启网关；Web PID10616、共享端点URL/token及后端PID保持。健康正常，capacity开启并恢复13个桌面会话订阅，未观察到新容量错误触发，不伪称已真实重试成功。Android沿用0.6.378/350，无新APK或设备操作。实体手机待验：打开该旧图及历史回复里的文件链接，应返回原图片/原文件；连续切换会话后不应显示上一会话内容。未连接实体手机，未操作用户NekoBox模拟器。

备份D:/codex/backups/Codex-mobile-control/before-history-media-perf-20261016。证据D:/codex/build/Codex-mobile-control/history-media-perf下server-build.log、regression.log、compressed-usage.log、live-image.json、live-before.json、live-after.json、gateway-health.json，部署记录同build根目录deploy-history-media-perf.log及文件清单。保留原图校验输入live-original.png与复现脚本，仅清理相同的两份HTTP响应图片副本；未删除用户原图或日志。

# 2026-10-16 Gateway / 操作详情批量读取与统计重复计算优化

上一轮Fast分组已交付；本轮继续多会话卡顿。运行中接口一次只读采样：health42ms、Codex状态103ms、健康管理1477ms；热读分别2/2/3ms。月度速度统计98ms。由此没有证明所有会话断联的共同根因；确认并修复以下两条具体热路径。

操作详情原先逐eventId调用主线程readCodexThreadLineById，每条都从日志开头计行；一个请求最多100个ID，且主线程没有历史worker持有的缓存。现在单个或批量详情统一进入既有worker，同请求合并；先复用该worker的历史缓存，未命中按文件/物理行分组、利用稀疏偏移索引一次扫描，再还原输入顺序、重复ID和缺失null。HTTP断开传取消信号，预取消不排读取，同请求另一tab仍等待时不受取消影响；保持未展开不加载。索引点可能落在长UTF-8 JSON行中，beforeLine从前一物理行之前定位，保留目标整行。缺少索引的首次读取仍可能扫描前缀；没有实测真实1.7GB主会话的展开耗时。

速度统计增加COALESCE时间表达式索引，查询计划从SCAN items改为SEARCH items USING INDEX items_timestamp；同条件汇总最多复用5秒，worker提交或同连接写入后立即失效，范围/模型独立，进度和来源可用状态始终返回最新。固定7302样本的8次月度汇总由693.28ms变108.67ms，首次108.30ms，随后0.03–0.15ms；与原实现全部字段逐项相同。该结果为固定本机数据对照，不代表手机网络延迟或首次读取显著变快。

Web/Server编译退出0；现有worker与新增缓存状态检查共5项通过，后续可用状态调整只重跑1个受影响用例通过。操作详情唯一热路径回归通过：12,583,496字节隔离样本，5个乱序/重复/缺失ID仅1个stream，从8,388,608起读4,194,888字节，缓存命中0次打开日志；长行边界、同请求共享和取消均通过。等价比较工具首轮因Windows ESM绝对路径缺少file URL退出1，修正导入后退出0，allFieldsEqual=true。代理首次编译多写泛型结束符，修正后最终编译通过。

已部署4个网关模块和1个Web源模块，安装文件逐字节核对通过；仅重启网关与Web，共享端点URL/token及后端PID保持，未给真实会话注入消息或手工resume。实际读回health正常、未知详情ID返回404/5ms、容量重试开启并恢复13个桌面会话订阅。月度统计本机HTTP首次159.65ms、重复6.12ms，均7307样本，Fast/标准分组保留。Android沿用0.6.378，无新APK或设备操作。手机待验：在同一历史轮展开多个操作后收起、切换会话再返回，应正常显示详情，未展开内容不加载；本轮不据此宣称实体机卡顿已全部消除。

备份D:/codex/backups/Codex-mobile-control/before-activity-history-perf-20261016与before-native-speed-cache-20261016。证据D:/codex/build/Codex-mobile-control下activity-history-perf/server-build.log、activity-history-perf/batch-regression.log、native-speed-cache-build.log、native-speed-cache-check.log、native-speed-cache-state-check.log、native-speed-summary-before.json、native-speed-summary-after.json、native-speed-summary-equivalence.json、deploy-activity-history-perf.log、activity-history-perf-live.json。固定计量快照与复现脚本保留；只清理该测量的可重建前后临时DB副本。

# 2026-10-16 Web / Android 0.6.378：Fast 与标准模式速度分组

截图08:36:44的Codex控制台样本已核对原生用量事件与速度缓存：gpt-6.1-sol、standard，57个估算文本Token/323ms=176.47 Token/s；不是Fast。短回复的单条速率不能用来判断速度模式。原先速度缓存未保存tier，确实把同模型的Fast、标准和未记录模式混算。

原生速度缓存新增可空tier列，以同轮原生事件的历史模式回填；priority/fast统一Fast，default/standard统一标准，缺失保持未知，不按当前开关或当前模型反推。短回复晚于该轮最后用量事件完成时，允许使用同一轮最后已知元数据补归属；仍不跨轮。按模型、提供商和模式分组，同会话不同模式分开计量；Web显示模式标签，展开/滚动/焦点按模型+模式保留，表格仍按需生成。历史回填只写新信息并按会话事务提交，避免未知模式反复空写。HTTP工作台请求使用响应实际返回的service_tier记录；旧请求或响应未返回时保持未记录，不以请求期望代替实际返回。

手机统计API透传组和最近请求tier；安卓模型标题显示Fast/标准/模式未记录，展开状态key加入tier，保留每批30条分页。版本0.6.378/350。没有改Fast开关或真实会话设置，没有发测试消息。

Web与Server构建退出0，Android Release 8m24s成功。28项速度/worker/DOM/HTTP专项通过；首轮退出1，router聚合未携带source导致面板误用原生默认来源，补source=router后28项通过。回填事务优化后仅重跑受影响worker4项，通过。已部署Web源/静态资源和mobileStatistics模块，安装逐字节核对通过；共享后端URL/token及PID保持。后续只重启Web加载回填优化，网关PID40520保持；容量重试仍开启、桌面订阅11个。真实API与浏览器均看到同一模型按Fast/标准/未知独立统计，浏览器1280宽页面1265无横溢出，截图speed-tier-live.png；临时页已关闭。索引为后台增量更新，活跃会话继续写日志时可能再次显示索引进度。

APK 3,100,980字节，aapt及元数据确认为350/0.6.378；D盘交付、仓库及安装网关下载入口与实际HTTPS下载逐字节一致。原377包已备份，只清理内容相同的旧交付重复包；未安装/操作用户设备。实体手机待验：更新378后进入统计→Token速度，预期同模型的Fast与标准各列一组；切换/刷新后展开状态独立；缺失模式的历史不能被归到标准。

备份：D:/codex/backups/Codex-mobile-control/before-speed-tier-20261016（含原生速度缓存一致快照、Web/Android/Server源文件、安装产物、377 APK）。证据：D:/codex/build/Codex-mobile-control下speed-tier-screenshot-evidence.json、speed-tier-web-build.log、speed-tier-regressions.log、speed-tier-backfill-check.log、server-speed-tier378-build.log、android-0.6.378-speed-tier-build.log、deploy-speed-tier378.log、deploy-speed-tier378-backfill.log、speed-tier-live-final.json、deliver378.log及speed-tier-live.png。

# 2026-10-16 Gateway / 桌面 Codex 容量自动重试

用户开关原已启用。原生日志实际记录本地10:55的 Sol 容量错误，线程01a07e7c-8f28-7a53-9825-0152b461a685、轮次01a14294-d8df-7063-aa41-cc5e5db3a4ae；该记录在INFO级别。旧网关事件窗口已裁剪，无法据此确定该次错误是否送达网关。发现并修复：interrupted携带容量错误漏排重试、只有最终error没有completed不启动定时器、同一目标因容量错误blocked后重试被拦截；保留用户停止、目标完成/预算终止及不确定RPC不重放的处理。重试次数不设八次上限。

共享连接每次initialize成功后发ready并递增代数；开启容量自动重试时，按loaded/list分页恢复已加载Codex会话的通知订阅。并发2、同连接去重，过滤隐藏/非Codex线程，read确认仍加载后resume且excludeTurns；关闭/断线/换代终止旧扫描。协议没有原子的仅订阅接口，read与resume之间仍存在极小卸载竞态。此功能不依赖手机打开当前会话，不扫描磁盘历史、不重发用户消息。

TypeScript构建退出0；容量重试及订阅专项17/17通过，既有端点专项9项通过。已备份并部署4个编译模块，仅重启网关，安装文件逐字节核对通过。部署后接口实测enabled=true、connected=true、watchingThreads=11、restoring=false、pendingRetries=0，健康正常；共享端点URL/token及后端PID保持，Web PID14168保持。Android沿用0.6.377，无需更新APK。没有注入测试消息、手工恢复原会话或制造真实容量故障；真实下一次容量错误后的重试结果仍待观察。

备份D:/codex/backups/Codex-mobile-control/before-capacity-desktop-20261016；证据D:/codex/build/Codex-mobile-control/capacity-desktop-final-build.log、capacity-desktop-final-tests.log、deploy-capacity-desktop.log、capacity-desktop-live.json。排查脚本与原生日志证据亦保留在同一build目录。

# 2026-10-16 Web / 个人助理草稿与模型目录响应

刷新模型保留同执行器、Harness、模型的思考等级，并合并并发目录请求；后续输入草稿按任务保存。成功回执只清理确认提交且未再编辑的原文字，未确认提交保留文字及request ID；提交成功后读取回执失败明确区分。模型目录按Codex、外部CLI、Claude ACP、AGY ACP分源缓存与去重，冷读最多等待250ms，已完成来源先返回，未完成来源后台补齐；页面不因补读禁用可用模型，也不重建相同选择项或覆盖任务回执。ACP失败详情放入折叠。

服务端/Web构建退出0，目录服务4/4、Web专项9/9通过。真实本机目录首读282ms、温读15ms，各返回67个可用模型，Claude/AGY仍后台加载；该测量是本机读数，不代表手机链路耗时。浏览器确认部分目录已可发送、low等级与未发送草稿保留、无横向溢出；没有发送真实任务。网关helper与Web源/静态文件已部署并核对，共享后端保持。临时页面的测试草稿已清空、视口覆盖已重置、临时页已关闭。

备份D:/codex/backups/Codex-mobile-control/before-assistant-drafts-20261016和before-assistant-catalog-20261016；证据同build目录下assistant-catalog-server-build.log、assistant-catalog-server-tests.log、assistant-catalog-web-build.log、assistant-catalog-web-tests.log、assistant-catalog-live.json、deploy-assistant-catalog.log。上述部署均保留之前侧栏、弹窗、模型搜索及Fast修复；总体体验优化仍在进行。

# 2026-10-16 Web / 模型搜索保留输入与列表局部更新

模型搜索原先每次input都render整个工作台并重建搜索框，再focus与恢复光标；中文组合输入期间也执行此路径。现模型筛选复用filteredModels，输入与官方/中转筛选只更新tbody、空结果和数量，不重建侧栏、搜索框、筛选按钮或表格滚动容器。组合输入期间不刷新结果，compositionend后再筛选；按钮提供aria-pressed状态。窄屏模型名称、ID与表头保持单行，长内容可省略并用title查看全文；表格继续内部横滚。

补1个必要回归验证输入节点/侧栏身份、焦点、选区与中文组合输入，以及筛选保留查询；修复测试夹具缺失personalAssistantPage真实导入。旧代码定向退出1，输入节点身份断言失败；修复后该项与原搜索/中转弹窗用例共2项通过。JS语法与最终Web构建退出0，资源已部署、HTTP核对一致，不重启服务。真实页面查询gpt-6-astra得4条，点官方后1条且查询保留；570×668下名称nowrap，表格737px在522px容器内滚动，页面宽555px未超过570px。未在真实浏览器模拟系统中文输入法，组合事件由隔离DOM回归覆盖；未执行账号更改或模型请求。

备份D:/codex/backups/Codex-mobile-control/before-model-search-20261016；证据D:/codex/build/Codex-mobile-control/model-search-before.log、model-search-after.log、model-search-build.log、deploy-model-search.log与model-search-live.jpg。网页刷新生效，Android仍为0.6.377；侧栏和弹窗修复保留。
# 2026-10-16 Web / 配置弹窗固定标题与操作栏

390×700现场添加中转弹窗的保存按钮底部669.8px，超出弹窗底部665px，长表单还会把关闭按钮滚走。共享dialog增加独立modal-body；标题、错误提示与操作栏保持在内容滚动区域外，表单按100dvh限制高度，正文min-height:0独立滚动。420px以下减少内边距，关闭与底部按钮保持44px点击高度，模型操作区允许换行。会话迁移进度插入modal-body，保持同一滚动职责。

JS语法与Web构建退出0，资源已部署，本机HTTP核对一致，无服务重启。390×700添加中转保存按钮完整可见；添加5行模型后正文1127px独立滚动，保存按钮底部671px仍在视口内；390×420下正文可见高度245px、保存按钮底部391px、弹窗底部403.8px，均在视口内。键盘定位第五行后正文scrollTop=600.8px，标题仍在17px、保存按钮仍在671px，无横向溢出。仅使用未保存草稿，取消关闭；没有发起模型请求、迁移或保存真实配置，未扩大全量测试。

备份D:/codex/backups/Codex-mobile-control/before-web-dialog-scroll-20261016；证据D:/codex/build/Codex-mobile-control/web-dialog378-build.log、deploy-web-dialog378.log、web-dialog378-mobile.jpg。仅网页资源更新，Android仍为0.6.377。此前侧栏修复继续保留。
# 2026-10-16 Android 0.6.377 / Fast 持久设置与失败状态

Fast 未知时统一显示关闭，删除问号与“点击重新读取”分支；读取真实状态后同步。点击未知的关闭开关表示用户明确开启，默认展示本身不写设置。读取或保存请求失败时保留同一会话最后确认的状态并提示错误，避免先误显示关闭、下次读取又显示开启。线程设置通知的 flex 与 default 均视为标准速度。

普通发送明确 fast 参数改用持久 serviceTier，取代仅本轮生效的 serviceTierForTurn；目标继续复用相同设置。PUT 先监听本会话对应的 thread/settings/updated，再读回确认；通知最多等待2.5秒，超时后仍以实际读回值决定成功或502，不把RPC排队应答当作应用完成。官方协议与官方turn_start回归均区分会话级和单轮速度；未证明所有真机反转均来自同一条路径，旧队列或桌面主动更改仍可能改变真实设置。

Server构建退出0，Fast/会话发送/目标继续定向36项通过，含完成与中断后保持标准速度、异步应用后读回和忽略其他会话通知。首次构建命令误用了server/server前缀，ENOENT退出-4058，改正目录后构建通过。网关两模块已部署，部署时共享端点和后端进程保持；后续共享后端发生的独立重启没有由本次部署触发。安卓最终Release构建4m9s退出0；0.6.377/349，3,100,980字节，三份交付和实际HTTPS下载逐字节一致。未操作真实会话或注入消息，未操作用户模拟器。

Android健康管理保留installed未知状态，不误报未安装；Hermes Git构建的说明改为本机版本无法与Release比较。源码与376包备份D:/codex/backups/Codex-mobile-control/before-fast-unknown-0.6.377；仅删除与备份一致的旧376交付重复包。证据D:/codex/build/Codex-mobile-control下android-0.6.377-retain-build.log、fast377-regressions.log、deliver377.log、deploy377-fast.log。实体手机未验证：覆盖安装377，关闭Fast后完成或停止一轮，再打开面板应保持关闭；保存失败应报错并保持上次确认状态。

# 2026-10-16 Web / 侧栏与窄屏溢出修复

固定侧栏原先没有分配滚动高度，1200×720现场aside内容高797px，末项底部733.8px；570px宽窗口菜单被压成逐字换行并造成整页横向溢出。现侧栏品牌与底部保持布局，中部导航min-height:0并独立纵向滚动；760px以下菜单为不可压缩的单行横滚，保留全部入口。刷新与页面渲染保留导航横纵位置；主内容、网格、筛选区与420px以下排版补齐宽度约束。

Web构建及JS语法检查退出0，app.css/app.js/index.html已复制安装目录，实际HTTP内容核对一致（HTML还原运行时令牌占位符后比较），无需重启服务。首轮HTTP逐字节检查因HTML动态注入令牌断言失败，修正比较方法后通过，令牌未输出。1200×720现场侧栏contentHeight=720，nav独立滚动，诊断可点击且底部617.6px在nav620.4px范围内；570×668菜单各项均44px且不逐字换行；390×844检查诊断、统计、账号、模型账户、模型无整页横向溢出和面板越界，模型宽表814px在342px容器内滚动；900×720侧栏高度720且独立滚动。未操作账号、升级或发起模型测试。

备份D:/codex/backups/Codex-mobile-control/before-web-overflow-20261016，含修改前源码与安装资源。证据D:/codex/build/Codex-mobile-control/deploy-web-overflow377.log及web-overflow377-desktop.jpg、web-overflow377-mobile.jpg。网页刷新后生效。
# 2026-10-16 Android 0.6.376 / Fast 会话设置保存与真实状态同步

模型面板继续在每次打开时读取当前会话。Android将读取和保存分开：同会话保存请求去重，切换面板/会话不取消已发出的保存；旧连接、旧会话、旧读取和旧设置通知前发出的响应不能覆盖当前状态。PUT采用服务端读回确认值，未知状态显示问号/读取中，不当作关闭；有当前会话ID时不以全局默认替代。新增thread.settings.updated实时同步通道，消息不写入操作时间线。

网关关闭Fast时从serviceTier:null改为显式default，应用于会话开关、新会话及目标继续的持久设置；普通单轮原有serviceTierForTurn:default保留。PUT在thread/settings/update后读取实际会话serviceTier，值未知或与请求不符返回502，不再回显请求值作为成功。官方当前CLI导出的协议说明default用于标准速度；临时隔离app-server接受default更新，但无消息的空会话无法resume（-32600 no rollout found），所以未将隔离fixture当作真实会话读回验证。没有恢复原会话或注入测试消息；原全局priority配置保持。

Server构建首次因新增事件未加入GatewayEvent类型失败（TS2322），补齐类型后构建退出0。Fast定向3项检查通过：全局priority时显式标准、保存应答后实际状态未变不能成功、缺失状态仍未知。Android Release构建4m53s通过；0.6.376/348、3,100,980字节，包版本/功能字符串、三份交付及网关HTTPS下载逐字节一致。仅更新并重启网关的threadFast/sessionManager两模块，部署核对共享URL/token及后端进程保持，Web未再重启。前一版375的统计/健康管理改动均包含。

备份D:/codex/backups/Codex-mobile-control/before-fast-retention-0.6.376，保留375包；仅删除与该备份一致的375重复交付包，已清理独立fixture运行目录，保留复现脚本和输出。构建/交付/部署证据分别为android-0.6.376-build.log、deliver376.log、deploy376.log。实体手机与现有真实会话未测：安装376，在当前会话关闭Fast后关闭再打开模型面板，预期仍关闭；在电脑端修改同一会话速度后，手机应随设置通知或重新打开面板同步。读取或确认失败时应报错/未知，不显示假成功。
# 2026-10-16 Android 0.6.375 / 首次切换计价保留布局与助手健康管理

首次切换 API 计价时，请求按计价分别缓存，冷缓存会清空统计正文并压缩滚动范围。现保留同来源、同时间范围的 Token、图表及模型布局，未返回的所选金额显示待读取；详细统计也按除计价以外的请求参数识别可保留内容，并标出当前金额实际采用的计价。请求取消、序号及缓存大小机制保留。

Release/隔离Debug/Test构建通过（6m20s）；定向UI检查中，首次冷切与首次响应按钮位置均为2076→2076，最终OK (1 test)、5.077s。首轮错误场景按“位置完全不动”断言失败：显示错误行后按钮下移99px；该场景改为检查正文保留且按钮仍可见，冷切和首响应继续断言位置不变。未声称错误提示完全不占高度。仅测试APK调整后的构建4m16s通过。未连接真实账号或发送模型消息。

374的速度索引反馈一并交付：进度放到首卡现有标题行，未知总数显示“正在检查记录…”，不再插入独立进度卡；标题允许大字号。独立设备2项UI通过（12.058s），1.0及1.6字号下模型位置位移均为0，保留原有模型展开/分页检查。374构建6m40s通过，修改并入375，未单独发布374。

安卓助手管理已接入进程运行状态、内存、新版信息和检查更新按钮，Codex桌面端独立成卡；现有共享后端重启入口保留。网关和Web已部署生效；构建与定向检查通过，进程采样共享15秒缓存且并发去重，页面前台每30秒更新。8个新版源实际返回有效版本：CLI按各自官方npm/GitHub，Codex桌面按微软商店产品与包架构读取四段版本，参考CCSwitch及Wangnov/codex-app-mirror。现场发现Hermes Git构建日期被误当release，已局部修复并仅重启网关部署：原始Git文字保留、latest=0.22.2、installedVersion=null、state=unknown。实际HTTP检查及Web按钮通过，截图web-health.png已保存。更新前检查无网关托管任务与待响应RPC；两次部署均确认共享端点URL/token及后端进程未变，无会话恢复、测试消息或真实软件升级。安卓健康卡片已编译，未做实体手机端到端验证；手机设置→助手管理可刷新状态并检查更新。

APK0.6.375/347、3,100,980字节，版本及功能字符串检查、三份文件与实际HTTPS下载逐字节一致。备份D:/codex/backups/Codex-mobile-control/before-harness-health-0.6.375（含374构建包）及before-speed-status-0.6.374保留。已卸载两个隔离测试包并核实归属后关闭5556（qemu36292退出）；5554仅只读查询，本轮前台快照一致。仅删除与备份逐字节一致的373重复包。证据位于D:/codex/build/Codex-mobile-control/harness-health375及statistics-speed374。实体手机未测；安装375后滚到参考金额，首次点API计价，应保留阅读位置，网络失败仍保留Token和模型卡片。

# 2026-10-16 Android 0.6.373 / 速度模型重排保留展开与分页

StatisticsSpeedDetails原先按模型、提供商及列表序号设置Compose key；接口刷新改变模型排名后，已展开模型与“显示更多”的数量会被重置。现按速度来源、原始模型值与提供商标识明细，数据更新时保留相应UI状态。组件改为internal以供隔离UI夹具调用，未添加运行时开关。

同一项独立5556检查：展开Alpha的35条会话并点击显示更多，重排Beta/Alpha；改前重排后第35条消失，17.434s、1项失败。adb instrumentation退出0但输出明确FAILURES，未当作通过。改后同场景7.948s、OK (1 test)，重排后35条仍在、Beta保持收起；手动收起Alpha并再次重排后仍收起。展开时会话数组读取两次均为Alpha=1/Beta=0，因此未发现额外扫描其他模型的证据，本轮只修状态身份，不宣称提速。基线Debug/Test构建7m44s，最终Release/Debug/Test构建5m49s通过，未扩大其他测试。

APK0.6.373/345、3,100,980字节，版本及既有功能标记检查、三份交付与实际HTTPS下载逐字节一致。备份 D:/codex/backups/Codex-mobile-control/before-speed-state-0.6.373；交付后仅删除与备份一致的372重复包。首个模拟器启动器返回后子进程因原AVD被占用而退出（未保留子进程退出码，日志提示Another emulator instance is running）；随后复用D盘独立isolated350配置启动5556，数据盘确认为D盘，两个隔离包已卸载、qemu14672退出。5554只有只读状态查询；其前台快照从NekoBox变为Launcher，originalForegroundKept=false，原因未确认，未尝试切回或关闭原设备。不能写成原设备前台保持。

证据在 D:/codex/build/Codex-mobile-control/statistics-speed373：before/after-ui.log、before/after-reads.log、device.json及模拟器日志；最终构建android-0.6.373-build.log、交付deliver373.log位于D:/codex/build/Codex-mobile-control。网关/共享后端未重启，无模型消息或原会话操作。实体手机未测；安装373，在详细统计→速度展开模型并显示更多后刷新，应保留展开和已显示条数。

# 2026-10-16 Web / 速度统计更新保持布局

原生速度后台检查开始时还没有totalThreads，旧界面用0补齐并在正文插入“0 / 0 个会话”，完成后删除该段。实际内置浏览器模型标题相对面板的位置488.6000→429.9000，上移约58.7px。现进度改用现有状态行，未知总数显示“正在检查记录…”，总数已知才显示计量进度；运行时沿用文字扫光，单行溢出省略并通过title保留全文。索引错误提示仍保留。首次读取期间，来源说明和页脚按当前选择显示，不再短暂把原生速度写成工作台请求。

JS/CSS构建与7项定向检查通过：新增2项覆盖未知/零/已知总数、固定正文结构与待响应来源；另5项覆盖明细按需展开、滚动恢复和刷新焦点/重复提交/失败恢复。现场新版检查中及完成后，模型标题位置都为429.9000，状态行高度都为17.6000，扫光按运行状态启停，无“0 / 0”。这些数据仅证明本次布局跳动已消除，不是网速或实体手机性能测量。

仅部署app.js（353,104字节）及app.css（64,063字节），构建/安装/HTTP返回一致；Web/网关/共享后端进程及endpoint保持，无重启、模型消息或原会话操作，Android保持0.6.372。备份 D:/codex/backups/Codex-mobile-control/before-speed-status-20261016；构建/检查/部署日志与live-check.json、after.jpg在 D:/codex/build/Codex-mobile-control/web-speed-status。网页刷新后可在Token速度页观察后台检查开始/完成，模型列表应保持位置。

# 2026-10-16 Web / 手动刷新保留键盘焦点

继续修复上一轮已记录的手动刷新焦点问题。真实内置浏览器在旧安装产物重现：按Enter更新速度统计，结束后activeElement是BODY。原实现先设置button.disabled，再重绘为disabled按钮，焦点在读取前即已丢失。现刷新及暂停索引按钮使用aria-disabled表示忙碌，保留键盘焦点；analyticsActions按当前统计视图记录完整操作，从索引命令开始到后续统计读取结束均阻止重复点击。读取完成或失败清理忙碌状态；保留既有阅读焦点恢复，不抢回用户已经移动到侧栏的焦点。加载文字扫光、按钮位置与明细按需展开保持。

受影响JS/CSS构建通过。新增3项检查通过：使用真实app入口bundle在JSDOM中覆盖速度读取期间焦点/重复激活、索引命令与后续读取的完整忙碌期、失败恢复及外部焦点；未改旧UI串接测试harness。另8项既有明细/阅读状态检查通过，共11项。原CSS源码重新编译与改前安装CSS逐字节一致，本次新增CSS只为aria-disabled按钮提供等待光标。

实际浏览器部署后按Enter刷新：busy=true时activeElement仍为BUTTON/data-action=analytics-refresh，原生disabled=false、aria-disabled=true；完成后busy=false、aria-disabled=false，焦点仍在刷新按钮，继续Tab进入SELECT/data-speed-filter=source。live-check.json与after.jpg保留现场结果。未触发生产索引更新、账号操作、模型消息或原会话操作；索引命令/失败/重复点击仅在隔离fixture检查，不据此宣称所有页面加载交互已审查完毕。

原子替换安装dist/app.js（352,853字节）及app.css（63,967字节），构建/安装/真实HTTP返回逐字节一致；Web/网关/共享后端监听进程和endpoint内容保持，无重启。Android保持0.6.372。改前Web源码、源码/安装JS/CSS和两份状态文档备份 D:/codex/backups/Codex-mobile-control/before-refresh-focus-20261016；构建、定向检查、部署日志与现场证据 D:/codex/build/Codex-mobile-control/web-refresh-focus。网页刷新即可使用；键盘聚焦更新统计并按Enter，更新后再按Tab应从该按钮后继续。

# 2026-10-16 Web / 会话速度明细按需展开

权威Web源码 D:/codex/project/2026-09-07/c/aimami-local。实际内置浏览器检查发现，3个原生速度模型均关闭时仍生成94行隐藏会话明细。现tokenSpeedPanel只生成模型摘要和表头，attachSpeedModelDetails在首次展开时生成该模型的会话行；同一节点重新展开复用已生成行。刷新先恢复details.open，再同步挂载已展开模型，之后恢复表格滚动和原焦点，避免异步toggle晚于滚动恢复。未展开模型不生成会话行；数据仍随原接口返回，本轮只减少隐藏DOM，不代表响应体或实体手机时延下降。

Web受影响bundle构建通过；2项明细定向检查及6项既有阅读焦点检查通过，覆盖关闭/单模型展开、HTML转义、模型重排、null与“未记录模型”分离、刷新前先挂载后恢复滚动、重新展开复用及手动收起后刷新。实际部署后关闭会话行0，展开Sol仅36行且其余模型0行，更新后展开保持、内部scrollTop保持242.3999938964844，手动收起后更新仍0行。现场另观察到手动“更新统计”按钮禁用后焦点落到BODY；本次未修改这一既有手动刷新焦点问题，不能以6项阅读状态检查宣称该按钮焦点已修复。

仅原子替换安装dist/app.js，352,643字节，源码构建/安装/真实HTTP返回逐字节一致；Web/网关/共享后端监听进程与endpoint内容保持，无重启、原会话操作或模型消息。Android保持0.6.372。改前3份Web源码、源码/安装bundle与两份状态文档备份 D:/codex/backups/Codex-mobile-control/before-speed-details-20261016；构建/定向检查/部署日志、live-check.json与after.jpg在 D:/codex/build/Codex-mobile-control/web-speed-details。网页刷新后，打开Token速度，未展开模型不创建会话行；展开明细并滚动后更新，明细应保留位置。

# 2026-10-16 Web / 统计更新后的操作焦点

权威Web源码 D:/codex/project/2026-09-07/c/aimami-local。内置浏览器实际复现：键盘Enter展开Codex Token的“计价依据与单价”后，焦点起初是SUMMARY；自动更新后展开状态仍在，但焦点变为BODY。analytics-view-state原先只记录ID、筛选和缩放输入焦点，遗漏summary和按钮。

现记录summary的既有详情键，速度模型按data-speed-model恢复；按钮/role=button及图表日期选点按稳定业务属性、元素类型和所属图表恢复，不按动态计数或系列顺序恢复。恢复使用preventScroll，保留现有展开、横向滚动、日期草稿和输入焦点策略；控件消失则不替换成其他控件，页面外焦点不被抢走。改动只涉及web/analytics-view-state.js和新增test/analytics-view-state.test.mjs。

修复前5项检查退出1、3失败，实际焦点BODY而非目标summary/按钮，与浏览器复现一致。Web受影响JS单独esbuild构建通过；改后6项定向检查通过（1.386s），覆盖模型重排/计数变化、同action不同range、同名按钮不同图表、模型/日期选点、外部/已消失焦点和原日期草稿。未扩大现有全量UI测试。

部署仅原子替换安装dist/app.js（352,193字节），源码构建/安装/实际HTTP返回逐字节一致，Web/网关/共享后端监听进程及endpoint文件均保持，无重启。内置浏览器reload后仅操作只读筛选/展开；原始CDP节点身份检查被浏览器权限门禁拒绝（返回用户未批准），未重试、未绕过；后续普通页面状态显示更新文字07:16:12→08:11:12，同时SUMMARY焦点、展开true、scrollY563.2000122070312保持。该验证不依赖被拒绝的底层节点检查。截图after.jpg和live-check.json记录结果，未修改真实账号、模型配置或会话，没有发送模型消息。Android保持0.6.372。

改前Web模块、源码侧和安装侧app.js静态产物及两文档备份 D:/codex/backups/Codex-mobile-control/before-web-statistics-focus-20261016。构建、测试、部署日志和截图在 D:/codex/build/Codex-mobile-control/web-statistics-focus。页面刷新即可加载本次更新；键盘展开计价明细后，等待自动刷新，再按Tab应从当前控件继续。

# 2026-10-16 Android 0.6.372 / 账号操作按宽度换行

新增 NativeAccountActions，封装 FlowRow 的8dp横向/4dp纵向间距，modifier放在根节点，按钮内容由调用方提供，不暴露不需要的布局scope。AGY导入/保存、历史范围、Claude账号操作、授权状态、模型获取/连接测试及Claude配置列表操作改用该布局，宽度不足时按按钮换行；历史范围标题与选项分开。按钮文本、启用条件及提交参数不变。

验证先构建基线Debug/Test（3m28s），再构建最终Release/Debug/Test（5m19s）。基线两项检查10.44s失败，换行后使用相同hasVisualOverflow断言8.74s仍失败（adb均退出0，但instrumentation明确2 failures，未作通过处理）。进一步记录字形指标发现：例如“从 Tools 导入”paragraphWidth=748，控件width=424，实际末字right=422.17505；该布尔标志比较段落约束与控件尺寸，不能单独证明可见裁切，亦不能将初次失败当旧版可见溢出的充分证据。

仅修改测试谓词和诊断，不修改已构建Release实现：保留单行、完整可见字符终点、末字边界在控件内（允许1物理像素取整）及无高度裁切，记录全部10个标签指标metrics.json。测试包重建1m21s；同320dp/1.6倍字号夹具两项通过，OK (2 tests)、7.435s。全部标签单行完整，AGY点击90天后history携带days=90，Claude刷新/历史携带current账号。未扩大测试；真机、平板、多窗口与其他字体未实测，不据此声称全端排版评估已完成。最后仅修正测试注释，未改变执行代码。

APK0.6.372/344、3,100,980字节，版本与既有功能标记、三份交付及实际HTTPS下载逐字节一致。两个隔离包已卸载，按命令行核实归属后关闭5556，qemu11132退出，5554前台前后相同。备份 D:/codex/backups/Codex-mobile-control/before-account-wrapping-0.6.372；只删除与备份逐字节一致的371重复交付包。无模型消息、真实账号操作或原会话变更，网关/共享后端未重启。日志accountwrap372-before-build.log、android-0.6.372-build.log、accountwrap372-metrics-build.log、deliver372.log与account-wrapping372/证据均在D:/codex/build/Codex-mobile-control。手机安装后调大字号，在AGY历史范围和Claude账号操作处确认按钮按剩余空间换行，文字与点击均正常。

# 2026-10-16 Android 0.6.371 / 账号页稳定加载反馈

NativeAccountsContent 原先在账号正文前插入 LinearProgressIndicator 和加载文字，即使370已保留刷新data，卡片仍会下移。现把加载/处理反馈放到固定88dp×48dp的右上操作区，沿用 NativeRunningTitle 的文字扫光，空闲时原位显示刷新按钮；移除正文前的加载条和文字。正文、错误、消息、结果和预览均取当前service对应的state，服务切换首帧不显示上一个服务的错误或提示；当前服务状态尚未到达时，连接状态下显示读取中。请求/保存逻辑保持370实现。

Release、隔离Debug/AndroidTest构建通过（5m52s）。独立5556三项UI检查通过，OK (3 tests)、16.42s：6个账号滚到后方，刷新/处理中/空闲三态下，已有账号标签与右上操作区的bounds保持相等；Codex旧错误/消息/预览不显示在Claude页面；复用原确认测试，必须显式点击并按预览账号ID/planId提交切换。未连接真实账号，无模型消息或原会话操作。未测实体手机大字号排版与弱网；安装后在账号页滚动后刷新，应只在右上显示扫光文字，已有卡片保持原位。

APK0.6.371/343、3,084,596字节，版本与既有功能标记、三份交付和实际HTTPS下载逐字节一致。两个隔离包已卸载，按命令行核实归属后关闭5556，qemu16180退出，5554前台前后相同。改前源码/版本/测试/两份文档和370包备份 D:/codex/backups/Codex-mobile-control/before-account-feedback-0.6.371；仅删除与备份逐字节一致的370重复包。未重启网关或共享后端。日志android-0.6.371-build.log、deliver371.log、account-feedback371/android-check.log与device.json均在D:/codex/build/Codex-mobile-control。

# 2026-10-16 Android 0.6.370 / 账号读取取消与页面归属

账号列表原用同步HTTP execute，取消协程不会关闭请求。GatewayClient.accountsAsync现沿用requestAsync的Call.cancel，JSON解析在Default，删除无调用的旧同步accounts方法。VM初次读取及操作后刷新使用该方法；同服务刷新保留原data。NativeAccountsRoute用DisposableEffect管理读取寿命，并捕获本次readingService，返回/隐藏/断开时调用cancelAccountRead。清理核对服务名，仅在busy为空时取消读取和清除加载/预览，不取消正在提交的账号操作。切换确认仅在state.service对应的非空服务页显示，迟到预览不再出现在账号列表。

Release、隔离Debug/AndroidTest构建通过（6m17s）。独立5556两项UI检查通过，OK (2 tests)、28.44s：从设置进入Codex账号NO_RESPONSE后返回，直接核对旧Call.isCanceled；读取Claude后刷新时保留相同data，错误服务的清理不取消当前Call，返回后正确取消。另一项让隔离switch-preview请求未完成时返回，Call仍未取消，放行后VM接收预览但账号列表不显示确认框，再进入Claude正常读取。连接保持，无模型消息，未操作真实账号。实体手机弱网体验未测；安装后在账号子页加载时返回、切换服务，再刷新，应保留已读内容且不出现其他服务的提示或弹窗。

APK0.6.370/342、3,084,596字节，版本/既有功能标记、三份交付和实际HTTPS下载逐字节一致。两个隔离包已卸载，按命令行核实归属后关闭5556，qemu10968退出，5554前台前后相同。改前源码/版本/测试/两份文档和369包备份 D:/codex/backups/Codex-mobile-control/before-account-read-0.6.370；仅删除与备份逐字节一致的369重复交付包。未重启网关/共享后端。日志android-0.6.370-build.log、deliver370.log、account-read370/android-check.log及device.json均在D:/codex/build/Codex-mobile-control。

# 2026-10-16 Android 0.6.369 / 曲线滑动绘制缓存

ConsoleModelTrend 原先在每次选点重绘时，重新遍历全部模型和日期并构造 Path/cubicTo；同一个 selected 值还在外层组合读取，导致滑动时整张图表进入组合。现用 drawWithCache 按实际绘制尺寸和图表数据缓存曲线几何，触摸选点只在 onDrawBehind 和独立 ConsoleTrendCallout 读取；模型图例不再因选点变化重组。曲线样式、选点映射、数据汇总和按住显示/松手消失保留。

先用改前实现、独立5556测24模型×365天、30次横向移动，再用同夹具改后复测。主线程采样 cubicTo 16/561→0/501；图表相关栈样本213→39。Thread.getStackTrace采样和Debug/测试时钟会影响观测，该结果证明本场景重复路径计算减少，不代表实体手机提速比例/帧率。基线1项21.839s通过；改后2项10.015s通过：同场景滑动日期明细正确、松手清除，改前改后图表像素 sameAs；另一项验证数据刷新改变曲线、模型聚焦改变样式、宽度变化后选点和明细正确。未扩展其他测试。

基线Debug/Test构建3m26s，最终Release/Debug/Test构建5m30s通过。APK0.6.369/341、3,084,596字节，版本及既有功能标记、三份交付、实际HTTPS下载逐字节一致。两个隔离包已卸载，按命令行确认归属后关闭5556，qemu33448已退出，5554前台前后相同。未重启网关/共享后端，无生产模型消息或原会话操作。

改前源码/版本/两份文档及368包备份 D:/codex/backups/Codex-mobile-control/before-trend-paths-0.6.369；交付后仅删除与备份逐字节一致的368重复包。证据 D:/codex/build/Codex-mobile-control/trend-paths369：before/after.json、before/after.png、comparison.json、before/after-ui.log、device.json；构建日志trendpaths369-before-build.log、android-0.6.369-build.log，交付deliver369.log。实体手机流畅度未测；安装后在详细统计切到年度曲线，按住横滑查看明细，松手应关闭，刷新/聚焦模型/改变窗口大小后曲线和选点应同步更新。

# 2026-10-16 Android 0.6.368 / 管理响应解析移出主线程

GatewayClient.managementRequest 原先在 requestAsync 返回后直接 JSONObject 解码。NativeViewModel.managementRequest 由管理页 LaunchedEffect/点击协程调用，因而大统计、账号和管理响应的完整JSON解析落在界面线程。现沿用可取消的 requestAsync，并用 withContext(Dispatchers.Default) 包住管理请求的验证、编码和响应解码，返回原调用上下文后由既有VM连接代次检查和页面取消机制接收结果。请求地址白名单、65秒超时、错误和返回JSON结构未改变；没有新增缓存。

Release构建通过（4m17s）。本轮为明确线程边界调整，未扩展测试或启动模拟器；源码可确认JSON解析移出主线程，尚无实体手机延迟/帧率测量。最小手动确认：安装368，在详细统计选择较大时间范围，读取期间尝试点击筛选/返回，结果应正常加载，切换或返回不显示已取消请求的旧结果。主线程仍有后续视图数据整理与绘制，本轮不据此宣称所有统计卡顿均已解决。

APK0.6.368/340、3,084,596字节，版本/既有功能标记、三份交付及网关实际HTTPS下载逐字节一致。改前源码/版本/两份文档及367包备份 D:/codex/backups/Codex-mobile-control/before-management-parsing-0.6.368；仅删除与备份逐字节一致的367重复交付包。未重启网关/共享后端，未操作设备或原会话，没有模型消息。日志 android-0.6.368-build.log、deliver368.log，交付脚本deliver368.mjs均在D:/codex/build/Codex-mobile-control。

# 2026-10-16 Android 0.6.367 / 统计选项横向定位

NativeStatisticsDetails 的 StatisticsTabStrip 原先对选中项调用 BringIntoViewRequester，定位请求会传播到外层纵向滚动容器。现改用有稳定选项键的 LazyRow，选择改变时只检查横向可视范围，选项未完整显示才沿本列表 animateScrollToItem；移除向祖先传播的定位请求。页签切换时原有主动返回页首行为保留，时间范围选择不再因选项自动定位而拉动整页。统计请求、筛选及数据口径保持原实现。

Release、隔离 Debug/AndroidTest 构建通过（5m52s）。新增1项定向UI检查通过，OK (1 test)、8.985s：让选项栏部分滚出屏幕，切至最右项并验证完整横向可见，切回最左项，两次均验证外层纵向位置不变。检查直接覆盖实际 StatisticsTabStrip 组件；未以此宣称实体手机整页或所有交互均已验证。手机安装后可在详细统计横滑时间选项并切换，确认选项定位平顺且不额外拉动纵向内容。

APK0.6.367/339、3,084,596字节，版本及既有功能标记、三份交付和实际HTTPS下载逐字节一致。两个隔离包已卸载，按命令行确认归属后关闭5556，qemu36596已退出，5554前台前后相同。源码/版本/两份文档及366包备份 D:/codex/backups/Codex-mobile-control/before-statistics-scroll-0.6.367；交付后仅删除与备份逐字节一致的366重复包。网关和共享后端未重启，无生产模型消息或原会话操作。日志 android-0.6.367-build.log、deliver367.log、statistics-scroll367/android-check.log 和 device.json 均在D:/codex/build/Codex-mobile-control。

# 2026-10-16 Android 0.6.366 / 搜索状态与 OpenCode 统计核实

侧栏搜索改为统一 query/agent/matches/loading/error 状态。更换关键词立即清理旧正文匹配，保留250ms防抖，ticket/generation/client/harness/connected 检查阻止旧响应覆盖。搜索等待、失败和空结果分别显示；反馈栏保持至少48dp，失败可局部重试。侧栏收起、断开/切换服务和离开界面取消并清理搜索，展开按保留关键词重新读取。

Release、隔离 Debug/AndroidTest 构建通过（6m9s）。5556 两项定向检查 OK (2 tests)、33.107s：改关键词取消旧HTTP并保留最新结果；搜索加载不误报空结果、失败后原地重试、反馈栏高度保持、收起取消请求且连接保持。没有发送生产模型消息。实体手机交互未实测；安装后在侧栏连续换关键词、重试失败搜索及收起侧栏，应只显示当前关键词状态。

本轮用户要求 Web 和安卓统计加入 OpenCode：现有实现已部署，本次再次只读核实五个入口，无需重复修改。Web 原始统计、安卓详细统计、旧控制台、全部来源汇总与活动日历均包含 OpenCode，模型曲线有效。当前本周40条，输入2,061,743（缓存100,224）、输出159,450（含推理98,149），合计2,221,193 Token；原生记录金额$0，各入口一致。记录 readback-opencode366.mjs、readback-opencode366.log。

APK0.6.366/338、3,084,596字节，版本和既有功能标记检查、三份交付与实际HTTPS下载逐字节一致。5556两个隔离包已卸载，按命令行确认归属后关闭且qemu10084退出，5554的NekoBox前台保持；device.json记录结果。改前源码/文档及365包备份 D:/codex/backups/Codex-mobile-control/before-search-state-0.6.366；仅删除与备份逐字节一致的365重复交付包。网关/共享后端未重启。构建日志android-0.6.366-build.log、交付deliver366.log、设备/测试search-state366/均在D:/codex/build/Codex-mobile-control。

# 2026-10-16 Android 0.6.365 / Gateway 0.6.128 / 搜索取消与本地结果响应

GatewayClient.searchThreads 原先在 IO 协程里同步 execute；改关键词虽然取消协程，但旧 HTTP Call 仍占连接。现沿用 requestAsync 的可取消 Call，参数/编码/JSON 整理仍保持原路径。网关搜索改用 CloudThreads.cachedList，直接合并已知云端结果，并在后台刷新云端目录；不等待握手/远端 RPC。按来源跳过不能贡献结果的 DeepSeek 原生日志扫描。搜索路由断开信号传到 readRecentSearchEvents 的历史队列，取消当前排队读取并停止后续每批6项的搜索；读取失败正常处理，取消不吞成普通空匹配继续扫描。

TypeScript 构建通过。提取实际编译 search 路由，在隔离 Fastify/真实 HTTP 中验证本地与云端缓存匹配同时返回，禁止调用阻塞云端 list，Codex 搜索 includeDeepSeek=false；第二个场景让首批6项排队后断开 HTTP，6个等待者均取消、不再启动余下18项，重新读取位于原 worker 第2项。检查 search-refresh365/server-check.mjs、server-check.log、server-check.json。

Android Release、隔离 Debug/AndroidTest 构建通过（6m57s）。独立5556新增1项定向检查通过（17.054s）：旧查询 NO_RESPONSE，改关键词后直接检查旧 OkHttp Call.isCanceled、新匹配保留，连接和错误状态正常；清空关键词清除匹配，无模型消息。实体手机连续输入/网络切换下的体验未实测，不以模拟器检查宣称普遍时延提速。

网关部署脚本首次退出1：版本字符串替换误将检查地址127.0.0.1写为128.0.0.1，Invoke-WebRequest在5秒超时；失败发生在第一次检查、未复制或重启程序。仅修正部署脚本为loopback后重新执行，通过两次托管任务/RPC/助理空闲检查，4份文件更新且与编译源一致，仅重启网关PID47968；Web PID21112和共享后端URL/token/进程保持。health=0.6.128，实际会话来源、跨来源include、18条闲置历史和搜索1条匹配读回通过，无模型消息或原会话恢复操作。日志 deploy-gateway128-before-address-fix.log、deploy-gateway128.log、readback-gateway128.log。

APK0.6.365/337、3,084,596字节，版本/既有功能标记、三份交付及实际HTTPS下载一致。两隔离包已卸载，按命令行确认归属后关闭5556并确认qemu退出，5554的NekoBox前台保持。改前源码/编译/测试/文档、安装文件及364包备份D:/codex/backups/Codex-mobile-control/before-search-refresh-0.6.365；仅清理与备份一致的364重复交付包。其余构建/交付日志 gateway128-build.log、android-0.6.365-build.log、deliver365.log 与 search-refresh365 设备/测试记录均在 D:/codex/build/Codex-mobile-control。

# 2026-10-16 Gateway 0.6.127 / 取消无人等待的排队历史

安卓已有历史 Job/HTTP 取消，但网关原历史队列不接收请求取消。现本地 events 路由监听响应连接非正常关闭，将 AbortSignal 传到历史读取；正常完成后移除监听。HistoryWorkerPool 按调用方记录等待者：取消仅拒绝对应等待者，最后一个可取消等待者离开且没有后台持有者时，移除尚未执行的任务并释放计数。正在执行的读取保留工作线程/缓存，可被其他请求继续复用；信号不跨 worker 消息传输。删除旧排队任务后立即重试使用新条目，旧 finally 只清理自身，避免误删新去重记录。取消大量独立任务时沿用128项空闲 affinity 保留上限。

TypeScript 构建通过，八项 history-workers 检查通过（1.106s）：原调度/FIFO/去重/故障替换，以及排队取消与立即重试、取消一个消费者保留其他/后台持有者、运行中读取保留 worker 并供后续复用、提前取消。新取消行为仅接入本地历史请求；云端/快照和 DeepSeek 原生直接读取路径未在本轮增加取消支持。随后使用已安装 index.js 中的实际 events 路由代码及已安装 HistoryWorkerPool，在独立 Fastify/真实 HTTP 连接中接入可控慢 worker，验证客户端断开信号确实到达队列：无共享持有者的排队读取移除后，重试是该 lane 第2项；后台仍持有的同一读取继续完成且只执行一次，后续同会话任务在原 worker 第3项执行。两种场景通过，未触及生产服务或模型。实机快速切换和真实历史磁盘负载下的时延仍未验证；隔离检查不当作手机实测。记录 D:/codex/build/Codex-mobile-control/history-cancellation127/tests.log、http-integration.mjs、http-integration.log、http-integration.json。

部署前复用两次托管任务/共享 RPC/助理任务空闲检查，替换 historyWorkers.js、codexSessions.js、index.js 和两份版本元数据，仅重启网关 PID46832。五份安装文件与编译源一致；health=0.6.127，来源筛选及跨来源 include 通过，闲置会话只读历史返回18条事件。Web PID21112、共享后端 URL/token/进程保持；无模型测试消息或原会话恢复操作。安卓保持0.6.364，无新APK。

手动确认：在慢历史读取期间连续切换会话，应能正常打开最后选中的会话；返回旧会话应重新读取或复用已完成结果，其他客户端共享读取不受一次取消影响。当前释放的是无人等待的排队读取，不中止正在执行的历史计算。改前源码/编译/测试/文档及安装文件备份 D:/codex/backups/Codex-mobile-control/before-history-cancellation-0.6.127。构建 gateway127-build.log、部署 deploy-gateway127.log、读回 readback-gateway127.log 和相关空闲/健康记录均在 D:/codex/build/Codex-mobile-control。

# 2026-10-16 Gateway 0.6.126 / 前台历史读取调度

侧栏 running/interrupted/error 状态检查原先与用户打开会话正文共用 HistoryWorkerPool 的 FIFO 队列。现只将侧栏调用显式标为 background，其他读取默认 interactive。每条 lane 交替选择可执行的前台请求与最早排队任务，既给前台读取机会，也持续推进后台；候选前台不能越过自己会话更早的读取/失效处理。同一个已排队后台请求被前台再次请求时，复用同一 Promise 并提升优先级，不重复读取。原两个工作线程、会话 affinity、超时、队列上限和消息格式保持。

TypeScript 构建通过，history-workers.test.mjs 五项通过（783ms）：原 FIFO/去重、故障工作线程替换，以及新增前台/后台交替、去重提权、前台不能越过本会话早先 invalidation。隔离相同 worker 模拟 14 个后台任务：前台在所属 lane 的处理位置 8→2，单次等待 327.5148→80.2575ms；该模拟仅确认排队规则与观察值，不当作实机时延或整体断联问题已解决。证据 D:/codex/build/Codex-mobile-control/history-priority126 的 probe.mjs、before/after.json、tests.log。

两次托管任务/共享 RPC/助理任务空闲检查后，仅替换 historyWorkers.js、codexSessions.js、index.js 与两份版本元数据并重启网关 PID35176。五个安装文件与编译源一致；health=0.6.126，Codex/DeepSeek 来源筛选和跨来源 include 通过；闲置会话只读历史返回18条事件。无模型测试消息或原会话恢复/发送操作，Web PID21112、共享后端 URL/token/进程保持。安卓保持0.6.364，无新APK；实体手机多会话长期连接及切换速度待实测。

改前源码/编译/测试/文档及安装文件备份 D:/codex/backups/Codex-mobile-control/before-history-priority-0.6.126。构建 gateway126-build.log、部署 deploy-gateway126.log、读回 readback-gateway126.log 和相关空闲/健康记录均在 D:/codex/build/Codex-mobile-control。未增加定时清理或 F盘构建历史。

# 2026-10-16 Gateway 0.6.125 / 合并并发侧栏读取

desktopSidebar 原先每个并发请求独立读取桌面 JSON 并打开 SQLite 查询。现按捕获的 codexHome 合并正在执行的读取，完成后立即移除 Promise；不缓存跨刷新结果，不增加 TTL。不同目录的进行中读取隔离，JSON 与 SQLite 在同一次调用使用相同目录。现有调用方只读侧栏快照，排序/合并均创建自己的数组或记录。

TypeScript 构建通过。隔离 1500 线程/32 项目、8 并发对照：文件读取 8→1，SQL prepare 32→4，返回序列化快照逐项一致；下一次读取立即看见新会话、置顶和项目顺序变化。另验证两个目录同时读取及后续刷新隔离。单次夹具耗时 41.4985→5.4177ms，仅表示该隔离工作量，不作为手机时延或普遍性能比例。基线运行时 40 条会话请求实回 120 行（含家庭/保留条目），暖请求约50–79ms、三并发约106–157ms，未复现断联。

对照脚本初次退出1：SQLite 行为空原型对象，直接与保存的 JSON 普通对象 deepStrictEqual 不等，改为比较实际序列化内容后通过；产品代码未改以迎合比较。既有 sidebar-order-test 初次退出1：未隔离 DSH_HOME，混入真实 DeepSeek 会话；设置独立空目录后，原近况排序、置顶、项目顺序与归档断言通过。不同目录隔离检查通过。诊断脚本与 before/after.json、after.log、sidebar-order.log、home-isolation.log 在 D:/codex/build/Codex-mobile-control/sidebar-coalescing125。

部署前复用两次托管任务/共享 RPC/助理任务空闲检查，仅替换 desktopSidebar.js、package.json、package-lock.json 并重启网关 PID50900。安装文件与编译源一致，health=0.6.125；实际 Codex/DeepSeek 来源筛选及跨来源 include 读回通过，Web PID21112 与共享后端 URL/token/进程保持。无模型测试消息或原会话操作。实体手机多会话长期断联及前后台时延仍未实测；安卓保持0.6.364，无新APK。

改前源码/编译、元数据、文档及安装文件备份 D:/codex/backups/Codex-mobile-control/before-sidebar-coalescing-0.6.125。构建 gateway125-build.log、部署 deploy-gateway125.log、读回 readback-gateway125.log 及部署/空闲/健康记录均在 D:/codex/build/Codex-mobile-control；未添加定时清理。

# 2026-10-16 Android 0.6.364 / 所选文件补丁后台整理

已更改卡片原先在选中文件后，于组合阶段筛选活动、按正文匹配路径、去重拼接并提取 filePatch。现 prepareNativeFilePatch 在 Dispatchers.Default 执行这些步骤，逐事件检查取消；选中文件的 effect 随文件/事件变化重新整理。每个文件拥有独立结果状态，同一文件刷新保留上次准备正文，切换或关闭文件创建新状态并取消旧任务。整理完成后沿用原选中事件的分类/正文延迟加载。收起卡片和仅展开文件列表不启动正文整理。

Release、隔离 Debug/AndroidTest 构建通过（5m20s）。首次 3 项 UI 检查中，切走返回恢复读取、空/失败读取重试并保留已存补丁两项通过；相似文件隔离/正文更新检查在更新后立即断言新正文时失败。新后台步骤不被 Compose 空闲等待覆盖，故仅在更新后增加 5 秒上限的实际新正文条件等待，保留原正文、旧内容消失及兄弟文件隔离断言。测试包重建通过（3m15s），仅重跑失败项，通过（5.636s）；应用源码和 Release 未为此更改。首次 instrumentation 的 adb 退出0但测试失败，未当作成功。证据 D:/codex/build/Codex-mobile-control/file-patch-selection364/functional-before-wait.log、update-after-wait.log。

本轮未测实体手机时延/帧率；证据确认后台调用边界及上述行为，不表示整体卡顿已解决。手动确认：点具体文件立即打开可关闭的弹窗，整理后显示对应补丁；读取失败仍可见已有正文并能重试，快速换文件不混入上一文件。无生产模型消息、原会话操作或共享后端/网关重启。

APK 0.6.364/336、3,084,596 字节，版本/既有功能标记、三份交付及实际 HTTPS 下载逐字节一致。两个隔离包已卸载，按命令行归属关闭 5556 并确认 qemu 退出，5554 的 NekoBox 前台保持。改前源码/文档/测试和 363 包备份 D:/codex/backups/Codex-mobile-control/before-file-patch-selection-0.6.364；仅清理与备份一致的 363 重复交付包。构建 android-0.6.364-build.log、android-0.6.364-test-build.log、交付 deliver364.log 及 file-patch-selection364 记录均在 D:/codex/build/Codex-mobile-control。

# 2026-10-16 Android 0.6.363 / 补丁按区段登记列表

NativeChangeDetail 虽已使用 LazyColumn，但原列表配置仍在界面线程扫描全部 PatchLine，为每行分配单行区间及临时索引列表。现后台准备 patchSections：只单独分出超过 8 行的连续 context，其余行合并为连续区段；UI 使用 items(count) 按区段登记，保留 line:原索引 和 fold:起点键，并区分普通行/折叠入口 contentType。原首尾各 3 行、隐藏行数、展开状态、行号、复制、宽度限制与正文切换机制保持。

使用实际 Debug 编译类的隔离对照，318 组默认/全部/部分展开配置与旧算法的可见行、顺序、索引键及隐藏行数一致；3003 行交错修改样本的区间登记由 3003 次变为 1 次。该数值描述配置工作量，不是实体手机提速比例，未新增性能采样。证据 D:/codex/build/Codex-mobile-control/patch-intervals363/comparison.json 和 PatchIntervalsCheck.java。

Release、隔离 Debug/AndroidTest 构建通过（5m29s）。独立 5556 上复用两项现有 UI 检查通过（17.565s）：相似文件名隔离/打开期间内容更新、未修改行折叠展开。无生产模型消息或原会话操作。实体手机长补丁快速打开/滚动尚未实测；安装后应保持正确行号和首尾上下文，展开显示隐藏行，更新后不混入旧文件内容。

APK 0.6.363/335、3,084,596 字节，版本/既有功能标记、三份交付及网关实际 HTTPS 下载一致。两隔离包已卸载，按命令行确认归属后关闭 5556 并确认 qemu 退出，5554 的 NekoBox 前台保持；未重启网关或共享后端。改前源码/文档及 362 包备份 D:/codex/backups/Codex-mobile-control/before-patch-intervals-0.6.363；仅清理与该备份一致的 362 重复交付包。构建 android-0.6.363-build.log、交付 deliver363.log 和 patch-intervals363 内功能/设备记录均在 D:/codex/build/Codex-mobile-control。

# 2026-10-16 Android 0.6.362 / 计价依据展开状态保留

详细统计 StatisticsCostDetails 原先使用 remember(data) 保存展开状态；手动或每分钟自动刷新返回新的 costDetail JSONObject 时，即使筛选不变，也会重新折叠。现使用 rememberSaveable(selectionKey)，以 StatisticsSelection.route() 标识当前筛选；刷新同一范围保留展开，改变筛选重置。状态初始化置于缺少计价数据的返回之前，避免临时缺字段清除状态。数据转换和曲线分组原已有 remember，不重复改动。

Release 构建通过（4m16s）；按本次状态修正范围止于构建，没有新增测试或运行模拟器/实体手机。最小手动确认：在详细统计选择 Codex，展开“计价依据与单价”，点击刷新或等自动刷新，内容应保持展开；切换计价方式或时间范围，应默认折叠。未以源码检查宣称运行交互或性能已实测。

APK 0.6.362/334、3,084,596 字节，版本与既有功能标记核对通过，三份交付和网关实际 HTTPS 下载逐字节一致；未重启网关/共享后端，未操作原会话。改前源码/文档及 361 包备份 D:/codex/backups/Codex-mobile-control/before-statistics-expansion-0.6.362；交付后仅清理与该备份一致的 361 重复包。日志 D:/codex/build/Codex-mobile-control/android-0.6.362-build.log、deliver362.log。

# 2026-10-16 Android 0.6.361 / 补丁扫描与 OpenCode 统计核实

补丁后台整理减少重复扫描：直接拆分 LF/CRLF/裸 CR 并保留末尾空行，仅 hunk 标题匹配行号正则，大小检查直接扫描，增删计数合并到既有宽度测量。保持原限制、行号、复制与取消行为。隔离 JVM 对照 150 组格式/随机样本和 162 组大小判断一致；这些数据不代表手机速度。

Release、隔离 Debug/AndroidTest 构建通过，NativePatchTest 6/6 通过；5556 性能采样 1 项通过（24.463s），文件隔离/更新、上下文展开及读取重试 3 项 UI 通过（20.057s）。同夹具长样本打开中位 3656.983→1996.2083ms，但短样本变慢；高频线程栈采样、Debug 与测试时钟开销未校准，不据此宣称普遍提速。主线程解析/测量样本保持 0。实体手机流畅度未实测。

用户要求 Web 和安卓控制台加入 OpenCode：核实现有接入已部署，无需重复改实现。当前五个只读入口（Web 原始统计、安卓详细统计、旧控制台、全部来源汇总、活动日历）一致，本周 40 条计量记录，输入 2,061,743（缓存读取 100,224）、输出 159,450（含推理 98,149），共 2,221,193 Token；原生记录金额 $0，全部汇总含 8 来源，模型小时曲线与日历有效。未发送测试消息或操作原会话。证据 D:/codex/build/Codex-mobile-control/readback-opencode361.log。

APK 0.6.361/333、3,084,596 字节，三份交付及实际 HTTPS 下载逐字节一致。两隔离包已卸载，按进程命令行确认归属后关闭 5556，qemu 已退出；5554 的 NekoBox 前台保持。未重启网关或共享后端。改前源码/文档和 360 包备份 D:/codex/backups/Codex-mobile-control/before-patch-scanning-0.6.361；仅清理与备份一致的 360 重复交付包。采样/对照/功能日志在 patch-scanning361，构建日志 android-0.6.361-build.log，交付日志 deliver361.log；均在 D:/codex/build/Codex-mobile-control。

# 2026-10-16 Android 0.6.360 / 补丁整理移出界面线程

NativeChangeDetail原先在组合阶段检查完整正文、拆行、解析行号并测量所有行宽。独立Debug设备的实际打开采样在主线程捕获到大量StringsKt拆行和patchLines调用。现按正文与文字像素大小记忆独立准备状态，由LaunchedEffect在Dispatchers.Default完成原有大小检查、行号、计数和Paint宽度测量，结果一次性回到界面；新输入拥有新状态，旧结果不混入，关闭/更换内容取消任务并在准备阶段检查取消。弹窗先显示标题、复制/关闭和文字扫光整理状态；原5000行/262144字符/超长行与60000px宽度限制、行号、上下文折叠和原文复制保留。空正文不创建整理任务，普通非补丁正文仍经过原限制检查。

基线Debug/Test构建2m58s；最终Release/Debug/AndroidTest构建5m5s通过。同一5556、同一交替短/长补丁夹具，各3次长样本为145720字符/约3000正文行。主线程patchLines样本117/129/110→0/0/0，Paint.measureText样本2/20/7→0/0/0。带观测的长样本打开中位8387.54→3656.983ms、单次最大Choreographer间隔中位6889.2672→179.4879ms。Thread.getStackTrace频繁采样、Debug设备与测试时钟均影响这些时长，采样开销未校准；该结果用于确认计算边界离开主线程，不作为实体手机延迟、帧率或普遍加速比例。基线采样1项48.642s、改后1项18.524s，均通过；另3项功能UI检查12.673s通过：相似文件名隔离及打开期间补丁更新、未修改行展开/行号、空分类/空正文/HTTP失败连续重试并保留已有补丁。没有改旧断言迎合异步准备，没有生产模型消息或原会话操作。

APK0.6.360/332、3,084,596字节，版本/既有功能标记、三份交付及网关实际HTTPS下载逐字节一致。两隔离包已卸载，按命令行确认归属的5556已关闭且进程退出，5554原NekoBox前台不变；复用原AVD，无网关/共享后端重启。实体手机长补丁打开与帧率待确认；安装360后，应先出现可关闭/复制的弹窗，整理时有文字状态，随后显示正确行号、增删与折叠内容，更新后只显示新正文。

改前源码/文档、采样夹具与359包备份D:/codex/backups/Codex-mobile-control/before-patch-preparation-0.6.360；仅清理与备份一致的359重复交付包。证据D:/codex/build/Codex-mobile-control/patch-preparation360：before/after.json、comparison.json、before/after-ui.log、functional.log、设备归属与原前台前后记录；另有patch360-before-build.log、android-0.6.360-build.log、deliver360.log。新增NativePatchOpenProfileTest仅传profile=patch时采样，普通运行跳过；没有定时清理或F盘构建历史。

# 2026-10-16 Android 0.6.359 / 文件详情失败反馈与原地重试

已选文件原先仅凭detailsDeferred/groupId显示正在读取，忽略activityErrors；失败或空响应后会一直显示等待且没有重试入口。现文件详情区分文字扫光加载、断开连接提示和错误/重试，保留已读补丁及复制按钮。NativeChangeDetail增加可选statusContent槽，加载策略留在调用方。VM不再缓存空分类；正文批次返回后保留已收到的事件，并把未返回ID标为详情暂不可用，避免把缺失记录留在无限加载状态。成功数据和357/358的取消、恢复加载机制继续复用。

Release、隔离Debug/AndroidTest构建通过（5m53s）。独立5556三项UI检查通过、32.029s：新增检查同一个文件弹窗连续经历空分类→重试→空正文→重试→HTTP503→重试成功，共2次分类/3次正文请求；各失败阶段加载提示结束、原+kept补丁仍可见、复制按钮可用，最终同时显示+kept/+new，b.kt无请求。原快速切回后文件弹窗自动恢复，以及相似文件名隔离/打开期间补丁更新两项检查通过。未发送生产模型消息或操作原会话。

APK0.6.359/331、3,084,596字节，版本/既有功能标记、三份交付及网关实际HTTPS下载逐字节一致。两个隔离包已卸载，按命令行确认归属的5556已关闭且进程退出，5554原NekoBox前台保持；复用原D盘AVD。网关与共享后端未重启。实体手机和真实断网未实测；安装359后，文件详情读取失败应显示原因并可原地重试，已有补丁应保留可读。

改前源码、文档与358包备份D:/codex/backups/Codex-mobile-control/before-change-feedback-0.6.359；仅删除与备份逐字节一致的358重复交付包。证据D:/codex/build/Codex-mobile-control/change-feedback359（ui-tests.log、设备归属、原前台前后及模拟器日志），另有android-0.6.359-build.log和deliver359.log。无定时清理或F盘构建历史。

# 2026-10-16 Android 0.6.358 / 展开详情自动恢复加载

继续检查357取消旧详情后的页面恢复。源码中操作分类和已选文件的LaunchedEffect只依赖展开状态/活动内容，快速切走再返回时这些值可能保持相同，被取消的读取不会自动重启。现将VM的activityLoadEpoch改为可观察状态，操作分类、操作正文和文件详情的加载效果均同时依赖加载代次与连接状态；连接有效且相应内容已展开/已选择时才发起读取，断开时结束自动读取效果。沿用357请求取消、去重和成功缓存，未展开内容不加载，不加入分类轮询。

Release、隔离Debug/AndroidTest构建通过（5m47s）。独立5556上新增2项和既有1项UI检查通过，共3项、32.277s：实际打开操作分类、挂住读取后同一UI回调中切走/返回，旧Call取消且无需手动load即可自动取得分类，正文仍到点击操作后才读取；实际选中a.kt并挂住分类后同样切走/返回，原文件弹窗保持并自动显示完整补丁，b.kt无请求。两项各为旧挂起分类、新分类和所选正文3次请求。原completedOperations分类/正文分层加载与跨poll缓存检查通过。没有为断言手动补发恢复请求，没有生产模型消息或原会话操作。

APK0.6.358/330、3,084,596字节，版本/既有功能标记、三份交付和网关实际HTTPS下载逐字节一致。两个隔离测试包已卸载，按命令行归属确认的5556已关闭并确认进程退出；5554原NekoBox前台保持。复用原D盘AVD/临时镜像，没有重启网关或共享后端。实体手机及真实线路断开/恢复未实测；安装358后，加载中的展开操作或文件弹窗快速切走再返回，应自动恢复内容，已成功读取的内容继续复用，未选择文件不读取。

改前源码、文档与357包备份D:/codex/backups/Codex-mobile-control/before-expanded-recovery-0.6.358；仅清理与备份逐字节一致的357重复交付包。证据D:/codex/build/Codex-mobile-control/expanded-recovery358（ui-tests.log、设备归属、原前台前后及模拟器日志），另有android-0.6.358-build.log和deliver358.log。没有定时清理或F盘构建历史。

# 2026-10-15 Android 0.6.357 / 详情请求随会话取消

操作分类、操作正文和文件补丁的loadActivity原先直接启动在viewModelScope，切走后虽丢弃结果，HTTP仍继续下载；旧请求finally还可能移除快速切回后同ID新请求的等待标记或加载状态。现跟踪当前详情Jobs，切换/新建会话、手动连接/断开和自动替换线路客户端时取消未完成请求；沿用nativeActivity的可取消HTTP。详情加载代次仅约束请求回写和收尾，旧请求不清理新代次的标记。已成功读取的分类/正文缓存继续复用，未展开内容仍不发起请求。

首次Release/Debug/AndroidTest构建通过（5m54s）；编译启动后补充自动线路切换分支，最终Release/Debug重新构建通过（4m54s）。Debug和Release连接协程字节码各确认一处更换客户端时的cancelActivityLoads调用。编译中的一次javap读取退出1、提示找不到类，当时编译器正在重建输出；等待对应任务完成后重读通过，不修改代码迎合检查。最终隔离5556运行3项UI检查通过、35.436s：新增检查同时挂住分类和正文，切走并立即切回后旧2个Call均取消、替换请求保持loading，新建会话取消替换请求，再返回可读取完整正文；原completedOperations按分类/正文分层加载与跨poll缓存检查、fileChangeSummary仅请求所选文件正文检查均通过。无生产模型消息或原会话操作。

APK0.6.357/329、3,084,596字节，版本/既有功能标记、三份交付及网关实际HTTPS下载逐字节一致。两个测试包已卸载，按命令行归属确认的5556已关闭并确认进程退出，5554原NekoBox前台保持。复用D盘原AVD/临时镜像，网关和共享后端没有重启。实体手机快速切换和真实公网/内网切换未实测；安装357后，详情加载中切走应取消旧读取，返回展开应正常读取并结束加载，已缓存详情应直接复用。自动线路分支目前是代码/编译产物核对，不当作真实线路切换运行验证。

改前源码、文档与356包备份D:/codex/backups/Codex-mobile-control/before-activity-cancellation-0.6.357；仅清理与备份逐字节一致的356重复交付包。证据D:/codex/build/Codex-mobile-control/activity-cancellation357（ui-tests.log、connection-debug/release.txt、设备归属、原前台前后和模拟器日志），另有android-0.6.357-build.log、android-0.6.357-final-build.log、deliver357.log。没有定时清理或F盘构建历史。

# 2026-10-15 Android 0.6.356 / 用量刷新正确收尾与取消

loadUsage在请求期间切换Codex模型时会丢弃旧结果，却未清除usageLoading，后续定时刷新因正在加载而不再发起；切换会话虽取消协程，原nativeJson同步HTTP仍会等待响应。现沿用既有nativeJsonAsync可取消请求，JSON读取仍在IO阶段。成功和错误按连接代次、客户端、会话选择、请求序号、模型及时间范围回写；当前请求统一在finally收尾，若模型已变化则读取当前选择。上次成功数据在刷新时继续显示，取消或过期请求不会清除新请求状态。

Release及隔离Debug/AndroidTest构建通过（6m3s）。独立5556上新增2项和既有1项UI检查通过，共3项、25.245s：1.4秒延迟期间换模型，结果最终对应新模型、近7天筛选保持且加载结束；无响应用量请求切换会话后，直接检查旧OkHttp Call已取消，新会话历史和用量正常返回；延迟刷新期间数据引用、额度卡片/趋势位置和高度保持，标题旁刷新提示正确结束。均为MockWebServer隔离夹具，没有生产模型消息或原会话操作。实体手机跨应用恢复、多会话长期流畅度仍需实机确认；安装356后，慢读取期间换模型应结束加载并显示当前数据，连续切会话应不积压旧用量请求。

APK0.6.356/328、3,084,596字节，版本/既有功能标记、三份交付及网关实际HTTPS下载逐字节一致。网关和共享后端未重启。两个隔离测试包已卸载，按命令行归属确认的5556已关闭并确认进程退出；5554原NekoBox前台不变。复用原D盘AVD和临时镜像，没有新建另一套镜像，也未重试此前被自动审批拒绝的目录清理。

改前源码、文档与355包备份D:/codex/backups/Codex-mobile-control/before-usage-refresh-0.6.356；仅清理与该备份逐字节一致的355重复交付包。证据D:/codex/build/Codex-mobile-control/usage-refresh356（ui-tests.log、设备归属、原前台前后及模拟器日志），另有android-0.6.356-build.log和deliver356.log。没有定时清理或F盘构建历史。

# 2026-10-15 Android 0.6.355 / 折叠段落参与本轮选文

NativeReplySelection原先只检索顶层时间线，已完成回合的中间助手文字移入process.completed.children后，从这些段落进入整屏选文会找不到目标，从结论进入则遗漏中间文字。现按时间线顺序遍历子块，仅收集具有replyScope的message.delta，再限定目标所属回合；保留段落间隔、重复正文的锚点偏移和原有Markdown转纯文本行为。仅点击选文时整理，不改变折叠层级、操作正文加载或滚动状态。

Release与定向NativeReplySelectionTest构建通过（4m25s）；2项检查通过、0.187s，覆盖真实nativeTimeline的折叠段落/结论两个入口、重复正文定位、下一轮隔离及生成中回复的段落顺序，排除用户、工具和reasoning.summary。改前运行既有测试退出1：旧断言按顶层消息下标取第一轮第二段，折叠后实际取到第二轮；已改用真实折叠子段及结论定位，没有为旧断言修改产品时间线。

APK0.6.355/327、3,084,596字节，包版本、既有功能标记、三份交付及网关实际HTTPS下载逐字节一致。没有重启服务、操作原会话或注入模型消息。本轮未运行模拟器和实体手机UI；安装355后，展开一轮已完成回复的过程，从中间文字或结论进入整屏选文，应包含本轮全部助手正文，并定位到所点文字，不含工具输出或下一轮消息。

改前源码、文档及354包备份D:/codex/backups/Codex-mobile-control/before-reply-selection-0.6.355；仅清理与该备份逐字节一致的354重复交付包。日志D:/codex/build/Codex-mobile-control：selection355-before.log、android-0.6.355-build.log、deliver355.log，另有Gradle原生JUnit XML。未新增定时清理或F盘构建历史。

# 2026-10-15 Android 0.6.354 / 重连保留有效模型与思考档位

修复同电脑重连时，全局模型/档位偏好覆盖当前会话独立选择，以及异步模型目录再次覆盖有效档位的问题。同步恢复和异步目录优先保留当前有效选择；目录移除模型/档位时保留原回退，首次初始化/电脑变化/重新配对及OpenCode在线确认保持，没有放宽发送条件。

Release、隔离Debug/AndroidTest构建通过（5m48s）；独立5556的3项UI检查通过（34.841s），涵盖新回归的全局/会话偏好冲突、两次重连、目录延迟与档位失效、草稿和发送可用，及原设置保留、目录503后慢响应恢复。无生产模型提示。测试包已卸载，5556已关闭，原5554/NekoBox前台不变。

APK0.6.354/326、3,084,596字节，三份交付和实际下载一致；网关保持0.6.124，无服务重启。实体手机/实际Harness档位仍待实机确认。改前源码及353包备份before-reconnect-selection-0.6.354位于D:/codex/backups/Codex-mobile-control，已删与备份一致的353重复包；证据reconnect-selection354、android-0.6.354-build.log、deliver354.log位于D:/codex/build/Codex-mobile-control。

# 2026-10-15 Gateway 0.6.124 / 未读完成时间减少日志读取

普通JSONL的完成时间改为尾部64KB逐块反向读取，找到最近开始/结束标记即停止，保留原2MB最大窗口、跨块UTF-8、半行规则、压缩日志及mtime/size缓存。实际72条会话只读检查、44份日志，读取72.55→2.88MB，首次未读检查209.46→88.54ms；这是现场快照，不作一般帧率/延迟结论。

TypeScript构建、新增1项含7组边界/缓存更新的检查和既有thread-read-state检查通过。两次idle/RPC检查后仅重启网关PID38856，3个安装文件及health=0.6.124读回一致，来源筛选与跨来源include保留；Web与共享Codex后端不变，无原会话测试消息。安卓仍为0.6.353，无新APK，无需重装；实体手机首次侧栏和前后台恢复仍待实测。

备份before-completion-tail-0.6.124位于D:/codex/backups/Codex-mobile-control；只读测量和检查日志sidebar-headers124、gateway124构建/部署/读回日志位于D:/codex/build/Codex-mobile-control。本轮旧read-state检查产生的C:/Users/YeJianbo/AppData/Local/Temp/cmc-read-state-Cc7GEc递归删除被自动审批拒绝，暂留，未绕过；新增检查夹具已正常自清理。

# 2026-10-15 Gateway 0.6.123 / 状态更新保留已写入事件

设备在线、会话状态/标题和审批更新原先会同步删除并重写最近1000条事件，重连登记也经过此路径。现普通save只保存元信息，保留已由appendEvent提交的事件；旧JSON迁移、删会话、覆盖回合和终端收尾继续显式替换历史。隔离12会话/1000事件/96次更新，重复序列化96,000→0，中位130.9067→0.4296ms，重开后事件内容与顺序保持；改后计时与回归并行，不作通用性能或实体机断联结论。

TypeScript构建通过，新增1项元信息不触碰events及历史替换检查、既有8项历史/失败回滚检查通过，共9项。首次检查的TS加载器和undefined断言问题已修正并复跑。部署前两次idle/RPC检查通过，仅重启网关PID50636，3个安装文件及health=0.6.123读回一致；来源筛选和跨来源include正常，Web和共享Codex后端保持，无原会话测试消息。安卓保持0.6.353，无新APK，无需重装；实体手机长期多会话和前后台恢复仍待实机确认。备份before-metadata-events-0.6.123位于D:/codex/backups/Codex-mobile-control，证据metadata-saves123及gateway123构建/部署/读回日志位于D:/codex/build/Codex-mobile-control。

# 2026-10-15 Android 0.6.353 / 补丁按完整路径选择

修复a.kt混入a.kt.bak及未知目标回退显示整份补丁的问题。安卓与网关Web按apply_patch/Git/unified文件头和重命名元信息匹配完整路径；未命中的已知文件头返回空，无文件头片段保留。安卓选中事件与补丁提取使用remember绑定来源和选中文件，普通重组不重复提取，打开时内容更新仍生效；详情状态提示拆成正在读取或记录未保存补丁。

Release、隔离Debug/AndroidTest和定向单测构建通过（5m42s）；安卓NativePatchTest 4项与Web 4项通过。独立5556的3项UI检查通过（25.161s）：相似路径隔离、打开时更新和切换、原按需请求、原未修改行折叠。测试包已卸载，5556已关闭并确认退出，原5554的NekoBox前台不变。复用已有隔离镜像；原D盘镜像清理此前被自动审批拒绝，本轮未重试。

APK0.6.353/325、3,084,596字节，三份交付及实际下载一致。网关Web静态模块已更新并HTTPS核对，刷新页面生效，无服务重启或原会话模型提示。实体手机长补丁体验尚未实机确认。备份before-patch-selection-0.6.353位于D:/codex/backups/Codex-mobile-control，已删与备份一致的352重复交付包；证据patch-selection353、android-0.6.353-build.log、deliver353.log位于D:/codex/build/Codex-mobile-control。

# 2026-10-15 Android 0.6.352 / 补丁行号解析复用固定正则

NativePatch逐行解析原先每行重新构造hunk正则，文件提取也每次构造相同分段正则；现由模块各初始化一次复用，正文、行号、分类、文件提取和未修改行折叠保持。隔离JVM对照3633行/42,472字符，解析中位4.423→1.9649ms，当前线程分配7,774,672→2,659,408字节；8组样本的行号/正文/分类及文件提取逐项一致。源码与测量候选一致，字节码确认构造仅在静态初始化；不作为实体手机帧率结论。

Release构建通过（4m14s），APK0.6.352/324、3,084,596字节，三份交付和网关实际下载一致。没有服务重启或原会话测试消息；实体手机打开长补丁、横向滚动和展开上下文未实机确认。改前源码及351包备份D:/codex/backups/Codex-mobile-control/before-patch-parser-0.6.352，已清理与备份一致的351重复交付包。证据patch-parser352、android-0.6.352-build.log、deliver352.log位于D:/codex/build/Codex-mobile-control，无定时清理。

# 2026-10-15 Android 0.6.351 / 补丁详情保留文件摘要

补丁详情载入后，完整file.changed/diff.updated原先会替换掉轻量摘要，导致后续时间线更新重复扫描正文。现由GatewayClient.nativeActivity在已有IO加载阶段一次准备缺失的fileChanges并缓存；完整补丁、已有摘要、事件身份、两层折叠和按需请求保持。纯JVM样本10份/268,320字符，摘要准备后时间线整理中位9.7689→0.1855ms，当前线程分配12,717,848→16,432字节；首次冷准备93.4467ms发生在加载阶段。完整行/汇总和7种边界对照通过，未作为实体机帧率结论。

Release、隔离Debug与AndroidTest构建通过（4m52s）。独立包summary351.remotecheck在5554运行1项无Activity的MockWebServer详情解析检查，OK(1 test)、0.604s，正文、两种摘要和已有计数保持；原NekoBox前台不变，两个测试包已卸载。APK0.6.351/323、3,084,596字节，三份交付及网关实际下载一致；网关保持0.6.122，无服务重启或原会话测试消息。实体手机长补丁展开/收起及持续刷新尚未实机确认。

此前350的独立5556 UI检查及三种滚动采样已收尾，结果见work-status.md本版本记录与D:/codex/build/Codex-mobile-control/ui-runtime350；已关闭5556，5554保持。临时镜像删除被自动审批拒绝，暂留D盘。351改前源码和350包备份D:/codex/backups/Codex-mobile-control/before-file-summary-0.6.351，已删与备份一致的350重复交付包。日志android-0.6.351-build.log、deliver351.log与file-summary351目录，无定时清理。

# 2026-10-15 Android 0.6.350 / 时间线复用固定类型集合

继续检查流式更新时的完整时间线整理。字节码中确认原NativeTimeline函数存在运行时setOf调用；其中固定类型判断在事件循环及消息签名计算内重复创建集合。现由模块内TimelineTypes一次初始化并复用13组固定类型/状态集合，涵盖文本、操作、生命周期、压缩、重试和可见类型；每次仍按当前事件完整整理，没有增加时间线结果缓存或改变事件分类、折叠/去重与排序规则。

先在D盘副本进行同进程JVM对照，源码候选逐字节一致后应用。4839条/10轮混合事件，预热后交替24次：整理中位10.8315→6.7131ms，当前线程每次分配字节中位8,236,176→1,883,424（约减少77%）；分配计数来自ThreadMXBean，不是进程总内存或实体手机测量。两组事件样本各组合running/warnings，共8种状态；所有外层消息、折叠子项、操作、事件字段、重试提示和文件汇总逐项一致。含压缩、审批、失败重试和迟到工具回执。该结果仅证明隔离计算边界，未宣称实体机帧率或多会话断联修复。

隔离编译首次因测试命名空间漏导入NativeImage/NativeUploadedFile/NativeAttachment退出1，补齐导入后通过，未影响产品源码或现网。证据D:/codex/build/Codex-mobile-control/timeline-types350：Before.kt、Candidate.kt、Support.kt（原定时消息纯函数副本）、Check.kt、check.ps1、check.log；NativeTimeline.kt为已应用候选。

Android Release构建通过（4m9s）。APK0.6.350/322、3,084,596字节，aapt版本及既有功能标记检查通过；三份交付与网关实际HTTPS下载逐字节一致。网关保持0.6.122，无服务重启、原会话恢复或模型测试消息。实体手机长会话流式更新、滑动、折叠和前后台恢复仍待实际确认；安装350后，消息顺序、已更改汇总及两层折叠应保持，新增输出继续及时显示。

改前源码和349安装包备份D:/codex/backups/Codex-mobile-control/before-timeline-types-0.6.350；仅删除与备份一致的349重复交付包，无定时清理。日志D:/codex/build/Codex-mobile-control/android-0.6.350-build.log、deliver350.log。

# 2026-10-15 Android 0.6.349 / 展开长操作减少字符串复制

继续检查347按需生成正文后的计算成本：单条操作打开后，原detail惰性计算仍逐段通过字符串拼接复制累计正文。将累计正文改为StringBuilder，沿用原重复片段包含判断、换行、空白处理、最长思考摘要与计划/diff替换规则，最后只生成一次结果字符串。正文仍在打开后于Default线程整理，未展开不生成，原折叠层级、分段顺序和显示内容保持。列表已单独生成子项时，NativeToolGroup不再重复整理一份未使用的条目。

先在D盘副本对照候选，再将逐字节相同的实现应用到源码。隔离同进程JVM样本800段、436,690个输入字符，预热后交替12次：正文生成中位195.2635→30.7894ms。正文与元信息逐项一致，另外覆盖重复片段、空白、Unicode、思考、计划替换、文件/diff替换共6类样本。此为纯计算边界的JVM对照，不作为实体手机展开耗时或帧率结论。证据D:/codex/build/Codex-mobile-control/operation-body349：Before.kt、Candidate.kt、Check.kt、check.ps1、check.log；NativeActivity.kt为已应用候选。

Android Release构建通过（4m11s）。APK0.6.349/321、3,084,596字节，aapt版本及既有功能标记核对通过，三份交付与网关实际HTTPS下载逐字节一致。网关保持0.6.122，本轮没有服务重启或原会话模型提示。实体手机长操作展开、持续追加输出与退出动画未实机检查：安装349后，折叠项应只显示标题，点开后完整正文持续更新，收起层级及分段顺序保持。

改前源码与348安装包备份D:/codex/backups/Codex-mobile-control/before-operation-body-0.6.349；仅清理与备份一致的348重复交付包，无定时清理。日志D:/codex/build/Codex-mobile-control/android-0.6.349-build.log、deliver349.log。多会话长期连接与实体手机流畅度仍需实际确认。

# 2026-10-15 Android 0.6.348 / 流式 Markdown 缓存保留最新版本

继续检查正文增长时的主线程工作。原Markdown缓存按完整源文字作为key，流式回复的旧前缀不断占用预算并挤走已结束消息；单条超出预算的正文也会在put时把其他缓存全部挤走。现为会话正文按threadId、消息显示身份及文档段落传递owner，同一位置只保留最新源文字和渲染结果；缓存命中同时比较源文字，更新不会返回旧正文。超出预算的内容照常完整解析显示，但不进入缓存、不清空其他消息。没有owner的普通Markdown仍按源文字共享缓存；原解析器、链接处理、中文强调、数学和代码显示路径与更新频率保持。

Release、隔离Debug及AndroidTest构建通过（合计4m58s）。在emulator-5554以新包名com.localcodex.control.cache348.remotecheck运行6项无Activity缓存检查，全部通过（0.523s）。同一Android运行时用原缓存快照与新策略对照：40次流式更新后返回已结束消息，额外解析1→0；超长正文后返回旧消息，额外解析1→0；渲染文字一致。另覆盖源更新不返回旧文字、链接Span保留、中文标点闭合强调、代码与转义文字、渲染尾空白。检查前后前台Activity一致，仍为NekoBox，未启动界面、读取配对数据或发送模型消息。这是缓存行为验证，未作为实体手机帧率或多会话断联结果。

临时对照源码保存在D:/codex/build/Codex-mobile-control/markdown-cache348，已从工作树移除且仅删除与该副本相同的两个临时文件；隔离测试包和应用已卸载。保留实际回归NativeMarkdownRenderCacheTest.kt中的两项新检查及原三项。无需重编已通过的正式产物。

APK0.6.348/320、3,084,596字节，aapt版本及既有功能标记核对通过，三份交付与网关实际HTTPS下载逐字节一致。网关保持0.6.122，本轮未重启服务或共享后端。实体手机快速返回长会话、滚动及切换会话的流畅度未实机确认；安装348后，正文显示与选择应保持完整，流式更新结束后再查看前文应复用仍在预算内的缓存。

改前源码与347安装包备份D:/codex/backups/Codex-mobile-control/before-markdown-cache-0.6.348；仅清理与备份一致的347重复交付包，无定时清理。日志D:/codex/build/Codex-mobile-control/android-0.6.348-build.log、deliver348.log；实际缓存对照、6项结果与前台记录见markdown-cache348/instrumentation.log、run.log、foreground-before.txt、foreground-after.txt。

# 2026-10-15 Gateway 0.6.122 / 同一事件合并提交

继续优化实时事件的同步写入。StateStore.appendEvent原先分别提交原生历史、Codex窗口、重连缓存和缓存裁剪；隔离故障注入确认，重连缓存INSERT失败后，Codex与OpenCode均仍留有内存事件和一条历史归档，重连表却没有此事件。现将同一事件的数据库写入包在一个同步事务中，全部提交成功后才更新内存ring。写入失败回滚历史、窗口及重连记录，原事件可重试；保留逐条及时持久化、事件顺序和原格式，没有异步缓写。

本轮沿用SQL复用后的代码作基线，1600条/11会话隔离磁盘样本：总写入570.4096→519.4757ms，中位0.2855→0.2543ms，P95为0.4402→0.4448ms（基本不变），定时器最大延后19.2903→18.1447ms。正文、顺序和1000条重连缓存逐项一致；不作为实体手机断联已解决或一般性能提升的证据。样本、改前故障结果及对照位于D:/codex/build/Codex-mobile-control/event-transactions122。

TypeScript构建通过。新增1项定向故障回归覆盖Codex/OpenCode失败后无历史/窗口/重连残留、随后重试成功、同一StateStore关闭重开后可写；原9项历史、窗口、摘要及详情回归通过，共10项。故障触发器只存在于测试临时数据库，未操作生产数据库或给原会话注入消息。

部署前两次确认托管任务空闲与共享RPC=0，仅重启网关PID47556，Web保持21112，共享Codex后端URL/token/进程不变。3个安装文件与源码产物逐字节一致，health=0.6.122；实际会话来源筛选及跨来源include读回通过。安卓保持0.6.347，无新APK，无需重新安装；实体手机多会话持续使用、滑动与前后台恢复仍待实际确认。

改前源码/编译及安装备份D:/codex/backups/Codex-mobile-control/before-event-transactions-0.6.122。构建/部署/读回日志D:/codex/build/Codex-mobile-control/gateway122-build.log、deploy-gateway122.log、readback-gateway122.log。回归server/scripts/event-write-atomicity.test.mjs；本轮没有新安装包或定时清理。

# 2026-10-15 Gateway 0.6.121 / 实时事件写入复用 SQL

继续定位多会话时的主循环占用，检查StateStore.appendEvent与CodexLiveHistory.append。每个流式事件重复准备固定SQL，且在重连缓存与原生历史之间重复JSON序列化。现将事件插入、缓存裁剪、外部历史归档和Codex窗口更新的5条热路径语句按当前数据库连接复用；关闭/重新加载数据库时清理或重建。每条事件只序列化一次并传给对应归档。保留原逐条写入、事件顺序、存储格式、1000条重连缓存与历史窗口规则，没有引入异步缓写或改写持久化策略。

定向隔离磁盘样本1600条流式事件、11个Codex/OpenCode会话：流式阶段prepare调用5866→3，总耗时737.2081→591.6011ms，中位每事件0.3714→0.2968ms，P95为0.6943→0.5236ms，定时器最大延后35.8414→20.3056ms。两次完整正文、事件顺序及1000条重连缓存逐项一致。此为本机隔离样本，不当作实际手机延迟、长期多会话性能或断联问题已解决的证据。脚本、输出与逐项对照快照D:/codex/build/Codex-mobile-control/event-writes121。

TypeScript构建通过；9项既有定向回归通过：Codex长回复/跨会话/保存重启/窗口裁剪/自动目标历史6项，外部Harness历史1项，WebSocket摘要及按ID详情2项。没有扩跑无关测试。部署前两次确认托管任务空闲与共享RPC=0，仅重启网关PID17068；Web保持21112，共享Codex后端URL/token/进程不变。4个安装文件逐字节一致，health=0.6.121，原有来源筛选和跨来源include实际读回通过。无模型提示或原会话测试消息。

安卓保持0.6.347，无新APK，无需重新安装。实体手机多会话、跨应用恢复和长期断联仍待实际确认。改前源码/编译文件及安装备份D:/codex/backups/Codex-mobile-control/before-event-writes-0.6.121；构建与部署读回日志D:/codex/build/Codex-mobile-control/gateway121-build.log、deploy-gateway121.log、readback-gateway121.log。

# 2026-10-15 Android 0.6.347 / 折叠操作不预先拼接正文

继续检查流式操作列表：原nativeActivityItems在分组展开后会为所有子项拼接完整命令输出，即使单条操作仍折叠；后续流式更新会再次处理。将纯操作整理移至NativeActivity.kt，列表阶段仅整理标题、状态、文件、事件ID及延迟标记，分组使用映射索引和事件引用，不拼接正文。单条操作打开后才在Default后台线程生成并缓存该项正文；关闭时保留已准备内容供退出动画使用。两层折叠、分段顺序、操作标题、补丁入口及实时按需获取继续沿用。

定向隔离JVM对照保留改前原函数，使用800段/579,090字符的输出；同进程预热后交替12次，列表整理中位141.0575→1.9000ms。通过惰性状态检查确认列表阶段未生成正文；样本中操作起止/重复输出、补丁、diff和计划替换、文件、思考及延迟条目的正文、标题、状态、顺序、ID与旧实现一致。此结果只证明该隔离计算边界，不当作实体手机帧率或长期多会话断联结果。证据D:/codex/build/Codex-mobile-control/lazy-operation347：Before.kt、Check.kt、check.ps1、check.log。

Android Release构建通过（4m51s）。APK0.6.347/319、3,084,596字节，aapt版本核对通过，三份交付及网关实际HTTPS下载逐字节一致。网关保持0.6.120，本轮没有服务或共享后端重启，没有原会话测试消息。实体手机折叠列表滚动及展开长输出未实测：安装347，展开操作分组但保留子项折叠，应只显示标题/状态；点开某一项后显示完整正文，收起仍有退出动画，新增输出能继续更新。

改前源码和346安装包备份D:/codex/backups/Codex-mobile-control/before-lazy-operation-body-0.6.347；仅删除与备份一致的346重复交付包，无定时清理。日志D:/codex/build/Codex-mobile-control/android-0.6.347-build.log、deliver347.log。仍需继续确认实体机多会话与前后台恢复的实际体验。

# 2026-10-15 Android 0.6.346 / 回到前台确认实时连接

代码检查确认：回到前台只唤醒已有重试和刷新状态，未验证仍标为已连接的WebSocket；半断开的连接需要等待常规心跳发现。新增foreground-websocket-probe能力与已认证connection.ping/pong应答。手机回到前台且服务端支持时，在当前WebSocket发起一次匹配requestId的检查；内网最多2秒、公网最多5秒，无应答取消对应旧socket并唤醒已有重连循环。健康连接原位复用，不清空会话或模型缓存。没有改变发送按钮的现有条件。

应答在网络监听器中直接完成，不进入聊天事件、历史、通知或模型调用；网关仍先验证当前授权。检查跟随前后台状态取消，切换电脑或断开连接也取消；结果绑定原socket，迟到结果不取消同一客户端的新连接。旧网关无此能力时沿用原流程。

网关TypeScript、Android Release构建通过（4m48s），本轮未扩大测试。部署前两次确认托管任务空闲、共享RPC=0，只重启网关PID21616，Web保持21112；4个安装文件逐字节一致，health=0.6.120，共享Codex后端URL/token/进程不变。实际已认证本机WebSocket三次应答ID与内容完全匹配，往返22.33/0.66/0.50ms；仅是本机应答读回，不是手机端恢复耗时。回读脚本首次因Windows ESM绝对路径格式退出1，修正file URL后通过，无产品改动或模型请求。

APK0.6.346/318、3,068,212字节，aapt版本及DEX中的新能力/ping/pong标记核对通过，三份交付与网关实际HTTPS下载逐字节一致。备份D:/codex/backups/Codex-mobile-control/before-foreground-probe-0.6.346；只清理与备份一致的345重复交付包，保留备份，不设定时任务。日志D:/codex/build/Codex-mobile-control：gateway120-build.log、android-0.6.346-build.log、deploy-gateway120.log、readback-gateway120.log、readback-foreground120.log、deliver346.log。

实体手机跨应用返回、切换Wi-Fi与长期多会话断联未验收。最小手动检查：安装346，保留当前会话，切到其他应用再返回；健康连接应保持可用；网络已失效时应在检查超时后进入重连，无需等待常规心跳。原会话没有注入测试消息、恢复或重启共享后端。本轮解决已连接socket的存活检查空档，不将其作为所有发送按钮等待或断联原因的结论。

# 2026-10-15 Android 0.6.345 / 实时操作详情按需加载

OpenCode统计继续保留在Web、安卓详细统计及旧控制台，支持单来源、全部汇总、模型小时曲线和活动日历。部署后五个只读入口一致：今日40条，输入2,061,743（缓存100,224）、输出159,450（含推理98,149）、总2,221,193 Token，原生估算$0；all包含8来源。没有发送模型测试消息或修改原会话。

实时WebSocket新增显式activityDetails=deferred选项与mobile-live-activity-details能力。新版安卓前台按服务端能力启用，后台通知连接也使用摘要；旧客户端默认仍收完整操作。仅工具操作、文件变化和diff按需加载，正文、思考、计划、审批与生命周期保持实时完整。摘要保留replayed、turnId、requestId、subagent和文件增删摘要；完整正文仍持久化并提供给内部订阅者。详情接口按事件ID使用现有唯一索引读取，不再读取整段历史。

展开操作会跟随新增事件ID取回详情，同ID在途合并、已缓存不重取、失败不自动反复请求，保留手动重试。快速切换会话后无论旧请求结果是否采用，都会清理对应在途和加载标记。

TypeScript与Android Release构建通过（4m58s）；新增2项隔离定向检查及既有1项历史折叠检查通过：默认/摘要WebSocket、重连标记、正文审批透传、完整存储、超出重连缓存的Codex/OpenCode事件按ID读取与跨会话隔离。隔离loopback样本160,201字节操作降为229字节摘要，仅表示该样本载荷变化。未进行实体手机多会话持续连接与前后台流畅度实测；安装345后，折叠操作应不加载正文，展开可见完整输出并持续更新，切换回来不应卡在加载中。

部署前两次确认托管任务空闲与共享RPC=0，只重启网关PID40464，Web保持21112，共享Codex后端URL/token/进程不变。8个安装文件与构建源逐字节一致，health=0.6.119且能力已读回。APK0.6.345/317、3,068,212字节，三份交付及网关实际下载一致。改前备份D:/codex/backups/Codex-mobile-control/before-live-activity-0.6.345；仅清理与该备份一致的344重复交付包，不设定时清理。日志D:/codex/build/Codex-mobile-control：gateway119-build.log、android-0.6.345-build.log、deploy-gateway119.log、readback-gateway119.log、readback-opencode345.log、deliver345.log。定向检查server/scripts/mobile-live-activity.test.mjs。

# 2026-10-15 Gateway 0.6.118 / DeepSeek 原生扫描并发

继续排查主界面响应，测量DeepSeek原生日志扫描：6个有用户消息的会话对应253个原生目录（包含空目录/探测会话），扫描需要268次readdir、253次stat、253次readFile，旧实现同时仅1次I/O。最初独立读回432.67ms、最大事件循环停顿16.07ms；这轮确认主要等待来自串行I/O，因此保留现有解析与历史工作线程结构，未引入新的线程或缓存机制。

目录发现和文件读取改为最多8路并发；按原目录顺序收集结果，重复session ID的覆盖顺序保持。沿用现有文件revision缓存，读取失败继续保留上次完整快照。Codex来源过滤仍沿用117，跳过无关DeepSeek扫描。

TypeScript构建通过。同进程对照本机同一批日志：281.45→95.53ms，I/O次数一致，并发1→8，6会话/57事件的完整内容和顺序相等；最大事件循环停顿15.43→14.16ms。未变文件重新扫描41.06ms，readFile=0。定向隔离样本确认逆序完成的文件不改变重复ID覆盖顺序，坏Zstandard帧读取失败仍保留原快照。样本仅在D盘构建目录创建，范围核验后清理；原生目录只读、无模型提示。

部署前两次确认网关托管任务空闲/共享RPC为0；仅重启网关PID38428，Web保持21112，共享后端URL/token/进程不变。安装deepseekNativeSessions.js及package/lock三个文件与编译源逐字节一致，health=0.6.118。真实接口读回：并发条件下Codex72条473.61ms、DeepSeek6条160.98ms，来源筛选与跨来源include保留通过；不将该快照当作长期手机延迟或断联结论。没有向原会话写入或发送测试消息。安卓保持0.6.344，无新APK。

备份D:/codex/backups/Codex-mobile-control/before-deepseek-scan-0.6.118；日志D:/codex/build/Codex-mobile-control：deepseek-loop-before118.log、deepseek-io-before118.log、check-deepseek-scan118.log、gateway118-build.log、deploy-gateway118.log、readback-gateway118.log。手机前后台恢复与多会话持续连接仍需继续定位。

# 2026-10-15 Gateway 0.6.117 / 侧栏来源读取

主界面性能排查确认：api/threads按agent筛选前，listThreadsWithCodexHistory仍无条件读取全部DeepSeek原生会话。已按实际来源跳过无关扫描；全部来源、DeepSeek，以及include显式保留DeepSeek会话的请求继续读取原生数据。需要多个来源时，Codex历史索引与DeepSeek列表并行读取。其他调用默认行为保持。

编译通过。已部署旧模块与新模块的本机只读对照：旧合并列表首次337.68ms，新过滤来源列表41.44ms；过滤后的258条和全部264条的ID、名称、目录、子代理与置顶元数据一致。定向计数确认过滤请求原生DeepSeek读取0次、默认请求1次。独立组件基线中DeepSeek首次310.46ms、缓存内0.01ms，桌面索引约16–24ms。该对照是组件冷读，未作为长期手机性能或断联修复结论。

实际网关读回：health版本0.6.117；并发查询时Codex页面72条（含置顶保留）418.39ms，DeepSeek6条499.12ms；Codex页面不混入DeepSeek，跨来源include仍保留指定会话。改前同一类真实接口快照冷839.13ms/热84.2ms；与新读回并发条件和缓存状态不同，不作为严格端到端加速比。

部署前两次确认网关托管任务空闲、待处理共享RPC为0；仅重启网关（22972），Web保持21112，共享后端URL/token/进程不变。4个安装文件与源码构建产物一致：index.js、codexSessions.js、package.json、package-lock.json。未向原会话写入或发送模型测试消息。安卓保持0.6.344，本轮无新APK。

备份D:/codex/backups/Codex-mobile-control/before-sidebar-source-read-0.6.117；日志D:/codex/build/Codex-mobile-control：foreground-baseline.json、sidebar-component-baseline.json、check-sidebar-source117.log、gateway117-build.log、deploy-gateway117.log、readback-gateway117.log。多会话持续断联和实际手机前后台延迟仍需继续定位，当前证据只确认无关扫描被移除。

# 2026-10-15 Web / 统计刷新保留阅读状态

统计整块DOM刷新现在按实际视图（标签、来源、时间范围、筛选与计价）保存阅读状态：计价说明、速度模型的展开状态，表格/活动日历/模型列表滚动，曲线缩放与“全部”适配模式，选中模型，以及页面位置。数据刷新后先绑定图表，再恢复交互状态；模型选择按名称恢复，不随用量排序错位。自定义起止时间尚未提交的输入和当前筛选/缩放焦点也保留，来源与时间范围之间的缩放不串用。移除旧的仅速度模型全局保存机制，缓存沿用24视图上限。临时悬浮提示在内容替换时关闭。

Web bundle构建通过；针对实际丢失状态的DOM检查通过：计价/速度展开、表格滚动、日期草稿、曲线缩放与滚动、模型重排后的选择、焦点、适配模式与后续缩放交互。部署后真实内置浏览器验证OpenCode：刷新前后zoom=1.6、selected=deepseek-v4.1-flash-free、scrollLeft=411.2000122070313，更新结束aria-busy=false。排序重排与日期草稿由隔离DOM检查覆盖，未宣称为实体安卓结果。

只原子更新已安装app.js，与编译产物逐字节一致；没有服务重启、共享端点变化、模型调用或原会话写入。安卓仍为0.6.344，无新APK。源码及安装文件改前备份：D:/codex/backups/Codex-mobile-control/before-statistics-reading-20261015。日志：D:/codex/build/Codex-mobile-control/check-statistics-reading.log、deploy-statistics-reading.log、readback-statistics-reading.json。

# 2026-10-15 Android 0.6.344 / 统计加载、失败与未采集状态

安卓旧统计页将匹配筛选的快照与可用计量分开：coverage.available=false时首卡数值显示—，保留所选时间范围和未发现记录说明；真实可用来源的0用量不改变。断开连接且无快照时明确提示连接电脑。详细统计原有首卡反馈已核对保留，未修改该模块。

Web首次读取失败显示内联错误和“重新读取”，来源选择器保持可用，首次失败不再使整个工作台进入启动错误页。已有数据刷新失败时保留内容；失败视图更新轮询时间，避免每2秒重复失败请求。单来源全部失败、全部来源无可用计量、初次额度读取均不再显示假0或结束后仍称正在读取。真实0用量及原生$0金额继续保留。重试只重新读取统计，不启动Codex索引；加载仍位于固定按钮。

Web bundle构建通过；8项针对已确认失败状态的定向检查通过，覆盖视图内失败恢复、错误轮询间隔、来源选择保留、失败来源重试、首次额度非0、未采集非0、真实0/$0和刷新旧内容保留。未扩大测试范围。静态文件已原子更新且与源码产物逐字节一致；本轮未重启任何服务，共享端点文件保持不变，没有测试消息或原会话写入。

Android Release构建通过（6m 39s）；APK0.6.344/316，3,068,212字节，三份交付及网关实际下载一致。实体手机未实测：安装344后查看未采集来源，应显示—与未发现说明；真实有记录的来源保持原数字；断开连接且无缓存时提示连接。Web网络失败分支使用隔离返回验证，未让生产服务故意离线。

保留343安装包及改前源码：D:/codex/backups/Codex-mobile-control/before-statistics-states-0.6.344；仅清理与备份一致的343重复交付包，无定时清理。日志位于D:/codex/build/Codex-mobile-control：check344-states.log、deploy344-ui.log、android-0.6.344-build.log、deliver344.log。

# 2026-10-15 Android 0.6.343 / OpenCode 统计体验

沿用342已接入的OpenCode统计：Web、安卓详细统计、旧控制台均可单选OpenCode或计入全部来源；Token、输入输出/缓存/推理、模型小时曲线和年度活动日历保持统一口径，原生费用0/null不套付费参考价。

Web按统计视图合并在途请求，缓存失败仅删除自身；快速切换后旧响应不会覆盖当前筛选。OpenCode活动日历不再等待Codex索引，单来源更新不重建无关Codex索引；多来源结果按帧合并绘制。加载文字在固定宽度更新按钮内扫光，移除额外撑高的加载段落，保留筛选焦点、刷新时面板高度；常用筛选动画缩为150ms淡入。实际浏览器确认OpenCode今日77.1万Token、缓存命中6.8%、费用$0，按小时模型曲线和模型明细可见。

后端每请求检查OpenCode DB/WAL高精度状态，源变化后立即读取，无变化复用结果；计量相同时不重复保存，新增计量仅更新变化条目。固定快照对比：无变化重读平均45.29→1.54ms，首读52.08→51.39ms，11次请求保存操作12→2，计量完全一致。WAL新增在下次请求可见，纯会话标题变化和checkpoint不重写相同计量；反馈实际readAt/checkedAt。证据位于D:/codex/build/Codex-mobile-control/opencode-runtime/statistics-experience343。

Web构建、既有OpenCode展示检查及针对缓存旧失败/并发合并/独立日历的定向检查通过。后端4/4定向检查通过。部署只重启Web PID21112；网关保持PID49060，共享Codex后端URL/token/进程不变。五个实际只读统计入口一致：当时今日19条、input721704/cached48896/output48913(含reasoning29891)/total770617，费用0；all包含8来源，小时曲线和年度日历有数据。未发送模型测试消息、未修改原会话。

安卓统计HTTP已接可取消请求，同筛选在途去重，缓存及回写按来源/时间/计价匹配；详情按当前route加载，同筛选刷新保留内容和滚动，统计页不再跟随读取无关info。8来源两行可见，刷新文字位于首卡标题旁，去掉工具栏spinner。Android Release构建通过（7m 17s）；APK0.6.343/315，3,068,212字节，三份交付及网关实际下载一致。实体手机快速切换、刷新滚动及不同字号尚未实机确认；安装343进入统计选择OpenCode，应与Web同口径且无上一来源数字残留，同筛选刷新不跳回顶部。

备份位于D:/codex/backups/Codex-mobile-control/before-statistics-experience-0.6.343，保留342安装包和改前源码；仅清理与备份一致的重复342交付包，无定时清理。日志：android-0.6.343-build.log、deploy343.log、readback343.log、deliver343.log、check343-web.mjs。

# 2026-10-15 Android 0.6.342 / OpenCode 控制台统计

Web统计、安卓详细统计与旧电脑控制台入口增加OpenCode；来源筛选、全部汇总、Token/输入/输出/缓存命中率、模型小时曲线与年度活动日历沿用现有交互。Web选OpenCode活动时隐藏无关Codex活跃分钟，不再依赖Codex索引已有文件才能展示来源日历。Token继续用万/亿，单日曲线按小时。

电脑权威后端新增src/opencode-usage.mjs，只读原生opencode.db。以step-finish逐调用用量为准，缺步骤才使用message兜底，并处理兜底替换、fork历史和累计字段去重。原生input不含缓存、output不含reasoning，后端统一加回后输出同现有Harness结构，前端不再累加。费用basis=native_recorded，使用OpenCode本地估算，0保留为0、缺失为null；不标作供应商账单、不套ECNU或同名付费参考价。原生工具与活动数据随该来源摘要提供；现有Codex日志活动及原生速度视图保持原口径。

Web app.js/analytics-panel.js/logos.js、电脑external-usage.mjs/harness-usage.mjs及新增读取器、F网关localConsole.ts/mobileStatistics.ts和安卓来源白名单完成接线。Web bundle、网关TypeScript编译通过；Android Release BUILD SUCCESSFUL in 5m7s。后端定向与现有external检查4/4通过；手机投影检查确认缓存/推理不重复、0/null保留；Web加载态与原生0金额展示检查通过。

部署后实际只读/API读回通过：电脑external/usage、手机详细tokens、旧local-console/statistics、all汇总、activity日历共五入口。读回时今日5条，input134,011、cached7,680、output194（含reasoning97）、total134,205，native记录费用0；Web与两个手机统计入口数字一致，all的8来源包含OpenCode、按小时模型曲线与年度日历有数据。没有发送测试消息或恢复/修改原会话。实体手机界面尚未实机检查：安装342后进入统计选择OpenCode，预期数字与Web相同，全部来源含其用量，免费DS原生记录金额为$0。

APK0.6.342/314，3,068,212字节，三份交付和实际网关下载逐字节一致。已激活Web PID5268、网关PID49060；部署6个变更文件逐字节检查通过，共享Codex后端URL/token/进程不变。备份D:/codex/backups/Codex-mobile-control/before-opencode-statistics-0.6.342，旧341 APK保留在备份，仅删除重复交付包，无定时清理。构建/部署/读回日志D:/codex/build/Codex-mobile-control：web342-build.log、gateway342-build.log、android-0.6.342-build.log、deploy342.log、readback342.log、deliver342.log；原生读取验证见opencode-runtime/statistics-check。

# 2026-10-15 Android 0.6.341 / OpenCode 模型分组与目录修复

手机和网关网页的 OpenCode 模型按供应商分组，输入栏及列表行只显示模型简称。供应商 ID、名称、简称由真实 ACP 目录提供并写入手机缓存；兼容旧 API，传输模型 ID 不变。目录更新后保留失效选择并提示重新选择，禁止提交；不自动替换为其他免费或付费模型。

原 `opencode/deepseek-v4-flash-free` 在当前官方 models.opencode.ai 目录已标记 deprecated，本机 2026-08-16 缓存尚无该标记，默认禁用刷新使旧项仍被展示，实际调用得到 Model is unavailable。恢复原生刷新，过期目录先等待官方 `models --refresh` 完成；五分钟内复用缓存，并发合并，显式离线/静态目录设置继续生效。目录缓存变更纳入现有失效机制。官方新 `opencode/deepseek-v4.1-flash-free` 当前输入/输出价格为 0，真实档位 low/high/max/default，未改用户默认模型或账号配置。

另修 OpenCode 子进程的 npm 默认缓存：使用自身可写缓存目录，保留显式大小写环境变量配置，不改 npmrc。隔离检查原先 EPERM mkdir D:/Program Files/nodejs/node_cache，改后依赖实际安装成功。首次外部插件冷加载出现 initialize 超时；此前原生 strict-deny ACP 单次请求被上游 HTTP403 FreeTierError 拒绝。该测试的全deny配置在发请求前删除了所有原生工具，与手机实际通过网关审批的路径不一致，不能作为免费模型不可用的结论。

用户提供官方桌面成功截图后复核：本机桌面1.18.18、网关CLI1.19.0，均为真实OpenCode；本机没有Zen专用认证或自定义请求头。改用当前341已编译的真实 harnessAcp 和网关审批插件，在隔离空工作区保留原生默认工具，permission=ask、审批回调拒绝执行，model=opencode/deepseek-v4.1-flash-free、effort=default；单次最小提示返回 OK，退出0、审批0、无错误，总28.560秒含启动。当前341免费模型调用链已验证可用，不需生产代码或APK变更。没有伪造客户端标识、切换付费模型或给原会话注入消息。证据：D:/codex/build/Codex-mobile-control/opencode-runtime/real-adapter342-result.json。

Release 构建成功（5m20s），网关 TypeScript 构建和 14 项定向检查通过，网页简称/分组/失效选择检查通过。实际网关目录读回 20 项、ECNU/Krill/OpenCode 三组，旧免费项已移除，新免费项和展示字段齐全。实体手机界面尚未实机检查；安装后打开 OpenCode 模型列表，预期供应商仅出现于分组标题，选择有效模型后按钮显示简称，失效旧选择提示重选。

APK 0.6.341 /313，3,068,212 字节，三份交付及实际网关下载一致。网关已激活 PID42172，安装源码逐字节一致，共享 Codex 后端 URL/token/进程保持不变。备份在 D:/codex/backups/Codex-mobile-control/before-opencode-models-0.6.341；成功交付后仅清除与备份一致的 340 重复 APK，无定时任务。构建、部署及隔离结果位于 D:/codex/build/Codex-mobile-control。

# 2026-10-15 Android 0.6.340 / Gateway 0.6.116 已交付：OpenCode

OpenCode 从 Harness 名称展示接入实际执行：托管 OpenCode 1.19.0，使用原生 ACP；助手/模型选择、会话归属与历史持久化、图片、模型实际思考档位、build/plan 模式、恢复和取消均已接线。模型和模式来自真实 configOptions，不填造思考等级；`__default` 仅显示为“默认”，传输值不改。恢复时屏蔽 load 重播，目录探测结束恢复原模型及思考档位。OpenCode 执行沿用现有公网策略，仅开放内网；本会话用量接入已有 ACP 记录，未新增无实际来源的全局统计或订阅额度。

账号及 Harness 增加 OpenCode 配置入口，原生页和电脑 Web 均支持供应商、服务地址、协议 SDK、密钥、模型上下文/输出上限、默认及小模型、CC Switch 配置切换。使用 jsonc-parser 定点修改 JSON/JSONC，保留注释及未编辑键；写入前预览，再检查活动任务与原文件版本，保存原版本。凭据不回显，OAuth 只显示状态，不自动登录或改授权。已有 HTTP 内网地址可使用，新增供应商地址可留空使用 SDK 默认值。

OpenCode 原有 allow 规则不会自然触发 ACP 审批，因此使用官方 tool.execute.before 插件，在本次进程内通过 127.0.0.1 随机端口和随机 token 接入网关审批。原生权限规则保持原样，网关批准不覆盖原生 deny；同一 sessionId/callID 合并两侧审批，避免重复确认。插件未加载、通道异常或用户拒绝时不执行工具，取消/结束清理监听。没有重写本机 OpenCode 配置来设置权限。

TypeScript、Web bundle、Android Release 构建通过（最终 5m46s）；13 项 ACP/审批定向检查和 4 项固定路由检查通过。真实 OpenCode 1.19.0 的隔离 initialize/session/new 插件握手通过，0 prompt、0 工具审批，关闭后监听已清理。实际安装网关返回 17 项 OpenCode 模型，图片/计划能力均为 true；账号页读取 3 个供应商、3 组认证，配置和 auth 文件在读回前后逐字节不变，响应未包含密钥字段，本会话用量接口正常。初次整目录读回 15,725ms；隔离 OpenCode 热缓存目录仍约 12.54s，沿用模型缓存，不宣称重新探测已快速。真实消息发送、工具执行、恢复/取消及实体手机操作尚未验收。

网关、电脑 Web、公网入口已更新 25 个文件，共享 Codex URL/token/进程不变；未对原会话注入、归档、恢复或停止。APK **0.6.340 /312，3,068,212 字节**，三份交付及实际下载逐字节一致。备份 D:/codex/backups/Codex-mobile-control/before-opencode-0.6.340；成功交付后删除与备份一致的 339 重复包及 240,956,066 字节重复 OpenCode 下载/解压文件，保留已安装运行时和回退备份，无定时清理任务。

下载 [Android 0.6.340](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。最小手动验收：内网更新后选择 OpenCode，检查模型/思考选项及设置→账号→OpenCode；在用户自选会话发送一条消息，确认操作审批只出现一次，停止后可恢复该会话。配置写入先看预览，未确认不应变化。

# 2026-10-15 Android 0.6.339 / Gateway 0.6.116 已交付

修复子代理关闭遇到跨盘归档失败（os error 17）时无法移除的问题。当前 sessions 是指向 D:/codex/sessions 的既存 Junction，而 archived_sessions 位于 C 盘；官方归档/恢复底层使用 rename，无法跨卷。正常情况仍执行官方归档；仅明确的跨盘归档错误会重新核对整棵子代理树已停止及父子关系，退订网关连接，并在网关自身数据库记录可恢复关闭。返回 archived:false、closureKind:gatewayClosed，不改 Codex 的归档元数据、不移动真实会话。运行中、父子关系变化、普通 RPC 失败和退订失败均不记录关闭。

设置入口改为“已归档与关闭”：关闭项显示“已关闭 / 重新显示”，原生归档项显示“已归档 / 恢复”；重新显示关闭项不调用原生 unarchive。关闭响应带后代 ID，手机立即移除整棵子树，当前位于其内部时返回父会话。真正的跨盘归档和恢复仍受官方实现限制，未作为本轮已修复事项。

TypeScript 构建、5 项针对故障的隔离检查、Android Release 构建通过（5m）。隔离检查包含实际 C/D 盘 rename 的 EXDEV、源文件不变、普通失败不隐藏、运行中后代不隐藏、关闭持久化及重新显示。网关 3 个模块已激活，真实档案列表只读返回正常；共享后端 URL/token/进程未变，未对用户会话执行归档、恢复、停止或发送消息。新增逻辑尚未经实体手机操作验收。最小验收：更新后关闭一个闲置子代理，应从列表消失，并可从设置重新显示。

APK **0.6.339 /311，3,051,332 字节**；三份交付与实际下载逐字节一致。备份：D:/codex/backups/Codex-mobile-control/before-close-cross-volume-0.6.339。下载 [Android 0.6.339](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。

# 2026-10-15 Android 0.6.338 / Gateway 0.6.116 已交付

设置增加统一“账号”，原生管理 Codex、AGY、Claude、DeepSeek、Hermes。Codex 与 Claude 均支持官方登录和中转配置，包含供应商、地址、密钥、模型、默认模型及现有路由设置；Claude 可从 CC Switch 导入并另存本机配置。账号切换先获取短期预览计划，确认时重新检查凭据、目标配置与运行任务；账号数据响应不返回凭据。AGY 支持本机 Tools 来源、CLI 双存储切换、显式额度刷新及历史；ACP 使用独立认证状态。

修复 DeepSeek 编辑器写回错误供应商，实际读取 ecnu / ecnu-max / openai-responses；Hermes 保留其原生目录及真实 provider/apiMode，修复 custom 密钥留空与协议覆盖。两端配置读取使用 editable=1，不再等待最长 60 秒的 AGY 额度查询；本机直接读取两种配置为 1,473ms，12 路只读联调下分别约 2,488/2,484ms。此结果仅对应配置读取，不代表多会话长期性能验收。

新增原生助理、扩展、诊断、批量会话管理、QQ/微信渠道、其他 Harness、详细统计管理页。助理读取真实模型/强度目录，默认 gpt-6.1-sol；Claude/AGY 新助理任务走官方 ACP，旧 CLI 会话保持原协议。独立通用引擎使用 Responses 工具循环、SQLite 请求回执、写入/命令审批；宿主退出后未确认的命令持续显示未知状态，不自动重放。统计包含八种视图、速度来源与高级筛选、近 24h/7/30/90 天额度、模型占比和曲线缩放定位；图表提示松开消失。

已归档会话从侧栏移入设置。子代理关闭按钮支持 unknown/running，先读取真实父子关系与状态，运行中需明确停止指定子代理后才能归档，失败保留错误与重试入口。

后端 TypeScript、Web bundle、Android 主代码与测试代码编译通过；最终 Release 构建退出 0（android-0.6.338-final-release.log，3m46s）。相关账号、切换保护、ACP、代理与助理模块的隔离检查通过。实际运行的 12 类管理只读接口均返回正常；助理目录返回 52 项，默认 gpt-6.1-sol。AGY ACP 的实际目录 initialize 仍超时，显示不可用；当前 Claude 为中转令牌，官方订阅额度明确显示不适用。未执行真实账号切换、渠道登录、原会话写入或模型推理；新增原生页面尚未经实体手机逐项验收。安装后先进入设置→账号，确认 DS/Hermes 供应商、协议正确，打开两类中转表单；切换前应显示目标及运行检查，取消不写凭据。

网关、Web、公网入口已激活；共享后端 URL/token 和进程保持不变，已部署历史 Worker 与权威源码产物一致。公网新增路由通过 401 认证边界读回确认已加载，未使用用户公网密码。初次依赖安装因系统 npm 缓存目录 EPERM 退出，改用 D:/codex/cache/npm 后成功，已确认官方 Claude ACP 依赖可解析。

APK **0.6.338 /310，3,051,332 字节**；三份交付和实际网关下载逐字节一致。下载 [Android 0.6.338](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。日志：D:/codex/build/Codex-mobile-control。原 APK 及源码/安装模块备份：D:/codex/backups/Codex-mobile-control/before-archive-settings-0.6.338、before-agent-runtime-0.6.338。成功交付后仅删除与备份一致的 0.6.337 重复 APK 和已核对解压运行时的 125,646,049 字节下载 ZIP；不设定时清理。

# 2026-10-15 Android 0.6.337 / Gateway 0.6.116 已交付

本轮包含：多会话切换取消旧历史请求、侧栏刷新合并；队列取回立即恢复本地草稿，发送中或请求未结束仍能复制；子代理关闭及会话长按菜单（置顶、移动项目/分区、未读、重命名、复制ID、归档/恢复）。移动和桌面置顶支持Codex，本地各助手支持未读和归档恢复。运行中的会话须先停止再归档。

结论后迟到的操作按所属轮次重新排列，保留两层折叠；API计价切换保留内容和滚动位置；图表提示松手消失；原文与整屏选文保留选区。增加助手健康管理和共享后端重启入口；capacity持续重试，手动停止/关闭开关/目标结束仍停止；修复Hermes默认思考配置与DeepSeek ECNU供应商/思考等级映射。

网关减少重复版本/模型探测、重复事件序列化与SQL事件裁剪；大日志按时间片解析，避免未完成大行反复拼接，缓存已解析live history。守护程序健康超时时先检查监听端口，避免启动副本。1.61GB日志冷读仍可能较慢，单次巨大JSON解析尚不能抢占；未宣称长期多会话断联已经完全消除。

Android Debug/AndroidTest/Release构建通过（8m16s）；最后3项模拟器检查全部通过：丢响应取回草稿、慢队列删除时复制、整屏选文。此前多会话快速切换取消与合并检查已通过，未重复。网关TypeScript编译通过；前轮后端29项与Agent/路由11项定向检查通过。会话归档/项目移动未对真实用户会话执行写入测试，需安装后用可恢复的闲置会话确认。

激活网关PID30648；共享端点URL/token与后端进程未变。最初几次激活因状态查询超时、连接重置或pending RPC未归零而退出1，未复制产物；等待空闲后成功。只读同条件4路status查询：此前3103–3118ms，激活后101–107ms；8路health为1–35ms。这是状态接口快照，非长期手机性能结论。

Web账号页已显示AGY实际额度、Claude已配置认证、Grok未配置。AGY读取超时改60秒并保留上次成功结果。过程中误用AGY /whoami触发1轮推理、17,638 tokens，已停止该方式，后续只用已验证零轮/usage。

APK 0.6.337 /309，2,821,264字节；三份交付及网关下载逐字节一致。下载 [Android 0.6.337](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。日志：D:/codex/build/Codex-mobile-control。备份：D:/codex/backups/Codex-mobile-control/before-timeline-scroll-0.6.337。仅清理与备份一致的0.6.336重复APK；未动此前被拒删除目标，无定时清理任务。隔离测试应用已卸载、模拟器关闭。

# 2026-10-15 Android 0.6.336 / Gateway 0.6.115 已交付：执行会话与前台通知

定时任务卡片、编辑和新建页面显示“执行会话”及项目目录。网关从本机 state_5.sqlite 读取绑定目标的名称和目录，覆盖未在侧栏加载及已归档的会话；不恢复会话、不读取消息正文。新建时固定目标 ID，保存使用同一 ID。名称无法读取时显示原编号；无固定目标的 cron 任务显示每次新建会话。网页列表和编辑器同步显示目标。

应用 onStart 标记前台并清除已有任务／审批状态栏通知；公共通知发送入口在前台直接返回，onStop 恢复后台提醒。后台监听服务保留，应用内原有提示和未读状态不变。通知状态仅在当前进程中保存，不写入连接配置。

后端构建、JavaScript 语法及任务检查 3/3 通过（gateway115-target-check.log）。Android Debug／AndroidTest／Release 构建通过，6m29s（android-0.6.336-build.log）。界面检查 OK (3 tests)，31.969s（ui336-target-notifications.log），覆盖列表目标名称、编辑和新建目标区域、前台清除／抑制任务与审批通知、后台重新发送。实体手机尚未安装验证；安装后确认任务卡片与编辑页的执行会话一致，应用前台无任务／审批提醒，切到后台后恢复。

网关已激活 0.6.115（40564），共享端点 URL／token 与后端进程保持不变。初次激活脚本退出 1：路径分隔符不匹配，尚未写入运行文件；规范化进程路径后激活成功（gateway115-deployment-final.log）。真实 API 读回三条任务均有目标，其中一条能解析名称；另外两条（automation、automation-2）同指 019e1f36-61ec-74b3-b0fb-daf482e5023b，当前 SQLite 和 session_index 未找到名称，保留原绑定编号，未替换目标或触发任务（gateway115-target-readback.log）。

APK 0.6.336 /308，2,804,880 字节，版本及执行会话功能标记检查通过，三份交付与实际网关下载读回逐字节一致（release-336-delivery.log）。下载 [Android 0.6.336](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。日志位于 D:/codex/build/Codex-mobile-control。旧 APK、改动前源码与安装网关模块保存在 D:/codex/backups/Codex-mobile-control/before-automation-target-0.6.336；仅删除与备份一致的重复 0.6.335 归档。隔离测试应用已卸载，模拟器关闭，无定时清理任务；此前被拒删除的旧目标未重试。

# 2026-10-15 Android 0.6.335 已交付：标签点击反馈与界面文案精简

检查用户提供的 4.39 秒录像，按 10fps 查看标签区域：原生点击波纹在快速点击中叠加，遮盖选中背景。DashboardTabs 改为单一滑动选中块（170ms）、轻量按压反馈，去掉原生波纹；已选标签不重复调用回调，文字字重固定，保留 Tab 选中语义和 RTL 位置。统计来源标签同步移除波纹和重复点击回调。用量／额度／模型／服务通过 SaveableStateProvider 分别保存滚动和局部状态，离开的内容仍退出组合。

“设置与管理”统一改为“设置”，“全局定时任务”改为“定时任务”，本会话入口保留范围含义。删除参考金额不代表账单等重复声明；缓存和推理归属直接写为“其中缓存／其中推理”，审批说明缩为“自动批准操作申请，提问仍需回答”，容量重试、文件保存位置和快照说明同步精简。定时任务设置行改为实际提供的安排任务与运行时间，不再声称有执行记录。原有权限行为、真实错误提示和删除确认保留。

首次构建退出 1：新组件引用了另一个文件的私有 ControlEase，已改为组件自身的曲线定义。最终 Debug／AndroidTest／Release 构建通过（android-0.6.335-final-build.log，4m52s）。两项定向界面检查 OK (2 tests)，15.783s（ui335-tabs.log）：快速切换后的唯一选中态与重复点击不触发回调；侧栏及设置入口、额度与统计切换、统计滚动位置恢复。tabs335-pressed.png 已实际读回查看，按压反馈未出现原录像的大块深色波纹。本轮是模拟器功能与截图验证，未测实体手机帧率。

APK 0.6.335 /307，2,804,880 字节；aapt 版本与发布功能检查通过，三份交付及实际网关下载读回逐字节一致（release-335-delivery.log）。下载 [Android 0.6.335](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。日志与截图在 D:/codex/build/Codex-mobile-control，录像抽帧位于其 video335 子目录。网关保持 0.6.114，本轮未重启网关或共享后端，没有向原会话注入消息。

旧 0.6.334 APK、相关源码和检查文件备份保留在 D:/codex/backups/Codex-mobile-control/before-tabs-copy-0.6.335；逐字节确认后删除 deliverables 中重复的 0.6.334 归档。未重试此前被拒删除的旧目标，无定时清理任务。隔离测试应用已卸载，模拟器已关闭。实体手机最小确认：快速切换额度／统计，选中块应跟随最后一次点击，无叠加波纹；滚动统计后切换再返回应保留位置。

# 2026-10-15 Android 0.6.334 已交付：定时任务操作连续性

定时任务列表状态提升到列表与编辑器的共同所有者，进入编辑再返回保留滚动位置；切换全部／启用／暂停筛选时回到列表顶部。保存期间禁用弹层的关闭按钮、遮罩关闭、拖动关闭、系统返回和返回列表，保存结束或失败后恢复；页面内部返回回调也在保存期间阻止退出。刷新进度固定占用 2dp，加载开始和结束不再挤动已有内容。沿用已有列表、编辑器和弹层，没有新增管理入口。

Debug 与 Release Kotlin 编译通过。首次构建及一次打包重试均退出 1，原因是闲置 Gradle 守护进程 34456 占用旧 classes.dex，R8 无法删除输出目录；通过 Windows Restart Manager 确认占用者，Gradle --status 确认 IDLE 后用 --stop 释放。最终 assembleRelease 通过，1m43s（android-0.6.334-package-final.log）。没有新增或重复运行无关测试，本轮未启动模拟器；实体手机的返回、拖动及键盘交互尚未验证。最小手动确认：滚动任务列表后进入编辑并返回，应停留原位置；保存过程中关闭暂不可用，结束后恢复；刷新时列表顶边不变。

APK 0.6.334 /306，2,788,496 字节；aapt 版本检查通过，三份交付和实际网关下载读回逐字节一致（release-334-delivery.log）。下载 [Android 0.6.334](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。日志位于 D:/codex/build/Codex-mobile-control。网关仍为 0.6.114，本轮没有重启网关或共享 app-server，没有操作原会话或目标。

旧 0.6.333 APK 和相关源码／版本文件保留在 D:/codex/backups/Codex-mobile-control/before-automation-navigation-0.6.334；逐字节核对后仅删除 D 盘 deliverables 中重复的 0.6.333 APK。指定备份及此前被拒删除的旧目标保留，无定时清理任务。

# 2026-10-15 Android 0.6.333 / Gateway 0.6.114 已交付：任务弹层、用量排版、容量重试与审批状态

侧栏顺序为账号额度、全局定时任务、设置与管理、连接电脑；额度和全局任务弹出时保留侧栏。工作区文件仅保留右上菜单入口。本会话及侧栏全局定时任务使用底部弹层，共用列表和编辑器；设置中的全局任务保留子页。连接分栏直接展示设置。本会话用量右侧显示大字总 Token，下方输入、输出、缓存命中用小字，缓存命中率用大字，其他信息折叠，ID 保持单行。

网关增加容量自动重试开关，默认关闭，可在连接页或网页设置中开启。仅处理模型 at capacity／过载，15 秒起退避、最多 8 次；等待时保持目标运行状态，恢复目标不重置累计量，普通会话不重复发送原用户消息。手动停止、关闭开关及新任务取消等待，已完成或预算耗尽的目标不重新激活，不确定的 RPC 超时不盲目重放。已暂停的目标仍需用户手动继续一次。

修正 serverRequest/resolved 被无条件显示为“已拒绝”：未知结果显示“已处理”，自动批准回执之前的完成通知不覆盖审批结果。历史仅纠正审批表明确过期却被旧事件标成拒绝的记录，真实拒绝保留。自动审批开启后，成功处理的非提问申请不显示卡片或通知，已发通知会撤销；提问及审批失败仍保留手动入口。工具执行层或官方审查的真实拒绝未绕过。

后端构建通过，首批相关检查 26/26 通过；补充停止竞态和审批状态检查 9/9 通过（gateway114-cancellation-check.log）。Android Debug、AndroidTest、Release 构建通过（android-0.6.333-delivery-build.log，2m7s）；受影响界面检查 OK (3 tests)，31.168s（ui333-targeted.log），用量截图 ui333-usage.png 已实际查看。容量恢复来自隔离协议检查，未在原会话触发真实模型过载；实体手机安装后的交互尚未验证。

APK 0.6.333 /305，2,788,496 字节；D 盘归档、项目下载和安装网关下载三份逐字节一致，真实下载读回一致。下载 [Android 0.6.333](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。网关已重启加载 0.6.114，实际读回自动审批开启、桥接已连接、容量重试关闭（gateway114-live-readback.log）；共享 app-server 未重启，端点 URL 与 token 未变化，未向原会话注入消息或激活目标。上述日志均在 D:/codex/build/Codex-mobile-control。

改动前备份保留在 D:/codex/backups/Codex-mobile-control/before-usage-layout-0.6.333 和 before-capacity-retry-0.6.114，包含旧 APK、相关源码和旧网关部署文件。交付后仅清理与指定备份逐字节一致的重复 0.6.332 归档，不建定时清理任务；此前被拒删除的旧目标未重试。

# 2026-10-15 Android 0.6.332 已交付：工作区文件、额度入口与会话状态整理

工作区文件按当前会话目录查询完整的已授权项目，优先匹配最具体的目录；可在授权父目录内定位会话子目录，不再依赖侧栏当前分页或残留的项目 ID。文件浏览记录自己的项目与根目录，读取／保存不改变聊天项目。面板内显示加载、错误和重试，保留目录进入、返回、正文编辑与保存。真实网关只读核查：已登记项目 29 个，本工作区根目录 21 项，README.md 正文 5157 字符。

侧栏恢复独立“账号额度”入口，点击直接弹出；设置中的“用量与额度”整合额度、统计、模型、服务四个切换项（控制台能力可用时）。额度刷新仍在首卡标题右侧，不在页头另加加载圈。本会话用量继续通过聊天顶部进入。

会话状态按实际图标进入：电脑图标打开连接，圆环打开上下文；有会话时可左右切换。去掉卡片中重复的会话名称，默认显示上下文占用、本会话输入／输出／缓存／缓存命中率；命中率为缓存输入除以输入。累计量、最近请求、推理量、模型、ID 和目录统一折叠，ID 保持单行。右上会话菜单新增“本会话定时任务”，只列当前会话任务并支持新建、编辑；设置仍可管理全部任务。

Debug、AndroidTest、Release 构建通过（android-0.6.332-delivery-build.log，2m17s）；修正文件检查夹具后 AndroidTest 单独重建通过（android-0.6.332-file-fixture-build.log，33s）。6 项受影响行为分批确认：首轮 4 项通过、2 项失败；收紧文件重试按钮定位、等待展开动画结束后，状态检查通过；补齐分页夹具中会话的真实目录字段后，文件失败重试、目录进入、正文读取与返回检查通过。对应 ui332-targeted.log、ui332-files-status-final.log、ui332-workspace-final.log，不能将首轮称为整批通过。会话状态截图已实际查看，详细信息中的完整 ID 在同一行。实体手机交互仍需安装后确认。

APK 0.6.332 /304，2,788,496 字节；D 盘归档、项目下载、安装网关下载三份逐字节一致，真实网关下载读回一致。下载 [Android 0.6.332](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。交付记录 release-332-delivery.log、release-332-project-readback.log 均在 D:/codex/build/Codex-mobile-control。原版 APK 与源码保存在 D:/codex/backups/Codex-mobile-control/before-workspace-usage-0.6.332。网关保持 0.6.113，没有重启共享后端或向原会话发送测试消息。

# 2026-10-15 Android 0.6.331 已交付：两层过程折叠、按需详情与消息顺序

完成后的过程改成一个外层入口，展开后按原顺序显示文字说明与操作段；每段操作保持独立折叠，最终结论留在外面。操作段复用运行中的键，外层不再提前加载所有操作组。折叠的操作仅生成轻量标题；打开一段才请求该段元数据，打开具体操作才请求正文。“已更改”展开仅显示文件列表，选中文件才加载涉及该文件的操作组和补丁，不再请求整轮所有详情。已有文件统计优先复用元数据，不扫描其补丁正文。

修正历史换 ID 后的插入锚点：通过相同请求 ID 和唯一条目 ID 保留旧操作与引导消息的位置关系，避免旧操作失去锚点后被追加到末尾。运行中不插入文件汇总；同一次有生命周期的执行即使被引导消息分段，也在结束后合并为一份更改汇总。纯历史中缺少生命周期的完整消息段保留原来的结束推断。中断／失败信息与正在压缩的记录仍可见。

设置导航固定整页尺寸并取消内容尺寸插值，首次打开从右侧水平进入，进入子页和返回采用相反方向；修正首次进入首页被误判成“返回”的分支。加载指示紧挨首卡“账号额度”文字右侧固定占位，套餐标签靠右；刷新不改变卡片或曲线位置。侧栏和会话菜单恢复直接的“工作区文件”入口，并修正列表容器中多个条目叠放；会话路径可用于恢复已登记的工作区。移除手工导入只读 JSON 快照的会话菜单及对应对话框，现有记录和服务端导入 API 保留。当前正在查看的会话及其目标完成均不弹完成浮层，其他会话完成仍提示；打开被提示的会话会清掉对应浮层。

最终 Debug／AndroidTest／Release 构建通过，2m15s：D:/codex/build/Codex-mobile-control/android-0.6.331-navigation-build.log。NativeInteractionTest 26 项通过，覆盖引导消息锚点、两层结构与执行结束后单份汇总；文件汇总及目标时钟原有 2 项检查通过（unit331-file-summary.log）。网页对应逻辑 5/5 通过，两个修改脚本的语法检查通过。

界面检查按受影响行为分批执行，已分别确认：整轮外层与两段独立折叠、原生文字和操作段顺序、结束时间、外层无详情请求、操作元数据与正文分步加载、仅选中文件请求补丁、文件入口、当前完成不提示与后台去重／自动消退、加载指示邻近标题及卡片／曲线坐标稳定。早期批次有失败，不能称整批通过：修正设置首屏方向、文件列表容器、模拟会话工作区路径，并使用 Espresso 检查 AndroidView 原生文字后，相关行为有对应成功记录。最终导航单项 OK (1 test)，10.452s，包含首次进入、子页、返回和关闭的中途尺寸／方向检查；其余记录在 ui331-nested-check.log、ui331-final-check.log、ui331-visibility-check.log 中逐项状态为 0 的条目。进入中途截图 settings331-entering.png 已实际查看，整页水平位移，顶部高度不变。没有将这些界面检查当作实体设备帧率证明，也未重复之前已通过的无关测试。

APK 0.6.331 /303，2,789,188 字节；Release 功能标记、三份交付和项目下载实际读回一致。下载 [Android 0.6.331](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。交付记录：D:/codex/build/Codex-mobile-control/release-331-delivery.log、release-331-project-readback.log。console-core.js 和 console.js 已复制到安装目录并逐字节核对。网关保持 0.6.113，无网关／共享后端重启、原会话恢复或测试消息注入。

改动前备份保留在 D:/codex/backups/Codex-mobile-control/before-nested-process-0.6.331：0.6.330 APK 与 Android／网页相关源码快照。交付后核对旧归档与指定备份一致，清掉重复的 D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.330.apk；此前被拒删除的旧目标未重试，无定时清理任务。模拟器已关闭。实体手机尚未安装验证：重点检查运行中发送引导后旧操作仍在原位置、结束后仅一份更改汇总，以及设置水平进入／退出；这轮没有新增实体帧率结论。


# 2026-10-15 Android 0.6.330 已交付：统一设置、会话状态与分段过程

管理入口合并为“设置与管理”，内含账号额度、定时任务、电脑控制台、外观、存储与缓存，进入和返回采用 220–240ms 小幅滑动与淡入淡出。二级页面使用约 56dp 单行导航栏、18sp 标题。聊天顶部继续直接查看本会话用量；会话状态默认展示上下文、累计／最近请求、输入／输出，缓存和推理、ID 和目录、连接诊断按需展开，空会话仅显示连接。

成功结束的回复将中间说明收入相邻的操作折叠段，保留各段原来的顺序与独立展开状态，最终结论显示在正文；中断或失败信息保留。网页同步分段折叠，已复制 console-core.js 到安装目录。账号额度刷新指示固定在首卡标题右侧，刷新保留原数据和曲线，不向顶部增加一行。Grok 实际返回 xhigh/high/medium/low，Android 滑条统一排序为左低右高，保留强度 ID 和选择值，也适用于已缓存的模型列表。

空的历史压缩标记不再覆盖实时 running 状态；真实完成通知或有摘要的完成记录结束压缩提示。聊天和会话状态页显示“正在压缩上下文”，复用从左到右的文字扫光；压缩期间禁用重复手动压缩，完成摘要保持折叠。

录像中操作段与“已更改”卡片交界存在重复解析：列表生成已解析整轮补丁，卡片入屏再次解析。现在通过既有 ChatEvent.fileChanges 传递结果，卡片直接复用；补丁头正则改为预编译。相同解析器在视觉改版前快照已经存在，不能据此认定某次新动效改动引入了问题。模拟器合成操作负载前后各采样一次：290／277 帧，p50 95.03／109.44ms、p95 158.46／165.69ms，绘制合计 1448.03／855.41ms，swap 合计 7929.11／9042.49ms。总帧时没有改善，不能将这次代码修正当作实体手机已恢复流畅的证据。原始数据为 D:/codex/build/Codex-mobile-control/ui330-operation-before.json 与 ui330-operation-after.json。

最终 Debug、AndroidTest、Release 及 NativeInteractionTest 定向构建通过（2m3s，24 项单元检查无失败）：D:/codex/build/Codex-mobile-control/android-0.6.330-complete-build.log。4 项受影响界面检查通过（18.617s）：Grok 滑条实际提交值及取消恢复、刷新中首卡和曲线 bounds 不变、压缩跨历史标记仍显示进行中、摘要折叠与通知刷新。此前手机 5 项、1080dp 宽屏 2 项设置导航／会话布局检查通过，375dp 与 1080dp 截图已实际读回；本轮未重跑无关检查。网页分段检查 4/4 及语法检查已通过。

APK 0.6.330 /302，2,789,188 字节，归档、源码下载、安装目录下载三份一致；项目下载路由实际读取与源包逐字节一致。记录见 D:/codex/build/Codex-mobile-control/release-330-delivery.log 与 release-330-project-readback.log。下载 [Android 0.6.330](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。网关保持 0.6.113，本轮未重启网关或共享 app-server，也未向原会话注入消息。

改版前备份保留在 D:/codex/backups/Codex-mobile-control/before-settings-0.6.330，包含旧 0.6.329 APK 和设置页改动前源码；源码已含本轮折叠修复，非 0.6.329 精确源码。此前指定备份继续保留。实体设备的手势与帧率、完整 TalkBack 流程尚未验证。安装后检查：进入设置子页后返回；点聊天顶部查看本会话用量；刷新账号额度时卡片和曲线不移动；Grok 滑条右端为最高；压缩时文字扫光持续至完成；滚过操作段与“已更改”交界确认停顿是否消失。


# 2026-10-15 Android 0.6.329 / Gateway 0.6.113：压缩摘要折叠

压缩记录保留实际摘要，去掉自动交接前缀后收进“上下文已自动压缩”，默认折叠。按 `compacted.payload.message` 的正文匹配压缩前助手输出，处理 Codex 去掉 memory citation 的差异；不按标题推断普通回复。Android 与网页同步折叠，通知刷新不丢摘要和展开状态。

后端构建与定向检查 2/2 通过；真实日志最新摘要匹配通过。Android Debug、AndroidTest、Release 构建通过（3m56s），独立 ui329.remotecheck 折叠检查 OK (1 test)，4.573s。实际网关历史读回 48 个事件，最新摘要 7557 字符，正文无重复摘要。APK 0.6.329 /301，2,772,804 字节，三份交付及实际下载读回逐字节一致。下载 [Android 0.6.329](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。日志位于 D:/codex/build/Codex-mobile-control，包括 android-0.6.329-build.log、ui329-compaction.log、gateway-113-compaction-readback.log、release-329-project-readback.log。

权限配置为 `on-request + user + danger-full-access`，网关自动审批开启且审批通道已连接；命令、文件、权限请求送达网关后自动接受，提问仍由用户回答。界面补充审批范围说明。此前删除旧 APK 被本线程工具执行层自动审批返回 `blocked by policy`，命令未启动；不是网关拒绝，未绕过拒绝，旧包仍保留。只重启手机网关（15016 → 37700），更新前待处理 RPC 和网关托管活动任务均为 0，共享后端端点文件未变化。未重启共享 app-server、恢复原会话、发测试消息或改目标。

旧网关文件备份：[before-compaction-0.6.329](/D:/codex/backups/Codex-mobile-control/before-compaction-0.6.329)。视觉改版前备份继续保留，无定时清理，模拟器已关闭。实体设备未安装验证：安装后点压缩项展开/收起摘要，刷新后摘要应保持在折叠内。

# 2026-10-15 Android 0.6.328 已交付：管理页视觉统一、长按消息操作、完成浮层与平板布局

定时任务、用量与配额、电脑控制台共用应用主窗口中的管理页面，统一标题、圆角、卡片、间距及系统栏避让，不再使用独立 Dialog 的默认边距。任务新建入口收进标题栏，整张任务卡片可编辑，保留单独启停开关；移除重复编辑胶囊、减少正文及时间信息占用。共享按钮改用与输入框一致的圆角矩形，交互区域至少 48dp，控制台说明文字及深浅主题层级进一步统一。蓝色按钮与白字对比度从约 4.34:1 提升至 5.20:1。

最新用户消息底部的复制和编辑按钮已移除，操作保留在长按菜单；复制、编辑及消息操作也通过 TalkBack 自定义动作暴露。助手回复的复制／重试等原有操作保留。前台主任务结束后显示轻量浮层，约 4.5 秒后淡出，显示结束状态与会话名，提供查看和关闭，不抢输入焦点；复用结束事件追踪去重，历史回放及同轮重复完成不重弹。目标结束也使用轻提示，替代必须确认的大弹层。

定时任务保存使用独立操作状态，无关后台请求不再锁住任务按钮；请求期间显示进度，错误在任务页面显示，失败保留表单。保存后的列表刷新不会重新打开已经关闭的页面。完整管理页暂时隐藏聊天的辅助功能入口，返回恢复原会话。现有宽屏侧栏保留，聊天正文最多 840dp，管理内容最多 960dp、表单最多 720dp；任务卡片按实际窗口宽度双列，筛选、表单和管理页状态使用可恢复状态。

按用户要求，在实施后分别使用 GitHub 的 [Android 设计规范 skill](https://github.com/ehmo/platform-design-skills/blob/main/skills/android/SKILL.md) 和 [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md) 做交互与视觉评估并修正。[评估与采用依据](/F:/Code/Codex-mobile-control/docs/design-reference-notes.md)保留 Before/After 表及适用边界，未将技能检索结果当作实际运行证明。

[Debug／AndroidTest／Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.328-build.log)通过，2m30s；最后一次变更仅改截图读取方式，[检查包构建](/D:/codex/build/Codex-mobile-control/ui328-capture-build.log)通过，29s。消息长按编辑及草稿保留通过；[完成浮层、控制台模型操作与用量浮层](/D:/codex/build/Codex-mobile-control/ui328-management-final.log)为 OK (3 tests)，25.999s。[平板主界面与侧栏](/D:/codex/build/Codex-mobile-control/ui328-tablet-landscape.log)为 OK (2 tests)，14.208s。管理页面在 375dp 小屏、1280dp 横屏、800dp 竖屏、600dp 分屏及两倍字体下均通过对应界面检查；最后手机和平板截图直接从 Compose 根绘制读回，分别 [6.37s](/D:/codex/build/Codex-mobile-control/ui328-capture-phone.log)、[6.733s](/D:/codex/build/Codex-mobile-control/ui328-capture-tablet.log)，各 OK (1 test)。竖屏／分屏／两倍字体分别为 11.372s、6.61s、8.42s，各 OK (1 test)。早期两项检查使用已移除的会话菜单入口、未声明控制台能力，以及在点选前寻找图表浮层，修正检查与当前交互一致后通过；没有以旧失败输出宣称成功。

全部检查使用独立 ui328.remotecheck 应用及模拟接口，没有向原会话注入消息、改目标或重启共享后端。实体手机／平板、折叠铰链、TalkBack 全流程和系统动态配色未验证。安装后最小检查：长按最后一条用户消息，应能复制或编辑且原尾部没有按钮；任务结束应出现短暂浮层；进入任务、配额、电脑控制台应使用相同页面风格，横屏平板侧栏与卡片分栏正常。

0.6.328 /300，APK 2,772,804 字节，签名配置保持。[三份交付](/D:/codex/build/Codex-mobile-control/release-328-delivery.log)及 [项目下载实际读回](/D:/codex/build/Codex-mobile-control/release-328-project-readback.log)一致。下载 [当前 APK](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。Gateway 保持 0.6.112，无服务重启。

用户要求的备份保留：[原 0.6.327 APK](/D:/codex/backups/Codex-mobile-control/before-visual-0.6.328/Codex-Control-0.6.327.apk)与[视觉改版前 Android 源码快照](/D:/codex/backups/Codex-mobile-control/before-visual-0.6.328/android-source-before-visual.zip)。APK 已核对为 0.6.327 /299；源码 ZIP 含 355 个文件、2,862,743 字节，已解包读回核对。源码快照包含本轮视觉改版前已写入的交互修正，并非 0.6.327 的精确源码。旧 0.6.325／326 APK 删除操作被自动审批返回 blocked by policy，命令未执行，旧包仍保留；没有绕过拒绝或创建定时清理任务。

## 0.6.327 历史记录

# Android 0.6.327

0.6.327 /299 与 Gateway 0.6.112：目标继续统一发送实际续跑请求，移除 running 缓存导致的仅改状态分支。目标操作只受当前目标操作锁影响，状态刷新不持续锁住按钮；卡片显示处理中及实际错误，保存和继续回执即时更新目标内容。后端允许受阻目标显式继续，协调丢失结束通知留下的旧追踪；真实任务仍运行和预算耗尽时明确提示，保留并发互斥与结果未知不自动重发。

“选择本轮回复”仅跨当前助手轮次的正文，排除用户气泡、工具操作和其他轮次；用户气泡移除入口。根据段落身份及偏移定位重复文字，内容在点击时拼接、在选择页冻结，顶部标注本轮回复并避让系统栏。普通复制、消息编辑及分享保留。

[Debug/AndroidTest/Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.327-build.log)通过，3m；选择范围单元检查 1 项、0 failures/0 errors。[唯一隔离目标界面检查](/D:/codex/build/Codex-mobile-control/goal-327-ui-check.log)为 OK (1 test)，9.752s，修改受阻目标后，即使 running 缓存仍为 true、另一个后台任务挂起，也能点击继续并保持新目标内容。[后端 14 项检查](/D:/codex/build/Codex-mobile-control/goal-112-check.log)通过。模拟器已关闭，未对原会话发起目标修改或继续，实体手机未测。

下载 [当前 APK](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。0.6.327 /299 APK 2,756,420 字节，三份交付与 [项目内实际下载](/D:/codex/build/Codex-mobile-control/release-327-project-readback.log)一致。Gateway 已启用 0.6.112，共享后端和 25819 控制台保持。安装后验证停滞目标编辑、保存和继续，以及本轮正文的选择范围；真实任务仍运行或预算耗尽时，应在目标卡片显示原因。旧包清理因现有执行策略阻止而暂未完成，无定时任务。

## 0.6.326 历史记录

# Android 0.6.326

0.6.326 /298 将运行标题改为从左向右扫过的文字高光，周期 1.8 秒，低亮度约 32%、高光中心 100%，多个标题同步。扫光使用实际文字排版宽度，保留长标题省略及两行标题，不改变背景、图标或文字位置；渐变缓存、仅在绘制时更新，不逐帧重组列表。关闭侧栏、无运行会话或系统停用动画时使用静态文字。

[Debug/Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.326-build.log)通过，2m12s；APK 2,756,420 字节，版本及扫光功能标记、三份交付与 [项目下载读回](/D:/codex/build/Codex-mobile-control/release-326-project-readback.log)一致。没有增加模拟器检查，实体手机未测：安装 [当前 APK](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)，查看侧栏运行标题，高光应从左向右经过，明暗对比比整段文字呼吸更明显。Gateway 保持 0.6.111，无原会话修改。

旧 APK 删除命令被执行策略拒绝（blocked by policy），未执行清理；0.6.325 包仍保留，当前包正常交付。没有设置定时清理任务。

## 0.6.325 历史记录

# Android 0.6.325

0.6.325 /297 将侧栏运行动画应用到标题文字，移除运行圆点。置顶、最近、项目及进行中列表共用同一节奏，标题透明度在 60% 至 100% 之间变化，周期 1.7 秒；图标、背景和项目路径保持稳定，完成后恢复普通文字。透明度在图层阶段读取，不随动画重组列表；侧栏关闭或无运行会话时停止循环。

[Debug/Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.325-build.log)通过，2m20s。APK 2,756,420 字节，版本、标题呼吸标记、三份交付与 [项目下载读回](/D:/codex/build/Codex-mobile-control/release-325-project-readback.log)一致。Gateway 保持 0.6.111，无服务重启或原会话修改。没有新增界面测试，实体手机未测：安装 [当前 APK](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)，展开侧栏，多个运行标题应同步明暗变化，运行标记圆点已移除。上一版 APK 已在交付后清理，保留当前 Android 与 Windows 包，无定时清理任务。

## 0.6.324 历史记录

# Android 0.6.324

0.6.324 /296：侧栏运行标记共用同一个呼吸动画，置顶、最近、项目及进行中列表保持同一节奏，关闭侧栏时停用循环。配额周期改为 5h／7d 额度，Codex 前缀移除；曲线明细改为点按／横向滑动触发的图内浮层。套餐保留接口真实档位，明确的 PRO100／PRO200 可显示；仅有 PRO 数据时不推断金额。Token 使用万／亿，37,600,000 显示 3760万，低于一万显示整数；上下文继续 K。

模型页和定时任务使用统一胶囊开关、滑动圆点、主题色和按压反馈。任务按启用状态筛选，卡片显示间隔、内容及下次运行，编辑采用填充输入框和固定底部保存。模型信息层级、默认操作与卡片留白调整，滚动区裁切修复固定页签下方内容外溢。会话菜单收敛为上下文与连接、目标、模型与权限、项目工具及设置；全局控制台／用量／定时任务从侧栏进入，Clash 从连接管理进入。项目工具和云端快照按真实能力显示，重复数据工作台移除。

需要 Gateway 0.6.111 显示小时模型用量；新版已在本机启用，保留网页版原有 modelSeries 数据。今天显示按小时模型曲线，其他范围显示按日模型曲线，图例突出模型、图内浮层显示真实桶内数值。旧服务没有小时明细时明确提示，日汇总兼容保留。[真实读回](/D:/codex/build/Codex-mobile-control/console-trend-111-readback.log)获得 15 个小时模型点、2 个模型，小时／每日／总量一致；后端及 25819 进程保持，未改原会话。

[首轮构建和格式检查](/D:/codex/build/Codex-mobile-control/android-0.6.324-build.log)、[最终 Debug/Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.324-final-build.log)、[7 项接口检查](/D:/codex/build/Codex-mobile-control/console-trend-111-check.log)通过，Android 格式单元检查 4 项、0 failures/0 errors；AndroidTest 仅编译，没有重新运行模拟器或触发真实任务。实体手机未测：覆盖安装后查看侧栏多个运行圆点是否同步，点按／横滑额度和模型曲线查看浮层，检查模型与任务开关样式及任务编辑键盘布局。

下载 [当前 APK](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。APK 2,756,420 字节，三份交付与 [项目下载接口实际读回](/D:/codex/build/Codex-mobile-control/release-324-project-readback.log)一致。交付后清理较早 APK，保留当前 Android 和 Windows 0.6.307，不设置定时任务。

## 0.6.323 历史记录

# Android 0.6.323

0.6.323 /295 统一手机用量、上下文和菜单内电脑控制台的卡片、分段切换与数字样式。用量分卡显示配额、趋势、上下文和累计消耗；弹层标题固定、正文滚动，移除加载留白和冗长说明。电脑控制台的统计筛选、模型搜索、模型卡片和服务指标同步调整，长模型名与大字体布局已核对。累计用量使用亿／千万／万，上下文统一 K，例如 17.2亿、3.8千万、30.9K / 380K。完整 Windows 启动路径不再作为操作标题，收起显示“运行命令”，展开仍保留完整命令。

Gateway 0.6.110 已启用，修复查看图片工具记录未被输出文件接口识别造成的内网 404；仅接受精确图片引用，公网项目边界保持。[11 项定向检查](/D:/codex/build/Codex-mobile-control/activity-image-110-check.log)通过，原会话图片只读接口实际返回 [HTTP 200 且字节一致](/D:/codex/build/Codex-mobile-control/activity-image-110-readback.log)。共享桌面后端与 25819 控制台保持，未向原会话注入测试消息。

[最终 Debug/Release 构建及 4 项格式检查](/D:/codex/build/Codex-mobile-control/android-0.6.323-final-build.log)通过。六项定向界面用例均至少一次通过，包含配额趋势、压缩上下文与累计量分开、模型操作、大字体深色、长名称和筛选草稿保持；配额旧单节点定位遇到两个相同百分比，调整定位后 [3 项重查通过](/D:/codex/build/Codex-mobile-control/usage-323-ui-recheck.log)。模拟器截图已核对，模拟器已关闭。

APK 2,756,420 字节，三份交付与 [项目接口下载读回](/D:/codex/build/Codex-mobile-control/release-323-project-readback.log)一致。下载 [当前 APK](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。实体 S23 未测；覆盖安装后打开用量、上下文和电脑控制台，核对中文单位、K、固定标题和操作图片显示。交付后已删除 87 个旧安装包，释放 5270.8 MiB；保留当前 Android 与 Windows 包，未设置定时清理。

## 0.6.322 历史记录

# Android 0.6.322

0.6.322 /294 将发送后的操作流程按相邻操作分段折叠，放在对应正文之间；中间说明文字在完成后保留，不再收入开头的整轮过程块。每段独立展开/收起，后续阶段出现不重置前段的展开状态；终止后默认收起，复制、重试、结束时间及单份文件摘要保留。只有一段过程时沿用已有用时标题，多段显示各自操作数量。

[Debug/AndroidTest/Release 构建及 36 项定向单元检查](/D:/codex/build/Codex-mobile-control/android-0.6.322-build-check.log)通过。隔离界面中新分段顺序、独立折叠与状态保留两项通过；终止检查首次被模拟器 System UI 无响应弹窗阻挡焦点，处理弹窗后单独重跑报告 [OK (1 test)](/D:/codex/build/Codex-mobile-control/timeline-322-terminal-ui-recheck.log)。三份交付 APK 及 [项目下载读回](/D:/codex/build/Codex-mobile-control/release-322-project-readback.log)一致，APK 2,740,036 字节。没有改动原会话或重启 Gateway，模拟器已关闭；实体手机未测。

下载 [当前 APK](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。覆盖安装后查看已有的多段操作回复：正文与操作段按原顺序穿插，每段均可单独折叠。

## 0.6.321 历史记录

# Android 0.6.321

0.6.321 /293 将底部文件反馈通知显式设为 Radius.Composer，与输入卡片同为 28dp 圆角；重试、关闭和收起行为不变。此改动无需更新或重启 Gateway，继续使用 0.6.109。

[Debug/Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.321-build.log)通过，4m25s；APK 2,740,036 字节，版本、功能标记和三份交付文件核对一致，[项目内实际下载读回](/D:/codex/build/Codex-mobile-control/release-321-project-readback.log)一致。实体手机待验：通过下方项目内链接安装后，打开底部文件反馈，圆角应与输入卡片一致。

手机安装链接使用已授权项目内的 [当前 APK](/F:/Code/Codex-mobile-control/server/public/downloads/android.apk)。实际项目文件接口已返回完整 APK，现有公网白名单允许该路径；客户端仍携带设备鉴权。不要将 D:/codex/deliverables 的归档链接作为手机安装入口，也不为 APK 取消公网密码或项目边界。匿名公网 /downloads/android.apk 返回 404，保持原访问限制。

## 0.6.320 历史记录

# Android 0.6.320

0.6.320 /292 为 Codex 最后一条已发送消息增加编辑图标和长按编辑入口。编辑在独立弹层完成，取消不修改历史；保存替换原消息及该轮回复，再生成新回复，保留前文、原附件和输入框已有草稿。“再次使用”仍单独保留。需要 Gateway 0.6.109 的 last-message-edit 能力，其他助手本轮没有覆盖编辑入口。

[Debug/Release 最终构建](/D:/codex/build/Codex-mobile-control/android-0.6.320-final-build.log)通过；[唯一模拟器界面检查](/D:/codex/build/Codex-mobile-control/message-edit-ui-check.log)为 OK (1 test)，[截图](/D:/codex/build/Codex-mobile-control/native-last-message-edit-320.png)已核对。首轮检查选到外层滚动节点导致文本输入断言失败，修正定位后通过；最终编译另外包含失败重试保留独立草稿的判断。APK 2,740,036 字节，三份交付、manifest、覆盖编辑标记和 [HTTPS 下载](/D:/codex/build/Codex-mobile-control/release-320-readback.log)一致。下载：[0.6.320 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.320.apk)。继承 0.6.319 的 ID 同行修复；实体手机未测，安装后在空闲 Codex 会话编辑最后一条消息，原消息和旧回复应被替换，前文保留。

## 0.6.319 历史记录

# Android 0.6.319

0.6.319 /291 将上下文弹层显示改为 `ID：完整编号` 同行。编号组件使用调用方分配的剩余宽度，按 Compose 测量选择字号，保留完整 UUID 和极端字体下横向滚动查看。

[构建](/D:/codex/build/Codex-mobile-control/android-0.6.319-build.log)通过；1.3 倍字体的定向仪器检查为 `OK (1 test)`，包含标签与编号同行、编号单行且末位未裁切。[截图](/D:/codex/build/Codex-mobile-control/native-session-status-319.png)已核对；其中连接检查错误来自隔离测试接口未提供状态。交付 APK 2,740,036 字节，仓库、安装网关和 [HTTPS 下载](/D:/codex/build/Codex-mobile-control/release-319-readback.log)逐字节一致。下载：[0.6.319 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.319.apk)。实体手机未测；覆盖安装后打开上下文弹层核对 ID 同行。

## 0.6.317 历史记录

# Android 0.6.317

0.6.317 /289 合并同一次压缩的实时通知与历史标记。历史记录缺少真实 item ID 时，使用唯一的压缩生命周期区间对应记录；后续 turn、下一次压缩及歧义匹配保持独立。完成通知迟到、轮询和历史先到的顺序均沿用同一显示身份，历史 API 的 event ID 保留。

[构建与定向检查](/D:/codex/build/Codex-mobile-control/android-0.6.317-final-build-check.log)通过；NativeInteractionTest 实际为 23 项、0 failures、0 errors。首次检查暴露旧的“失败后无重试”断言，已同步此前交付的失败重试行为。未触发真实压缩，实体手机未测。下载：[0.6.317 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.317.apk)。覆盖安装后，切换出去再返回，核对同一次压缩只出现一条；真实后续压缩应保留。[HTTPS 文件核对](/D:/codex/build/Codex-mobile-control/release-317-readback.log)一致，Gateway 保持 0.6.104，无服务重启。

## 0.6.316 历史记录

# Android 0.6.316

0.6.316 /288 将顶部连接与上下文合并为同一入口。未连接显示红色电脑；已连接但未读到当前会话上下文时显示绿色电脑，读回有效用量后切换成上下文进度环。空对话始终显示电脑，弹层只显示连接信息。切换会话会清理旧用量，按新会话读取，不显示上一个会话的进度。

已有会话的弹层同时展示连接摘要和上下文；路由、Clash、连接检查等操作通过连接块的“管理”展开。压缩上下文及查看用量入口保留。完整 ID 使用等宽字体、零额外字间距，并由 Compose 实际测量选择字号；常规大字体下不换行或省略，极端字号可水平滚动查看。

[定向检查](/D:/codex/build/Codex-mobile-control/android-0.6.316-status-measured-check.log)报告 `OK (1 test)`，16.43 秒，覆盖空对话、读取前后图标、断开后的红色像素、合并弹层、菜单入口、连接管理和完整 UUID 的单行宽度。模拟器字体为 1.3 倍；[截图](/D:/codex/build/Codex-mobile-control/native-session-status-316.png)中的 Codex 检查报错来自隔离接口未提供 Codex 状态，未连接真实电脑服务。初次检查发现 ID 尾部裁切；去除字间距后仍有像素舍入差异，改用 Compose 测量后通过。模拟器已关闭，实体 S23 未测。

[最终 Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.316-measured-release-build.log)通过，2 分 16 秒；manifest 0.6.316 /288，APK 2,740,036 字节。交付、源码下载、安装网关下载及 [实际 HTTPS 文件读回](/D:/codex/build/Codex-mobile-control/release-316-readback.log)一致，Gateway 保持 0.6.104，无服务重启。下载：[0.6.316 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.316.apk)。覆盖安装后核对空对话电脑、当前会话上下文进度及完整 ID。

## 0.6.315 历史记录

# Android 0.6.315

Gateway 0.6.104 已修复 AGY 思考强度的滑块方向：模型目录按低、中、高、超高排序，仅显示实际支持的档位，发送值和默认强度语义保持不变。Android APK 无需更新；目录最多缓存 60 秒，到期后重新打开模型菜单即可刷新。

0.6.315 /287 与 Gateway 0.6.103：桌面收件箱延后五分钟落盘时，通过精确上传路径合并手机回执与桌面消息，保留真正的重复提交。发送确认在筛选当前会话前处理；即使已切换会话，仍清理该提交恢复的旧草稿，不覆盖其他会话的新输入。桌面标题优先使用已有名称和索引标题，移除置顶会话提前退回 UUID 的分支；展开项目里的会话同步刷新标题与状态。

最新执行失败卡片提供“重试”。普通请求沿用原问题和图片，使用当前选择的模型，保留新草稿；目标续跑没有普通用户问题时，重试继续该目标。输入区限制内容高度并滚动，底部模型和发送按钮独立保留；编辑时将输入区域移到可见范围。

右上菜单及连接面板增加“Clash · OpenAI 节点”，支持当前选择、节点切换回执和延迟测试。网关使用电脑端现有命名管道或本机外部控制器，兼容 Clash Verge 服务的 production 管道名称；手机不接收控制器密钥。切换和测试限定于名称包含 OpenAI 的分组。参考 [Mihomo 控制 API](https://wiki.metacubex.one/api/)。本机与实际公网 HTTPS 均成功读回“💡 OpenAI”组的 79 个选项；真实节点未切换，切换与延迟回执由隔离控制器及 Android 模拟接口核对。

[最终 Debug / AndroidTest 构建](/D:/codex/build/Codex-mobile-control/android-0.6.315-composer-build.log)通过。五项[定向交互检查](/D:/codex/build/Codex-mobile-control/android-0.6.315-final-ui-check.log)报告 `OK (5 tests)`，31.971 秒；追加输入滚动后的[检查](/D:/codex/build/Codex-mobile-control/android-0.6.315-composer-check.log)报告 `OK (1 test)`，13.343 秒。采用与正式应用相同的窗口配置并核对未裁剪输入坐标的[键盘检查](/D:/codex/build/Codex-mobile-control/android-0.6.315-production-ime-check.log)报告 `OK (1 test)`，15.98 秒。初次迟到确认检查失败，定位到非当前会话的消息被提前忽略后修复；原失败记录保留。

[最终 Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.315-final-release-build.log)通过，2 分 4 秒。manifest 为 `com.localcodex.control` 0.6.315 /287，APK 2,740,036 字节；检查了新功能的代码内容，交付、源码下载、安装网关下载及 [HTTPS 读回](/D:/codex/build/Codex-mobile-control/release-315-readback.log)一致。下载：[Android 0.6.315](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.315.apk)。实体 S23 未测；覆盖安装后，切换会话并返回，已确认发送的旧内容不应恢复为草稿；容量错误卡片可重试，长文字与多图片输入的模型、发送按钮应完整显示。Clash 节点入口在右上菜单或连接面板中。

## 0.6.314 历史记录

# Android 0.6.314

0.6.314 /286 修复共用弹层入场受高度变化取消、留在屏幕外的问题。连接状态、上下文状态及用量面板均使用此修复；模拟器按实际触摸依次打开、关闭、从菜单进入并再次打开通过。

历史、审批及队列读取改为可取消请求。会话历史独立使用 65 秒预算，适配尚未更新的电脑网关；失败后自动读取间隔 30 秒，手动重试与打开会话可立即读取。超时反馈标明读取超时，已取得的正文保留。定向 Android 检查实际报告 `OK (3 tests)`，33.334 秒，包含超过旧 10 秒时限的历史读取、切换会话与各部分独立失败恢复。

Gateway 0.6.102 已在本机启用。历史响应使用本地任务状态，后台复核 Codex 状态，避免等待最长 60 秒的状态 RPC。大日志按用户轮次寻找最近页面，保留工具记录与稳定 ID；现场约 537 MB 的日志，独立冷读取由约 10.4–13.7 秒降至 4.2–4.9 秒，读取量从约 3 GB 降至约 1 GB。固定日志快照对照中，同页 10 轮、3658 条事件的 ID 及顺序相同；快照已移除。启用后的实际 HTTPS 历史首次读取 5.258 秒，随后 0.698 秒，这属于本机会话读回结果，实体手机网络未测。

Debug / AndroidTest 与 Release 构建通过；Release 2 分 42 秒，实际 manifest `com.localcodex.control` 0.6.314 /286，APK 2,740,036 字节。交付、源码下载、安装网关下载及 HTTPS 读回文件一致。下载：[Android 0.6.314](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.314.apk)。实体 S23 覆盖安装后，依次点击顶部连接、上下文及菜单中的用量，应立即显示面板；切回历史会话应完成读取，已有正文不被超时清空。

## 0.6.313 历史记录
# Android 0.6.313

0.6.313 /285：共用弹层使用保留速度的弹簧入场、关闭和回弹；入场途中按下拖动区即可接管，关闭按钮独立于拖动区。弹出菜单保持触发位置为缩放中心；模型列表与思考强度面板通过短距离滑动、淡入淡出和连续高度变化交接。目标、文件、处理过程与已完成答复的展开和箭头改用一致的弹簧过渡。

发送按钮增加按压反馈，开关轨道与滑块共享状态转换，滑块在渲染层连续移动；会话和目标列表选中颜色、上下文圆环在绘制层读取动画值。[Debug / AndroidTest 构建](/D:/codex/build/Codex-mobile-control/android-0.6.313-test-build.log)通过。定向交互检查覆盖弹层中途关闭、按下接管、短拖回弹、快速下滑关闭、卡片反向展开及模型菜单内容与高度交接；菜单[复查](/D:/codex/build/Codex-mobile-control/android-0.6.313-ui-check.log)实际报告 `OK (2 tests)`。

已查看无遮挡的[弹层截图](/D:/codex/deliverables/Codex-mobile-control/ui-0.6.313/native-motion-313-open.png)和[模型列表截图](/D:/codex/deliverables/Codex-mobile-control/ui-0.6.313/model-controls-list-313.png)。[Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.313-release-build.log)通过，2 分 59 秒；实际 manifest 为 `com.localcodex.control` 0.6.313 /285，APK 2,723,652 字节。[HTTPS 下载读回](/D:/codex/build/Codex-mobile-control/release-313-readback.log)确认与[交付 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.313.apk)一致，网关仍为 0.6.101。实体 S23 未测；覆盖安装后，打开设置弹层并在展开途中按住顶部拖动区，应直接接管；关闭按钮应可用。切换模型列表和思考强度，核对高度连续变化与状态保留；快速展开、收起卡片应从当前位置反向。

## 0.6.312 历史记录

# Android 0.6.312

0.6.312 /284：聊天卡片使用固定圆角，静止和滑动第一帧均保持圆角；关闭时覆盖圆角后露出的侧栏区域，避免显示或点到隐藏会话。保留原有跟手、反向中断和渲染层动画。

移除 0.6.311 的内网 3 秒握手限制，保留前台唤醒与最近健康检查复用。模型目录查询改为可取消的异步请求，同一连接的并发读取合并，成功目录复用 60 秒；手动重新读取及控制台修改模型后强制刷新。Fast 自动读取合并并复用 30 秒内的成功状态。可选状态超时不会改变实时连接或清空输入；模型目录错误显示在模型菜单中，自动重连列表读取失败保留原列表并延后 30 秒重试。手动操作仍反馈失败。

[最终 Debug / AndroidTest 构建](/D:/codex/build/Codex-mobile-control/android-0.6.312-final-test-build.log)通过。定向检查先通过圆角及手势、4.5 秒握手、目录复用与取消、失败后慢目录恢复 4 项；首次超时检查发现列表失败后立即再读，加入重试间隔后[单项复查](/D:/codex/build/Codex-mobile-control/android-0.6.312-ui-check.log)报告 `OK (1 test)`，16.103 秒。验证超时后连接、Fast 状态、输入和发送按钮保留，以及手动 Fast 修改失败仍显示原因。

[Release 构建](/D:/codex/build/Codex-mobile-control/android-0.6.312-release-build.log)通过，3 分 25 秒；实际 manifest 为 `com.localcodex.control` 0.6.312 /284，APK 2,723,652 字节。[在线下载读回](/D:/codex/build/Codex-mobile-control/release-312-readback.log)与[交付 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.312.apk)一致，网关仍为 0.6.101。实体 S23 与真实内网未测；覆盖安装后，滑动侧栏应从第一帧保持圆角，切出再切回时核对发送按钮恢复及顶部超时提示。

## 0.6.311 历史记录

# Android 0.6.311

0.6.311 /283：同一内网连接在断线重连时复用最近 60 秒内验证过的健康检查结果，握手失败仍可转向公网；内网握手等待限制为 3 秒。切回前台时同时唤醒重连等待、取消挂起的内网握手，已连通时保留连接。每个事件流只清理自己的 socket，避免旧流清理误关新连接。

侧栏在动画过程中按下即可接管，小幅拖动也跟随手指；中断只取消动画子协程，保留后续手势处理。构建与 3 项定向检查通过：模拟器挂起握手后切回，实际 234 毫秒恢复可发送；背景重连等待唤醒为 188 毫秒；动画接管、反向拖动及正文不按帧重组均通过。[在线下载核对](/D:/codex/build/Codex-mobile-control/release-311-readback.log)确认与[交付 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.311.apk)相同。

实体 S23 与真实内网未测。覆盖安装后，在内网恢复后切回应用，确认输入保留、发送按钮及时恢复；侧栏正在展开时按下并小幅横拖，应直接跟手，松开后继续收放。模拟器耗时不代表实体手机实网耗时。

## 0.6.310 历史记录

# Android 0.6.310

0.6.310 /282：切回内网时唤醒背景重连等待，连通时保留原连接；公网保持现有重试节奏。侧栏改为聊天页整体右移、侧栏原位揭示，圆角与位移同步，拖动与反向动画连续；键盘收起与侧栏展开同时进行，列表刷新在展开完成后进行。

构建与定向模拟器检查 3/3 通过：内网三次连接失败后切回，实际 124 毫秒恢复可发送，已连通时切回不重建连接；侧栏拖动、反向关闭、列表滚动与会话切换正常，动画帧不重复重组聊天正文。[侧栏截图](/D:/codex/deliverables/Codex-mobile-control/ui-0.6.310/native-drawer-310.png)已检查，在线下载与[交付 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.310.apk)相同。实体 S23 与真实内网尚未实测；覆盖安装后核对切出、切回时发送按钮恢复速度，以及侧栏打开和拖动效果。

保留 0.6.308 的已回答问题过滤和键盘定位，以及 0.6.309 的目标保存确认、失败保留草稿。

## 0.6.309 历史记录

# Android 0.6.309

0.6.309 /281：目标卡片编辑及 `/goal` 表单等待电脑确认后关闭，保存失败保留文本并显示原因；保存期间禁用重复提交、编辑和关闭。缺少目标确认状态时也保留输入。

定向检查 3/3 通过，覆盖失败重试、延迟回包、缺少确认回包和键盘定位；[失败界面截图](/D:/codex/deliverables/Codex-mobile-control/ui-0.6.309/native-goal-save-error-309.png)已检查。Release 构建通过，在线下载与[交付 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.309.apk)相同。实体手机未安装；覆盖安装后核对键盘上方目标编辑，以及保存失败后草稿保留。

## 0.6.308 历史记录

# Android 0.6.308

0.6.308 /280：已回答问题在旧待答快照刷新、重新连接后保持关闭。目标编辑改为页面根部的当前窗口浮层，键盘避让只处理一次，关闭时恢复窗口设置，标题与保存按钮保持在键盘上方。

定向模拟器检查 2/2 通过，实际测量弹层与键盘间距 8dp，目标可保存；[截图](/D:/codex/deliverables/Codex-mobile-control/ui-0.6.308/native-goal-editor-keyboard-308.png)使用隔离测试数据。最终 Release 构建通过，在线 APK 与[交付 APK](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.308.apk)一致。实体手机本轮未安装，覆盖安装后核对目标编辑与同一问题的回答恢复。

## 0.6.307 历史记录

# Android 0.6.307

0.6.307 /279：移除输入框的模型回报提示，助手不可用时保留实际原因。Gateway 0.6.101 读取 DeepSeek 官方桌面供应商中的自定义模型，配置变化后刷新目录；原生会话按已有编号关联，用户消息与完整回复进入同一份手机、网页历史，原生文件变化触发刷新。

Release 构建通过，APK 与本机 HTTPS 下载入口一致。在线目录已读到 ecnu-max、ecnu-plus，实际关联会话读到 3 条用户消息与 11 条原生回复。实体手机及官方桌面双端操作尚未验证；手机覆盖安装后重新连接，并刷新 DeepSeek 模型菜单与会话列表。

## 0.6.298 历史记录

# Android 0.6.298

0.6.298 /274：标题与工作区按实际字体的可见字形左边缘对齐；顶部右侧独立电脑按钮显示连接状态，绿色为已连接、灰色为连接中、红色为未连接，点击查看详情。两行文字不再附带连接点。

## 0.6.297 历史记录

# Android 0.6.297

0.6.297 /273：会话顶部标题改为 16sp /20sp 行高，工作区为 12sp /16sp 行高，移除额外字体留白，两行间距 1dp。连接点与标题同行；工具栏最小高度 56dp，放大字体时按内容增高，长标题及工作区仍单行省略。

## 0.6.296 历史记录

# Android 0.6.296

0.6.296 /272：弹层遮罩覆盖整个窗口，面板内容单独避让系统栏与键盘；侧栏和内容各自处理系统栏留白，不在遮罩外留下白条。新会话顶部显示助手名称，欢迎区和会话标题简化；输入框内选择工作区，选择页支持搜索名称及路径、显示完整目录和当前选择。侧栏“新会话”沿用当前工作区；已有会话显示真实标题及工作区名称。

## 0.6.295 历史记录

# Android 0.6.295

0.6.295 /271 + Gateway 0.6.96：同一次发送的桌面历史与网关回执合并，刷新旧缓存后仍只显示一个用户气泡；不同请求的相同文字仍保留。发送确认后移除本次已发送图片和文件的草稿引用，处理迟到确认及重新打开会话，并保留新加入的附件。

## 0.6.294 历史记录

# Android 0.6.294

0.6.294 /270 + Gateway 0.6.95：加入 DeepSeek Harness、Hermes 助手入口，并为外部助手复用持久化提交回执。窗口宽度达到 840dp 时显示可收起的常驻侧栏，对话最大宽度 1040dp，弹层最大宽度 720dp；窄屏继续使用抽屉。按当前窗口尺寸响应平板、横屏和分屏。新助手配置及能力见 [Harness 说明](harnesses.md)。

## 0.6.293 历史记录



0.6.293 /269 + Gateway 0.6.94：存储与缓存新增电脑上传附件管理。按名称、大小和上传日期查看图片、文件、视频，可搜索并筛选 30 /90 天前的附件，选择后确认永久删除。草稿及发送队列引用的附件受保护；上传或电脑任务运行期间暂停清理。客户端在上传、修改草稿和连接后同步草稿引用，服务器持久保存这些引用，不按时间自动删除上传原件。

## 0.6.292 历史记录

0.6.292 /268 + Gateway 0.6.93：同一次上下文压缩在刷新历史后保留一行，使用明确事件身份区分后续真正的压缩。图片历史中的上传路径与原上传附件合并为一个图片入口；原上传回执超出保留窗口后，可从仍存在的上传文件恢复图片入口，避免重复缩略图与额外的 404。Web 同步修正压缩事件识别。

## 0.6.291 历史记录

0.6.291 /267：发送、加载和停止图标在固定 36dp 圆形区域中居中淡入淡出；切换状态不再改变过渡容器的尺寸或图标中心，移除发送按钮按压缩放。

## 0.6.290 历史记录

0.6.290 /266 + Gateway 0.6.92：Android、Web 和网关统一移除项目额外设置的每条消息 8 张图片限制，包括图片选择、混合媒体选择、历史消息复用、队列草稿恢复和消息提交。单张图片 5MB 的网关上传限制继续生效，普通文件和视频仍计入原有 8 个文件上限。Codex 提交与引导使用 App Server 的 localImage 输入，传递已校验的上传文件路径，避免 Base64 图片撑大 RPC 消息。最终处理能力由所选 Codex 模型与实际后端决定。

## 0.6.289 历史记录

0.6.289 /265：附件阅读与系统打开使用规范 MIME。明确类型去除参数、空白并统一大小写；类型缺失或为通用二进制时，根据文件名补齐 Markdown 及已知格式，未注册的常见代码扩展名按 text/plain 阅读和打开，未知文件继续使用 application/octet-stream。保存时，系统未识别扩展名的 text/plain 文件使用通用存储类型，避免 Android 追加 .txt；原扩展名、文件内容及草稿附件保持不变，Markdown 仍按 text/markdown 保存。

## 0.6.287 历史记录

0.6.287 /264：超过 5MB 的 Markdown 附件及会话文件沿用普通文件保存和系统打开流程，不再因内置预览限制而报错。只在文件不超过 5MB 时读取文本正文；普通文件的 100MB 下载上限保持不变，关闭或返回后草稿与附件保留。

## 0.6.286 历史记录

0.6.286 /263：文本与 Markdown 阅读支持 UTF-8 和带 BOM 的 UTF-16LE / UTF-16BE，移除开头 BOM 后显示正文；保存时保留原编码和 BOM。无法解码的附件沿用原始文件保存与系统打开流程，原字节不变；已有 5MB 预览限制保持不变。

## 0.6.285 历史记录

0.6.285 /262：5MB 以内的 UTF-8 文本附件可直接在应用内阅读，包括 TXT、JSON、日志和常见代码文件。普通文本按原文显示，可选择文字；需要保留到手机时点“保存”，使用对应文件类型导出。关闭后草稿与附件保留，Markdown 继续提供阅读/源码切换，较大普通文件沿用系统打开流程。

## 0.6.283 历史记录

0.6.283 /261：PDF 附件依据文件名和 MIME 识别。文件提供方返回通用 MIME 时，`.pdf` 文件仍使用应用内 PDF 阅读器；MIME 的大小写、前后空白及参数不影响 PDF、图片和 Markdown 的预览类型判断。沿用现有 PDF 缓存与关闭操作，草稿内容保留。

## 0.6.282 历史记录

0.6.282 /260：输入区的待发送文件卡片可点击，使用现有附件打开流程查看内容，点击区域至少 44dp。关闭阅读器后文字与附件保留；移除按钮独立操作，不触发打开或发送。当前完整状态及验证记录见 [当前工作与完成状态](work-status.md)。

## 0.6.209 历史记录

0.6.209 /227：终端按电脑、证书和项目分别持有会话、草稿及最近输出，执行和停止固定操作发起时的目标。输入确认成功才清空，失败保留并显示原因；新输入不被旧确认清掉。启动早期输出保留，忙碌时避免重复提交。两项模拟接口检查通过；本轮未执行真实终端命令。Gateway 沿用 0.6.86。

0.6.208 /226：改动查询按当前项目和请求归属更新，切换上下文清除旧内容，旧回包不覆盖新项目。普通工具错误不再修改独立的消息发送状态。Gateway 沿用 0.6.86。

0.6.207 /225：修复项目文本文件保存按钮缺失；编辑草稿由 ViewModel 按电脑、项目和文件持有，关闭面板后重开可继续编辑。保存期间的新修改保留并显示未保存状态。草稿限本次客户端运行期间；正式保存写回电脑。真实面板与模拟接口检查通过。Gateway 沿用 0.6.86。

0.6.205 /224：新目标部分创建后失败，再次从输入框发送相同命令会走原提交回执与重试路径，和失败消息重试入口一致，保留原请求设置及待发附件。Gateway 沿用 0.6.86。

0.6.204 /223：入队期间切换会话，成功确认后仍清除原会话已提交的文字和附件；保留随后输入的不同内容及新附件。Gateway 沿用 0.6.86。

0.6.203 /222：取回待发消息期间切换会话，文字和附件仍保存到原会话草稿；当前会话输入不被覆盖。相同队列项正在取回时，重复点击不再发起第二次操作。Gateway 沿用 0.6.86。

0.6.202 /221：待发图片和文件按电脑、证书、助手及会话保存，切换会话恢复各自附件；移除、发送和失败恢复同步更新附件草稿。新目标创建后迁移待发附件。两项定向检查通过，覆盖会话切换、客户端重建、移除／发送清除及新目标附件迁移。Gateway 沿用 0.6.86。

0.6.199 /220：新会话可直接输入 `/goal 目标内容`，复用提交回执创建会话并启动目标；失败可重试，输入框附件保留待发。已有会话继续直接设置目标。Gateway 0.6.85。Release 构建与两项定向界面检查通过。

0.6.198 /219：已有 Codex 会话中的 `/goal 目标内容` 直接保存目标并显示目标条，失败保留输入，成功后清除原命令；不再发送普通 `/goal` 消息。目标保存期间切换会话，旧回包不覆盖新会话的消息发送状态。侧栏按压和选中底色共用圆角裁切，“进行中”与普通会话行统一轮廓。Release 构建、定向界面检查、覆盖安装冷启动及真实下载读回通过；实体手机覆盖安装后的外观待用户核对。Gateway 沿用 0.6.84。

# Android 0.6.197

0.6.197 /218：正文分块复用固定围栏和表格正则，每个代码块只创建一次结束围栏表达式，消除逐行重复编译。隔离的真实时钟入队、菜单和回答交互检查通过；正式版构建、模拟器覆盖安装及冷启动通过。单次采样不证明真机卡顿已修复，剩余长帧继续开放。Gateway 沿用 0.6.84，附件发送采用桌面本地文件格式。

# Android 0.6.191

0.6.191 /214：图片预览改用原生窗口约束，绕过 Compose 1.7 自定义宽度 Dialog 使用 `screenHeightDp` 限制高度的行为；取消窗口级系统栏避让，并在取得焦点后隐藏系统栏。图片保持等比显示。图片文件链接、图片附件及工作区图片使用应用内缓存预览，只有点击保存按钮才写入相册；“查看图片”详情带上原始事件以解析会话图片。Gateway 保持 0.6.81。

0.6.190 /213：压紧模型面板中央的强度和模型名两行，两行间距 1dp，整组可点击选择模型。长按正文后的系统选择菜单、回复菜单和用户消息菜单提供“跨段选择”，在单个连续文本页内拖动选区，可跨越当前已加载的段落和消息，保留原始 Markdown 文本；更早记录须先在聊天中加载。图片预览隐藏系统栏并延伸至全屏，保留缩放、滑动和保存；边缘滑动可临时唤出系统栏。网页链接直接交给系统默认浏览器。目标条与文件改动条的按压背景按外层圆角裁切。配套 Gateway 0.6.81 同时识别 Fast 的 `fast` 和后端规范化的 `priority` 返回值，修复重新打开模型菜单误显示关闭。

0.6.189 /212：紧凑面板滑条增高到 34dp，圆形滑块同步放大；顶部 Fast 底块改为 28dp，缩小强度、模型和重置图标。实际点击区域保留。配套 Gateway 0.6.80 过滤无内容的会话占位记录；手机刷新不再把服务端已移除的选中记录补回。

0.6.188 /211：模型面板改为紧凑的强度、模型、滑条布局，点模型名展开列表；修复文字与滑条叠放。Fast 仅用图标和底色表达开关，关闭时输入栏隐藏闪电。提交提示可关闭并按消息记忆；失败发送记录支持逐条移除与当前会话批量清除。

0.6.187 /210：闪电开关移入模型弹层，与思考强度同一行；输入栏模型名前显示小闪电状态。配套 Gateway 0.6.79 将共享后端改为独立守护，网关自动拉起，桌面退出不会终止后端。旧桌面占有的会话需首次退出后释放。

0.6.186 /209：思考强度旁增加单个闪电开关，删除 Fast 三选项及独立标签。读取当前会话 Fast 状态，点击通过 Gateway 0.6.77 保存会话设置；新建会话的显式选择随创建保存。

Gateway 0.6.76 历史修复：只上传文件时历史消息重复显示内部路径说明，重新进入会话生效；该修复不要求升级 Android。

0.6.185 /208：公网测试完整通过后，已连接内网时保留内网，未连接时直接切换公网。连接状态及配对页增加“连接内网／连接公网”和“恢复自动”；手动选择会保存，前台重连及后台通知遵循相同路线。仅公网模式不自动切回内网。网关保持 0.6.75。

0.6.184 /207：Markdown 阅读器内显示文件链接的加载、失败和重试状态，失败提示保留至重试或关闭；主界面沿用短暂提示，并增加关闭入口。阅读器打开 PDF 时显示在上层，关闭 PDF 返回 Markdown。网关保持 0.6.75。

0.6.183 /206：文档链接先分离查询参数、片段和行号，再按链接规则单次解码；含百分号、井号的原始文件名通过独立路径入口处理。Markdown 与 PDF 链接可带行号或片段并打开正确文件，文档内相对图片保留转义。配套 Gateway 0.6.75 修复输出链接的同类解析问题，沿用现有文件访问权限。

0.6.182 /205：上传失败与附件数量限制直接显示在输入区，支持详情、复制完整错误和关闭提示。失败响应保留 HTTP 状态及完整正文，HTML 或空响应不会被误报为 JSON 解析错误；无法识别的成功响应明确提示结果异常。网关保持 0.6.74。

0.6.181 /204：附件上传显示传输进度。已知长度显示百分比，未知长度显示已传输字节；正文发送完后显示“等待电脑确认”，成功收到回复后才完成。进度刷新限频，文件及批次切换后忽略旧进度。网关保持 0.6.74。

0.6.180 /203：上传批次显示当前文件序号并可取消。图片、视频和文件使用可取消的 HTTP 请求；手动取消保留已完成的附件，切换会话、项目或连接时取消当前批次，旧回调不会占用新批次状态。图片读取途中响应取消，媒体类型识别移到后台。网关保持 0.6.74。

0.6.179 /202：文件与视频上传支持文件选择器未提供大小的情况，使用未知长度的流式请求，读取中仍执行 100 MB 上限。元数据按列名读取；空文件、超限和已知大小发生变化分别提示。附件名称中的空格使用百分号编码，与字面加号正确区分。网关保持 0.6.74。

0.6.178 /201：保存文件时保留名称中的百分号和井号，原始文件名不再按链接重复解码；链接的查询参数和片段在解码前处理。图片路径参数只使用已解码值。已有预览缓存按原端点键兼容读取，网关保持 0.6.74。

0.6.177 /200：图片保存时从原始编码数据识别格式，再写入相册并确定文件扩展名；快速切换图片后不再沿用上一张预览的格式。保留原始字节，不重新压缩。其他可解码图片按系统 MIME 映射保存，不再一律标为 PNG。网关保持 0.6.74。

0.6.176 /199：模型菜单的 Fast 选项明确区分“跟随会话 / 开启 / 关闭”。跟随会话沿用电脑端设置，不再显示成关闭，也可在指定开启或关闭后恢复跟随。网关保持 0.6.74。

0.6.175 /198：云端消息去掉前置投递元数据，保留正文和用户引用的示例；没有可见内容的历史轮次不再单独显示结束时间。有用户消息、操作、压缩或错误的轮次仍保留相应记录。配套 Gateway 0.6.73。

0.6.174 /197：模型选择菜单加入 Fast 快速模式开关，Codex 会话可在同一菜单调整模型、思考强度和快速模式，沿用已有发送参数。

0.6.173 /196：图片直接保存到相册 Codex，相应 PDF、Markdown 和普通下载保存到下载/Codex，不再弹出保存路径选择。Android 8–9 首次保存按需请求存储权限，Android 10 及以上使用 MediaStore。删除原有输出／PDF 缓存的 24 小时清理；原图和 PDF 预览缓存保存在应用持久目录，默认上限 1024 MB，可在右上角“存储与缓存”调整到 128–8192 MB，显示占用并手动清理。超限按最近使用情况淘汰，查看中的 PDF 保留；相册和公共下载目录不参与缓存清理。缓存按电脑绑定隔离，原图请求合并，解码位图仍有独立内存上限。

Markdown 阅读器改用语法树识别图片，支持引用式图片，代码示例保持字面内容；文内相对链接使用文档目录，图片按可见区域加载。网关保持 0.6.72。

0.6.172 /195：Markdown 阅读器接入现有图片加载与预览，内联图片按文档所在目录解析相对路径；保留按比例显示、高度上限、失败重试和点击放大。读取会话输出 Markdown 时保留原回复及会话来源，Gateway 0.6.72 可在内网读取该文档明确引用且位于其目录内的图片，核验真实路径和图片格式，不生成项目授权。公网仍只读取已授权项目中的文件。

0.6.171 /194：内网连接断开后先重新尝试内网；连续失败才回退公网。回到前台时，若当前使用公网，立即按原证书指纹探测内网，可用则通过现有连接循环切回，不清空当前会话及阅读缓存。前台使用公网时最多每 30 秒进行一次内网健康探测；同一轮重连保留探测间隔，避免地址来回切换。后台通知连接采用相同的内网重试顺序。网关仍为 0.6.71，手机需覆盖安装新版。

0.6.170 /193：错误详情改为完整原文展示，支持选取文本及一键复制；重连错误可展开查看，最终失败默认展开。读取网关 willRetry 标记，自动重试不结束运行状态或恢复为发送失败。配套 Gateway 0.6.71 保存错误原文、附加详情和类型，转发重试状态；网页同步采用完整详情及复制入口。

0.6.169 /192：新增定时任务入口，侧栏和会话菜单均可打开；读取 Codex 现有任务和原生调度时间，支持暂停、恢复、编辑，以及为当前会话新建间隔任务。触发消息默认收成一行，展开才显示指令，管理按钮定位对应任务，旧 heartbeat 缓存也兼容。配套 Gateway 0.6.70 提供任务管理接口并清理触发消息的内部标签。原有任务保持原调度器运行，没有新增网关定时器。

0.6.168 /191：配套 Gateway 0.6.69 修复会话状态／标题刷新误裁剪回复历史。只有真实轮次开始或用户消息能移动历史窗口；轮次开始直接发送给客户端，并以轮次 ID 去重，回放保留开始时间。修复前针对性通知回放把 8 段正文裁成空，修复后历史与任务状态 22 项检查通过。手机渲染代码未变，现有客户端可以直接使用新网关。

0.6.167 /190：配套 Gateway 0.6.68 将目标继续改为先保存会话模型、思考等级、模式和权限，再激活目标调度；不发送额外的“继续”用户消息。现有手机端可直接使用新网关，无需为此覆盖 APK。9 项隔离目标恢复检查通过；真实手机上的模型调用待确认。

开始修复新问题前先核对 [当前工作与完成状态](work-status.md)，避免重复实现下列旧版本已完成的交互。

0.6.166 /189：手机界面沿用 0.6.165；配套 Windows 安装器共用临时解包生命周期，成功或失败均清理本次生成的目录，显式 `/extract` 目录保留。针对较长临时路径声明 .NET Framework 4.6.2 目标并使用 Windows 扩展文件路径。实际 Setup EXE 的含空格路径安装、失败清理及显式导出均通过。Gateway 保持 0.6.67。图片横／长比例、高度上限、404 重试以及 PDF 翻页／放大／关闭重开已通过模拟器检查；首次 PDF 检查超时，单独与同序组合复查通过，首次超时原因尚未确认。实体手机尚未连接。

2026-10-05 补充验证：隔离模拟器 12 项通过，覆盖延迟历史与流式正文合并、滚动位置、文件行数及未知侧、完成后折叠展开、用量弹窗系统栏、慢文档切会话取消与图片传输上限；缓存／阅读位置 JVM 5 项通过。详见[当前验证记录](work-status.md)。正式应用绑定与发行包版本未改变，实体手机未连接。

0.6.165 /188：文件改动汇总分别判断新增和删除是否已有记录；只知道一侧时只显示该侧，另一侧不显示误导的零，也不添加未记录文字。已有的真实零行保留显示。安卓和网页同步。处理过程测试改为按展开详情的语义定位，不再依赖已删除的处理过程文字；只编译测试源码，不执行界面测试。手动确认：只有新增或删除统计的卡片应只显示已知侧，两侧未知时只显示文件数。

0.6.164 /187 + Gateway 0.6.67：合并日志快照与实时通知时，保留已知本次压缩开始时间。日志已在开始后写入有效上下文估算、而实时完成通知稍晚到达时，优先采用该日志估算，避免有效数值又变成待更新。开始前估算、仍待更新的日志及普通请求快照不走此特殊选择。安卓界面沿用上一版，版本随发行包更新。手动确认：压缩后新日志统计已到达时，稍晚的完成通知不应让当前占用重新显示待更新。

0.6.163 /186 + Gateway 0.6.66：实时 Token 通知按上下文压缩项目 ID 记录开始、完成与开始前快照。本次压缩开始之后收到的上下文估算可在完成时保留；只有上次压缩估算时则转为待更新，避免连续压缩复用旧数值。相同项目的重复开始／完成通知不重置状态，压缩记录最多 128 个会话，读取器关闭时清理。未收到开始事件的连接恢复场景沿用既有通知兼容逻辑。安卓界面沿用上一版，版本随完整发行包更新。手动确认：连续进行两次上下文压缩，第二次新统计未到达前不应沿用第一次估算；新统计到达后恢复显示。

0.6.162 /185 + Gateway 0.6.65：压缩日志与普通日志统一识别 compacted、context_compacted、context_compaction 三种上下文压缩标记。压缩发生但尚无新 Token 快照时，上下文统计待更新，保留已有累计消费；收到新快照后恢复当前上下文统计。健康接口版本直接读取网关包版本，避免另处写死的版本号滞后。安卓界面沿用 0.6.161，版本随完整发行包更新。手动确认：开启会话压缩后，旧上下文数值不应继续作为当前占用；新请求统计到达后应恢复显示。

0.6.161 /184：独立 Dialog 窗口共用系统栏配置，显式同步状态栏／导航栏背景、图标明暗及对比度策略。PDF、Markdown、改动详情与电脑控制台使用当前主题背景；黑底图片预览固定浅色系统图标；底部弹窗与小表单保留透明系统栏。配置只作用于对应 Dialog 窗口。手动确认：分别在浅色和深色外观打开用量、电脑控制台、PDF 与图片预览，系统栏图标应清楚可读，关闭后聊天界面颜色应正常。

0.6.160 /183：PDF 打开过程在 IO 内保存资源所有权，关闭或切换时即使协程取消也能释放渲染器和文件描述符；读取页面尺寸时检查取消。单页位图按宽、高、像素总量共同限制，保持原比例，最多约 8MiB；渲染失败和取消交付时回收尚未显示的位图。网页 PDF 画布采用相同像素总量上限，显示尺寸保持原比例，关闭或连接归属变化后清空画布并释放渲染任务。原文件下载及保存大小限制保持不变。手动确认：打开 PDF 后迅速关闭，应能再次正常打开；长文档连续滚动及放大后，页面比例应保持正常。

0.6.159 /182：会话缓存按事件及附件字段长度估算占用，超过 12MiB 时提前停止，不再将完整事件转换成长字符串。仍最多保留 8 个非活动会话，过大的会话仅留在当前视图。阅读位置按电脑地址、助手及会话共同保存，上层列表使用相同范围区分生命周期，避免换电脑后沿用同 ID 会话的位置；加载历史窗口也读取对应电脑的位置。位置记录仍最多 40 条。手动确认：在会话中向上阅读后切到其他会话，再切回来应恢复原位置；切换电脑后应使用该电脑自己的阅读位置。

0.6.158 /181：文件下载改为可取消的异步 HTTP 请求，切换会话或连接后会终止上传附件、Markdown 和 PDF 的旧下载。下载失败、取消或结果过期时清理临时文件，Markdown 读取后始终删除临时副本；成功打开的 PDF 和外部文件保留供查看。沿用文件大小上限和请求归属检查。手动确认：读取较慢的 PDF 后立即切会话，旧预览不应弹回；回原会话重新打开应正常显示。

0.6.157 /180：文件读取绑定发起时的电脑连接、会话和项目。切换后取消旧请求、清理旧预览／反馈／重试入口，迟到的文件、Markdown、PDF 和外部打开结果不进入新页面；旧请求结束不覆盖新请求的忙碌状态。项目选择、创建和搜索也校验请求所属连接，断线恢复后会重新执行当前搜索。多个一般操作共用计数维持忙碌状态。网页补齐文件、预览、保存反馈和 diff 操作的连接／请求序号检查，PDF 在首次绘制前监听关闭并释放任务。手动确认：打开一个读取较慢的文件后立即切会话，旧预览不应弹回；网页打开 PDF 后关闭或切换文件，页面应保持新选择。

0.6.156 /179：本轮主要修复 Windows 安装与卸载的共享配置恢复，安卓沿用 0.6.155 功能。随包提供独立 [手机使用说明](mobile-usage.md)，覆盖扫码连接、队列、结束时间、图片和文件操作，可随安装目录直接阅读。

0.6.155 /178：保留 0.6.154 的安卓图片缓存、空闲刷新与状态缓存优化，配套 Gateway 0.6.63 补齐网页版。网页前台运行中每 2.5 秒刷新，空闲 10 秒，隐藏页面暂停定时读取，回到页面立即同步；图片预览授权最多 128 项，尺寸记录最多 256 条，重新连接时清空。网页图片重试会重新取得预览授权，避免重复使用失效地址。网页会话缓存估算计入嵌套操作正文，继续限制为 8 个非活动会话／估算 12MiB。覆盖安装 [0.6.155 APK](../artifacts/Codex-Control-0.6.155.apk)，保留绑定。

0.6.154 /177：正文图片按解码内存占用使用 32MiB LRU 预览缓存，原有缩略图缓存保持 16MiB；图片尺寸最多 256 条，预览被淘汰后再次加载仍可按已有比例占位。切换电脑或断开连接时清空图片缓存。展开状态采用最多 2,000 项 LRU，连接电脑时重置。前台有运行、发送或待发消息时按 2.5 秒刷新，空闲 10 秒，后台 30 秒；回到前台立即刷新，后台通知服务保持原逻辑。Android Release 构建通过（2m22s）；本轮没有运行额外测试或实体手机测量。覆盖安装 [0.6.154 APK](../artifacts/Codex-Control-0.6.154.apk)，保留绑定。手动确认：同一连接中切回含图片的会话，图片仍保持比例；切到后台再回来，页面应立即同步。

0.6.153 /176：每轮运行的结束时间显示在答复更多菜单顶部，格式为“结束于 今天／昨天／日期 HH:mm:ss”，按设备本地时区显示。时间取自该轮结束事件，完成、中止或失败都可查看；没有正文的运行在该轮末尾显示一行结束时间。短回复保留菜单入口。网页同步提供回复菜单和结束时间。覆盖安装 [0.6.153 APK](../artifacts/Codex-Control-0.6.153.apk)，保留绑定。手动确认：打开两轮答复的更多菜单，时间应对应各自运行；正在运行的轮次结束后再出现结束时间。

0.6.152 /175：文件改动卡片只显示文件数和已有的新增／删除行数，保留上一版的图片比例与高度上限。网页已同步。覆盖安装 [0.6.152 APK](../artifacts/Codex-Control-0.6.152.apk)，保留绑定。

0.6.151 /174：回复内图片按原始宽高比显示，容器与图片尺寸一致；高度不超过 320dp 或屏幕高度的 50%，达到上限时同步缩小宽度，点击仍可查看大图。加载／失败占位高度为 96dp。文件改动卡片显示已有的新增、删除行数；缺少行数的后续事件不覆盖已取得的统计。网页同步限制图片高度为 320px 或视口高度的 50%，并修复行数显示。覆盖安装 [0.6.151 APK](../artifacts/Codex-Control-0.6.151.apk)，保留绑定。手动确认：查看一张横向长条图、一张竖向长图，以及有改动记录的文件卡片；横图不应有上下灰边，竖图不超过半屏，卡片应显示已记录的 `+新增 / −删除`。本轮未运行模拟器或实体手机检查。

0.6.150 /173：只调整子代理数量角标。图标与数字作为一个紧凑组合，角标相对图标定位，取消按钮右侧固定定位；按实际数字尺寸测量，数字变宽时扩展组合宽度。数字使用独立的 8sp 字号与 9sp 行高，浅色背景最小 14dp，防止继承正文行高后撑成高胶囊。机器人主体与其他顶栏图标保持居中，角标位于主体上方、天线右侧，保留间隙。手机覆盖安装 [0.6.150 APK](../artifacts/Codex-Control-0.6.150.apk)，保留原绑定。手动确认：打开含 14 个子代理的会话，数字应贴近图标右上方，且不遮挡机器人主体或天线。

已按用户授权完成最终隔离截图（14 个子代理、1.3 倍字体），[查看效果](../artifacts/agent-badge-14-150-final.png)。初次截图定位了正文行高继承问题，修正后最终截图核对通过；仅执行这两次各一张截图的夹具，未连接真实会话或安装实体手机。

Gateway 0.6.61：未选择项目的新会话沿用 Codex `[desktop].projectlessWorkspaceRoot`，目录结构为根目录／日期／任务名；没有配置时使用 `~/Documents/Codex`。显式选择项目与已有会话的工作目录不变。该修复仅更新网关，无需更新 APK；手动新建未选项目的会话即可确认目录来源。

0.6.149 /172：同一轮任务的工具操作统一在回复开头展开，运行时不再在各段正文后分别显示操作分组。任务结束默认折叠，最终答复、审批、错误和文件更改摘要保留可见。折叠栏只显示箭头和有效用时；缺少起止时间时显示操作数量，不显示“处理过程”或“收起处理过程”。子代理保留右上角小图标按钮和悬浮数量角标，按钮为图标与角标预留独立空间，避免遮挡。网页端采用相同入口与折叠规则。

手机覆盖安装 [0.6.149 APK](../artifacts/Codex-Control-0.6.149.apk)，保留原绑定。手动确认：角标悬浮在机器人图标右上方且不遮挡图标；运行带命令和多段回复的任务时，只有该轮开头一个折叠入口，正文末尾没有重复入口；完成后自动折叠，点击箭头可展开，再点击同一位置收起。本轮只构建，没有执行界面测试或在实体手机安装。

0.6.129 /152：合入新的 AGY 完整性增量，客户端保留完整一轮长回复；网关在 stdout 排空且进程成功后仅补齐一致尾文。后端不可用原因与实际回报模型分别显示，保留公网 Claude 拒绝。0.6.128 的文件预览、中文加粗、历史分页和消息确认恢复均保留。网关配套版本 0.6.41，最终验证见 [本轮记录](verification-0.6.129.md)。本轮未部署正式网关或安装实体手机。

0.6.128：内网会话的输出文件按原消息引用读取，不需添加项目；中文加粗不再显示原始星号。原消息、文件权限配置及 0.6.127 的交互修复保留。见 [本轮验证](verification-0.6.128.md)。

0.6.126：合并云端只读快照与本地 Codex 持久提交回执；复用原发送确认和失败恢复记录，完整原始命令冻结后去重，未知结果只查询，明确 writer 拒绝可重试。保留 10 轮历史分页、分层操作加载、用量窗口与现有动效。连接状态的“测试公网连接”和“连接电脑”同排等宽。Gateway 0.6.38 完整测试 105/105、Web 49/49、远程 Chrome 模拟检查 5/5、JVM 160/160、最终 16 项定向模拟器交互通过，完整 lint 0 错误/24 警告，Release 构建通过。初始 106 项批次中的 3 项失败已在定向复测修复，未重复完整批次。versionCode 149；APK 2,472,560 字节，SHA-256 `74ECBB2C9829F78E96A44507DD8B6536BFB7CC7339F6F630F4272506D3B38007`，签名与 0.6.125 相同。本轮未部署/重启正式网关或安装实体手机；完整结果见 [合并验证](../deliverables/verification-summary-0.6.126.json)。

0.6.125：历史分页改为每次 10 轮用户对话，命令数量不占消息轮数。折叠处理过程只传摘要，展开后读取操作类别，再点开具体操作读取正文；已展开内容保留在有界缓存中，轮询不重复取正文。修复发送前 `thread/resume` 请求整段历史造成的超时：恢复时只取最近一轮元数据，保留活动轮次标识。截图对应的真实会话更新前 60,048 ms 超时，更新后 224 ms 成功；仅验证恢复请求，没有向该会话发送测试消息。WebSocket 接收增加背压，避免突发事件丢掉确认；8 秒未确认时查询电脑回执。未确认或失败的消息与附件持久保存，新草稿单独保留；重试先查上次结果，已接受的请求不再次发送，明确失败后使用新的请求标识。用量周期切换保留上一份数据与对应时间范围，窗口固定高度、加载行预留空间。验证：服务端 36 项相关测试、构建和网关 smoke 通过；158 项 JVM 单测与 11 项定向模拟器测试通过。批量运行中的一项受另一个 instrument 占用界面影响报错（`No compose hierarchies found`），单独重跑通过。Release 148 / 0.6.125 构建通过，模拟器覆盖安装冷启动 3.097 秒；APK 2,472,560 字节，仓库、安装网关与 HTTPS 下载一致，HTTP 200。实体 S23 的发送和滑动体验仍需覆盖安装验证。

0.6.123：输入框上方增加额度与模型容量通知。实时账号额度剩余 **10% 及以下**显示“额度剩余不多”、具体比例与可用的重置时间；耗尽后升级为“额度已用完”。连接期间每分钟刷新 Codex 额度，已显示的比例随新数据更新，旧记录和缺失数据不触发预警。`usage_limit_reached`、`insufficient_quota` 等额度错误，以及 `No capacity available` 等容量错误分别显示明确提示；通知可关闭，保留输入，不抢焦点，同一轮重复错误和历史回放不反复提醒。这两类失败不发送状态栏任务通知；错误原因晚于结束事件到达时，先等待明确原因，再决定通知方式。普通完成与其他明确失败原因的后台通知仍保留。AGY 当前没有可用的额度百分比，额度与 capacity 报错可提醒，但不能提前按百分比预警。158 项 JVM 单测、6 项模拟器交互通过，涵盖 10% 边界、预警比例更新、关闭去重、耗尽升级、旧额度记录、错误先后顺序与既有完成通知。截图使用测试数据：[低额度提醒](../artifacts/native-low-quota-notice-0.6.123.png)、[额度耗尽](../artifacts/native-quota-notice-0.6.123.png)、[容量不足](../artifacts/native-capacity-notice-0.6.123.png)。最终 Release 构建 2m44s 通过，versionCode 146；APK 2,456,176 字节，SHA-256 `292873796147110872EDE684F2D2693D5B80E0D6816FC049AE0B2EE52587D8EC`。模拟器覆盖安装冷启动 2.090 秒、进程存活，无 AndroidRuntime 错误；仓库、实际安装网关与局域网 HTTPS 下载内容一致，下载 HTTP 200。本轮为 Android 改动，使用已部署网关现有的错误与额度接口；实体 S23 待覆盖安装复核。

0.6.122：停止操作增加等待电脑确认的状态，期间禁用重复发送；明确收到结束事件或历史确认结束后恢复发送按钮。停止请求未发送、失败或超过 12 秒未确认时显示原因，保留真实运行状态；延迟收到历史确认后自动清掉超时提示。网关支持停止尚未跟踪的桌面 Codex 轮次，并以较新的网关生命周期事件覆盖旧的运行中日志；同一停止已完成时返回当前状态，新轮次开始后仍可正常运行与停止。文件加载、下载和失败反馈改为不抢焦点的短通知条，失败提示 5 秒自动收起并提供重试。150 项 JVM 单测、5 项 Android 定向交互、8 项网关定向测试和完整 smoke 通过；smoke 复现并验证“停止后旧历史重新启用按钮”，另核对重复停止与下一轮。截图为测试数据：[等待停止确认](../artifacts/native-stop-pending-0.6.122.png)、[文件失败通知](../artifacts/native-file-network-error-0.6.122.png)。Release versionCode 145，2,456,176 字节，SHA-256 `929FCF247AA8DBAF6FB7AF905702266D94604304B4FE8DF798B979A57A9E4DF3`；模拟器覆盖安装、冷启动 1.703 秒及进程检查通过，无 AndroidRuntime 错误。实际网关已更新，桌面共享恢复；公网连接与边界检查、局域网 HTTPS 下载校验通过。实体 S23 待覆盖安装复核。

0.6.121：修复模型目录读取失败后选择器持续为空。目录请求使用 30 秒超时，短暂失败最多重试两次；手机按电脑地址保存上次成功取得的目录，启动时立即显示缓存，后台失败不清空。没有缓存或可用目录时显示助手默认模型，推理强度使用 high。网关目录过期后后台刷新，同时返回上次成功数据。输入框旁的引导按钮与图标已整体移除。文件列表、读取、保存和附件打开立即显示进度，等待超过 5 秒显示慢响应提示；失败时说明超时、连接、权限或文件问题，并可重试或关闭。150 项 JVM 单测和 5 项定向模拟器检查通过，涵盖首次 503 后延迟 11 秒的目录恢复、模型缓存与默认 high、文件慢响应/失败/重试、运行中加入队列及控制台模型设置。截图为测试数据：[模型恢复](../artifacts/native-model-list-recovered-0.6.121.png)、[文件等待](../artifacts/native-file-slow-network-0.6.121.png)、[失败重试](../artifacts/native-file-network-error-0.6.121.png)。最终 Release 构建通过，versionCode 144，2,456,176 字节，SHA-256 `F818580D72AF030432713DEC9EDDA3D20A3597FE9DB72BBC4E98FA83CA6951F8`。仓库、安装网关及局域网 HTTPS 下载内容一致；覆盖安装后冷启动 1.634 秒，无 AndroidRuntime 错误。公网入口的 APK 下载仍受既有白名单限制，返回 404；可使用仓库交付包或局域网入口。实体 S23 需覆盖安装本版后复核。

0.6.120：沿用 ZCode 会话交付的 AGY 权限说明、图片拦截和累计界面修改。2026-09-30 已继续更新运行网关，AGY 支持现有配对设备的公网启动、续接和队列；历史接口回传会话模型与推理强度，客户端现有选择器会自动恢复。此次后续修复只改网关，使用现有 0.6.120 APK；真实 CLI 与公网验证结果见 [当前状态](work-status.md)。

0.6.119：输入框旁的“引导”文字替换为转向箭头图标，保留点击操作、触觉反馈与可访问性说明。既有“空队列下从输入框调整桌面运行轮次”模拟器测试通过，[截图](../artifacts/native-composer-steer-icon-0.6.119.png)已核对。Debug、测试 APK 与 Release 构建通过；Release（versionCode 142）已在模拟器覆盖安装并冷启动，主页显示正常、进程存活，未捕获崩溃日志。仓库与安装网关下载入口同步，实际下载 HTTP 200 且文件一致；实体 S23 显示待复核。

0.6.118：重排电脑控制台统计页。顶部改为等宽分页，来源与日期筛选收紧；Token 总览使用主数值与两列分项，趋势、参考金额、日志活动和模型用量分别呈现。每日图补齐刻度与日期，限制单日柱宽，点击后突出选中日期；模型按用量排序并显示占比，长名称换行且与数值保持间距。保留原有数据口径、计价切换、筛选、刷新和索引操作。150 项 JVM 单测、3 项控制台交互回归和 2 项布局测试通过；浅色 1.3 倍字体、深色 1.5 倍字体及 30/365 日趋势已核对。布局预览使用测试数据：[浅色总览](../artifacts/native-console-overview-118.png)、[每日趋势](../artifacts/native-console-trend-118.png)、[模型用量](../artifacts/native-console-model-usage-118.png)、[深色总览](../artifacts/native-console-dark-overview-118.png)、[深色趋势](../artifacts/native-console-dark-trend-118.png)。Release（versionCode 141）已在模拟器覆盖安装并冷启动，主页显示正常、进程存活，未捕获崩溃日志；仓库与安装网关下载入口已同步，实际下载 HTTP 200 且文件一致。实体 S23 的显示与触控体验待复核。

0.6.117：任务通知显示完成/中断/失败状态、会话名称和本轮最终答复摘要。根据当前轮次取文，历史尚未写完时使用实时答复；保留结束事件之后到达的失败原因。重复结束事件和重连回放不重复提醒，已提醒的事件在服务重启后仍去重；同一会话的新结果替换旧通知，旧版“新对话”等错误通知在启动后清除。150 项 JVM 单测与 2 项通知模拟器测试通过，涵盖系统通知内容、重复事件的发出时间、服务重启及冷连接打开对应会话。Release（versionCode 140）包含 0.6.116 的全部控制台功能；模拟器覆盖安装并冷启动后主页显示正常、进程存活，未捕获 AndroidRuntime 错误。实体 S23 的通知与使用体验待复核。

0.6.116：会话菜单和侧栏新增“电脑控制台”，通过现有配对网关接入本机 25819 服务。统计页按 Codex、AGY、Claude、ZCode、Grok 和今天/本周/本月/今年筛选，显示 Token、参考金额、每日交互图与模型明细；Codex 另有日志活跃分钟和工具调用。模型页支持检查官方更新、重建目录、搜索、启用/隐藏与设置电脑默认模型，操作后刷新 App 模型列表。服务页显示启动以来的转发计数和内存。真实服务五种统计来源、官方更新检查、本机公网转发入口的设备签名检查通过；服务端 26 项定向回归、公网 4 项检查、网关 smoke、Android 139 项 JVM 单测与 3 项模拟器交互通过。实体 S23 的显示与外网使用仍待验。

0.6.115：侧栏开合前按键盘状态处理焦点和 IME，侧栏在状态栏下方显示上下对称圆角；加号和右上菜单再次点击可关闭，弹层外点击不会让菜单马上弹回；输入框收紧行高。4 项定向模拟器交互、Android JVM 单测、Release 构建通过。模拟器在 1.3 倍字体下冷启动 Debug 版有短暂白屏和大量跳帧，随后正常显示，未捕获 AndroidRuntime 崩溃；Release 安装后冷启动正常。实体 S23 体验尚未核对。

0.6.112：同一消息的图片预览改为两张图随手势并列移动；松手后先完成剩余滑动，再更新当前图片，短拖则平滑回位。模拟器定向检查中途同屏、正反向切换、短拖回位、缩放复位和下拉关闭通过；Release 已安装模拟器并同步下载入口，实体 S23 的动画手感待核对。本版没有修改网关或网页版代码。

0.6.111：“编辑文件／查看改动”从聊天内的短滚动框移到独立补丁阅读页，显示文件路径、增删数量和逐行颜色；工作台“改动”列表也可进入该页。网关传递 App Server 文件变更中的补丁，并从 Codex 历史的 `apply_patch` 调用提取补丁；网页活动记录对本次补丁显示独立查看入口，只有无历史补丁时才明确标为“查看当前工作区”。Android 编译、单测和补丁阅读模拟器测试通过，截图见 `artifacts/native-change-detail-0.6.111.png`；网关 21 项定向测试通过，当前会话真实历史取到 125 条补丁事件。Release 已安装模拟器并启动，安装网关及下载入口已同步。完整网页 smoke 两次未通过，分别停在活动展开可见性与底部跟随的异步断言；实体 S23 尚未核对。本版继承 0.6.110 的空队列引导与同消息图片左右切换。

0.6.110：桌面版启动的 Codex 轮次运行时，手机输入框有内容即可点“引导”，无需先制造待发项；队列为空时网关仍返回轮次可引导状态。公网已认证手机也可引导网关从桌面历史识别出的活动轮次，实际 `turn/steer` 仍由 App Server 校验目标轮次。引导请求先可靠入队再转为引导；转发失败时消息留在队列，不会自动重复提交。单条消息内的图片预览支持左右切换，保留缩放和下拉关闭。Android 编译、单测及 4 项定向模拟器交互通过；网关构建与队列、历史检查通过。Release 已构建并同步下载入口，网关只更新变动的 `index.js`，本机实时接口在队列为空且桌面轮次运行时返回 `canSteer=true`。实体 S23 与公网实机引导待核对。

0.6.109：最新完整回答的菜单补上“重试”，重新发送与该回答关联的提问；更早的回答、运行中回答和无法完整重传的桌面附件不显示此项。重试保留输入框草稿，不撤销旧轮次或其文件改动。Android Debug 编译、单测及针对性模拟器交互通过，Release 已在模拟器安装启动，安装网关下载入口已同步并核对哈希；实体 S23 待核对。

0.6.108：输入框占位文字改由 `BasicTextField` 的装饰布局绘制，与光标共用起点和行高；完成的回答只在整轮结束后显示复制与回复菜单，菜单提供复制、选择文本和分享，运行中的回答不显示这些操作。Android Debug 编译、单测与 2 项针对性模拟器交互通过，光标和菜单截图已核对。Release 在模拟器安装启动；APK 下载入口已同步并返回 HTTP 200、字节哈希一致。实体 S23 键盘与菜单手感待核对。

0.6.107：浅色气泡、输入框和侧栏选中态改为中性层次，移除气泡与输入框的显眼描边；OLED 黑底保持纯黑。用户消息长按菜单跟随气泡定位，并增加独立的 20dp 屏幕边距。模型选择弹层固定外壳，仅内部模型列表滚动。网关合并桌面历史时，已保存的上传图片不再与同条消息的嵌入式副本重复显示。Android Debug 编译与单测、相关 3 项模拟器交互、Web 49 项回归和历史合并 3 项单测通过；Release 已在模拟器安装启动，安装网关与下载入口已同步。实体 S23 观感及单图真实发送仍待用户核对。

0.6.106：核对手机端顶栏、侧栏、命令、消息与待发队列、目标、工作区、图片和 PDF 预览的图标；用一致的 Lucide 线条图标替换语义错配及混用的 Material 图标，移除未使用的 Material 扩展图标依赖。顶栏移除重复的新会话按钮，保留侧栏和 `/new`；上下文圆环缩小。网页版移动顶栏同步移除重复的新会话按钮，操作菜单的置顶、重命名、引导等图标按操作重新映射。Android Debug 单测与 3 项模拟器流程、Web 49 项回归、Release 构建和模拟器启动通过；APK 与网页版静态资源已同步到安装网关并按实时接口核对哈希。实体手机仍待验收。

0.6.105：`/` 命令列表改成图标、等宽命令名与单行说明的紧凑布局，帮助面板同步；新增可执行的 `/pin` 和 `/effort`，`/new` 沿用当前项目。绘图和桌面宠物没有已核实的手机操作入口，因此不显示空命令。Android 模拟器新增两项命令流程检查，原有两项命令回归通过。

0.6.104：侧栏分组标题的展开箭头改为短时旋转；输入框发送、停止和处理中图标使用 120ms 状态过渡，按钮底色使用绘制层颜色过渡。用户已在手机实测暂停和停止可用，本版不改这两条控制路径。

0.6.103：目标卡片展开时移除会盖住圆角背景的整块按压底色，改用轻微缩放反馈；“关闭目标”仍只在展开后显示。

0.6.102：项目、会话目标和处理过程的箭头动画，以及发送按钮、审批按钮和运行状态闪动，改为在绘制层读取动画进度；图片预览高清图淡入也沿用这一方式，减少动画帧触发整行文字重组。模拟器帧耗时波动较大，实体手机流畅度仍需实测。

0.6.101：上滑加载旧记录时，把上滑意图保持到惯性滚动最后一帧；分页请求完成后可再次上滑加载，避免旧记录入口偶尔停在手动按钮。

0.6.100：临时截图被系统清理后，网关可从会话记录中的原始图片恢复；手机对短时读取失败自动重试并显示失败原因。三列表格在手机宽度内换行排版；图片预览加载高清图时保持画面位置并淡入。0.6.99 的侧栏项目展开性能优化仍保留。

0.6.96：长工具分组展开后，明细交由聊天列表按可见范围创建，并以稳定标识保持滚动位置；可见明细短暂淡入。120 条工具记录的模拟器基线一次创建 120 条，改后回归限制同时创建少于 24 条，并验证首尾可达、会话折叠及历史位置。

0.6.95：点击“回到最新”后先完成滚动动画，再恢复新消息自动跟随，避免跟随逻辑抢滚动。Android 12 模拟器验证中间帧、回底后续跟随及旧消息阅读位置。

0.6.94：会话目标条常显“关闭”文字按钮；底部弹层的标题区域可下拉关闭。Android 12 模拟器验证目标结束与弹层手势。

0.6.91：最后一条消息完整可见时即隐藏「回到最新」，不再要求滑过列表尾部的占位空白。安卓模拟器验证阅读位置、长回复跟随和回底动画。

0.6.90：会话目标条右侧显示「关闭」，点击后结束并收起当前目标。

0.6.89：弹出菜单限制最大高度，较长菜单在原位置滚动，保留 48dp 触控项和顶部按钮二次点击关闭。Android 12 模拟器验证菜单末项可达、模型与附件等相邻流程。

0.6.88：图片预览支持短距离快速下滑关闭，慢拖使用弹簧回位；缩放手势会清除下滑关闭判定。Android 12 模拟器验证了预览、缩放、保存、慢拖回位和快速关闭。

0.6.87：自动跟随消息时改为下一次布局定位，避免列表测量期间同步滚动造成崩溃。Android 12 模拟器完整 63 项原生交互回归通过。

0.6.86：实时事件被历史记录替换时，保留可唯一匹配的消息显示标识，避免已展开的处理过程重新折叠和列表位置跳动；重复文本不作模糊匹配。Android 12 模拟器回归覆盖历史替换、旧记录加载和轮询期间阅读位置。

0.6.85：项目会话页在 30 秒内重复展开时复用已加载结果，避免相同请求和侧栏状态刷新；“加载更多”仍可继续分页。模拟器回归验证了重复展开不重新请求和项目分页。

0.6.84：图片预览下拉时的背景淡出改在绘制阶段更新，工具栏只在显示状态跨过阈值时重新组合；模拟器验证预览缩放、保存、下拉关闭和“回到最新”的中间滚动位置。

0.6.83：实时消息转为历史记录时使用稳定的 Codex 项目 ID 保留列表行身份；目标栏的关闭按钮随新版安装包提供。模拟器验证了目标关闭、历史分页及刷新后阅读位置。

0.6.82：关闭会话目标时，目标栏平滑收起；退出动画期间保留栏内原有内容，避免目标数据清除后留下空白动画。模拟器目标操作流程回归通过。

0.6.81：给侧栏动态区块标题分配稳定的列表标识。分页新增项目时，正在阅读的“最近会话”标题可维持视口位置；模拟器回归覆盖项目从 5 个增加到 10 个。

0.6.80：斜杠命令建议改为输入框上方的紧凑浮层，不再随输入展开聊天布局；保持键盘焦点，并缩短命令行高度。模拟器复现了旧版输入 `/` 时聊天视口被挤动，修复后视口位置保持不变。

0.6.79：会话目标条改用明确的关闭图标，点击后结束目标并立即从当前会话和侧栏移除。侧栏展开项目时按可见范围创建会话行，避免一次创建全部已加载会话。

0.6.78：图片全屏预览在缩略图切换为高清图时保留正在进行的手势；手指拖到一半再收到高清图，仍可继续下拉关闭。模拟器用延迟高清图响应做了修复前失败、修复后通过的对照，并回归缩放、保存与普通下拉关闭。

0.6.77：会话目标条直接显示“关闭”，点击后结束目标并从目标条和“进行中”侧栏移除。网页版目标条也提供同一入口。

0.6.76：聊天列表中的 Markdown `AndroidView` 启用底层 TextView 复用，换行时清理旧文本、标记和横向滚动位置。往返滑动诊断取代触顶后仍持续采样的旧脚本；60 Hz 模拟器在修改前 p95 为 76.0 ms，修改后两次为 66.7 / 79.5 ms，波动较大，尚不能据此断言帧耗时改善。链接、深色主题与阅读位置回归通过。

0.6.75：聊天列表的可见行只在消息或折叠状态变化时重算，输入草稿等无关界面更新不再重新遍历整段历史。模拟器的输入、展开与分页位置回归通过。当时的滑动采样 p95 为 42.6 ms；后续发现脚本触顶后仍计入手势帧，不能用该数值评价连续滚动。

0.6.74：长流式回复的相邻片段改为累积后一次合并，避免每个片段重复复制整段已生成文本；1500 段回归核对文本与首段消息 ID，完成回合时的阅读位置模拟器测试通过。

0.6.73：运行中的回合完成时保留原有步骤位置，在结论后提供“收起处理过程”；手动折叠与再次展开不会被后续消息覆盖，切换会话后仍保留。模拟器复现过完成事件使可见步骤下移 144 px，修改后该位置保持不变。

0.6.72：聊天中的普通 Markdown 使用按会话、主题区分的有界解析缓存；同一段回复滑出屏幕后返回时复用已解析的文字和链接，不重复在主线程解析。模拟器中的链接、富文本与缓存回归通过。

0.6.71：目标栏右侧改为常驻关闭按钮，点按会将目标标记为完成；目标栏与侧栏中的目标文字随即消失，仍在运行的会话继续显示。支持高刷新率的屏幕在应用前台时请求当前分辨率下的最高刷新率；系统仍决定实际采用的刷新率。

0.6.70：历史消息中的图片缩略图使用有 16 MiB 上限的内存缓存，滑出屏幕后再返回不会重复下载和解码；重新连接或断开时清空缓存。保留原图按需预览。项目侧栏的展开性能对比未改善，维持原有实现。

0.6.69：目标栏始终显示“结束”按钮。点按会将当前会话目标标记为完成并同步到电脑，目标栏随即收起。

0.6.68：“回到最新”按钮仅在用户离开最新消息后显示，并用短时淡入缩放过渡；自动跟随回复时不再短暂闪现按钮。新增上拉分页期间逐帧采样可见消息位置的回归测试。

0.6.67：已完成的长处理过程展开后，按屏幕可见范围加载每条消息；收起仍保留原有状态和箭头反馈。50 段回归用例中，旧实现同时创建 50 条正文视图，新实现只创建屏幕附近的内容，并验证追加消息后展开状态不丢失。

0.6.66：在浏览旧消息时发送新消息，聊天页会回到最新并继续跟随后续回复；普通阅读、分页和手动展开仍保留当前位置。

0.6.65：侧栏项目展开与收起改为短时过渡，减少长列表反复动画的帧数；项目会话行以会话 ID 绑定本地状态。加入连续手势滚动和侧栏展开的帧采样测试。

0.6.64：手机目标栏的关闭按钮会结束当前会话目标，并同步到电脑；展开目标栏或打开“会话目标”也能点“结束目标”。网页端同步提供结束入口。

0.6.63：上下文圆环的已用部分与轨道拉开对比；旧记录插入时在同一轮列表测量中保持当前消息位置，加载按钮在固定高度内淡入切换。斜杠命令面板缩紧，单张待发图与已发送图分别限制为小尺寸方形缩略图，三张图的最后一张也不放大。目标栏曾支持仅在手机隐藏，现已由 0.6.64 的结束目标操作取代。Compose 依赖升级到 1.7.8。

0.6.62：会话状态里的 Windows 目录从盘符开始显示，移除仅供系统使用的扩展路径前缀；上下文、用量和目标预算中的 Token 数采用千、万、M 等紧凑单位。底层路径与原始统计值不变。

0.6.61：图片预览按图片实际显示尺寸计算缩放与平移边界；双击缩放带过渡，原尺寸时下拉可关闭，未达到关闭距离则回位。PDF 改为连续滚动页面，滚动到可见页面时按需渲染，顶部显示当前页并保留缩放和保存，不再靠上一页/下一页按钮翻页。顶部上下文入口为小型黑色圆环，用户气泡的点击反馈与圆角共用裁剪区域。

0.6.60：发送前及已发送消息统一把图片缩略图放在文字气泡上方；单张为方形，多张两列铺满，点开查看大图。历史同步会把较晚到达的图片附件重新并入对应消息，避免图片偶尔消失。顶部上下文圆环可直接进入“上下文与状态”，显示当前使用比例和 Token；打开状态不清空输入草稿。运行中及非最终回复不显示逐段复制，长按用户气泡显示紧凑操作菜单。命令列表使用等宽字体，补充 `/usage`、`/model`、`/permissions`、`/new`，右上菜单打开时切换为关闭图标。

0.6.59：侧栏首批加载 10 条最近会话、5 个最近项目，点击加载更多追加同样数量；展开项目才读取项目内的首批会话。置顶和当前项保留入口，搜索覆盖未加载记录。手动回到底部后恢复跟随，正文后续增长继续保持最新位置。

0.6.36：加载更早记录时以当前可见消息及其位置为参照，旧记录接在上方；分页按钮消失后仍保持原阅读位置。网页加载历史不再插入整屏骨架。

0.6.35：上滑阅读后不再因滚动布局事件重新启用自动跟随；点击“回到最新”恢复跟随。保留阅读中完成轮次的展开位置，修正存在历史分页按钮时的底部索引。

入口是 `MainActivity`、`NativeScreen` 和 `NativeViewModel`。聊天列表、侧栏、输入框、模型与强度弹层、图片、待发队列、审批和文件/终端面板使用原生 Compose；Markdown 与公式使用 TextView、Markwon 和 JLaTeXMath。APK 不再打包 console 网页资源。

输入栏的加号可选择照片、视频或其他文件，单文件上限 100 MB，每条消息最多 8 个文件。文件上传后保存在电脑网关，发送时把受控本机路径交给所选助手读取；这不代表模型协议直接理解视频。消息里的文件可重新下载，视频交给手机已安装的播放器打开，PDF 和 5 MB 以内的 Markdown 使用应用内阅读器。运行中向上阅读会暂停自动滚动，回到最新按钮恢复跟随；思考强度在拖动结束后保存。

0.6.25：在手机“连接电脑”中点“扫描电脑二维码”，可填入内网地址、证书指纹、一次性配对码和公网地址；也可用系统相机扫描。扫码使用 Google Play 服务提供的扫码界面，首次使用时可能下载扫码模块。公网独立密码可在电脑内网网页版“设置 → 公网连接”修改，并在手机中单独填写；现有密码也保存在本机 `~/.codex-mobile-control/public-password.txt`。

0.6.35：处理过程按时间分段，摘要显示在折叠栏标题，上下文压缩单独可见；历史命令展示实际指令，会话标题过滤自动任务控制标签。通知点击进入对应会话（含冷启动连接后跳转），后台监听支持内网失败后回退到公网；图片支持双击缩放，发送和审批按钮带按压反馈，侧栏列表调整位置时平滑移动。

0.6.26：一轮任务的思考摘要、命令、文件改动、图片查看、计划和上下文压缩归入同一个可展开的“处理过程”；标题不显示 Markdown 记号，重复活动合并。内网网关使用 HTTPS 和证书指纹，手机在 Android KeyStore 生成独立签名密钥。手机优先使用内网，连接失败才改用公网。公网不提供网页版和终端。

0.6.17：开启自动处理后，Codex 的命令、文件和权限审批由网关直接接受，成功时不再弹出人工审批；提问仍需回答。

0.6.16：安卓顶栏只显示会话标题；运行和连接状态以小标记呈现，点状态点可查看错误。思考与工具执行记录收成可展开短行，目标卡片可编辑、暂停和继续。长会话先取最近 60 条事件，上拉再取更早记录；侧栏长按会话可改名或置顶并同步至 Codex。三星设备优先请求三星相册和三星文件应用处理附件选择，找不到处理入口时回退系统选择器。三星真机上的选择器行为仍需实测。

0.6.15：同一条用户消息的图片、文件和文字显示在一个气泡内，多张图片以两列缩略图排列，点开可看大图。待发队列收紧为单行。历史会话的运行状态按最新任务生命周期校正；桌面 Codex 审批通过共享连接转发到网页和安卓，设置里可选择自动处理桌面审批，默认关闭，提问仍需人工回答。桌面共享组件更新后需重开 Codex 才能启用审批转发。

0.6.14：目标移到输入框上方，点开可查看完整目标、状态与已用 Token。长时间运行的大量工具日志不会再把用户消息和回复挤出历史接口；网页与安卓统一保留最近对话及执行摘要。

0.6.13：网关收到的审批与提问在安卓端主动弹出。桌面 Codex 工具层的权限请求会显示电脑端处理提示，手机端不提供无法生效的批准按钮；请求完成后提示自动消失。

0.6.12：同一桌面会话续接到新 rollout 文件后，网关按时间合并最近历史，不再停在旧文件；隐藏桌面中断标记和自动附带的浏览器上下文。运行中输入文字时停止操作固定在状态栏，模型选择器不再被挤压。46 项网页回归、服务端 smoke、Android 单测和 16 项 Android 12 原生模拟器测试通过；安装版网关和 APK 下载路径已更新，实体手机尚未验证。

0.6.11：侧栏显示“进行中”会话与活动目标，点开会话可查看目标文字和状态；目标数据只从电脑端 Codex 数据库读取。网页和原生 Android 共用网关返回的目标状态。46 项网页回归、16 项 Android 12 模拟器测试通过；安装版网关已更新，真实接口返回 3 个运行中的会话。新版 APK 已在模拟器安装启动，实体手机尚未验证。

0.6.10：待发消息编辑直接撤回输入框，文字、图片和文件可修改后重发；短消息不显示独立复制按钮。45 项网页回归、TypeScript 构建和 15 项 Android 12 模拟器测试通过。网页资源与 APK 已同步到运行中的网关；实体手机尚未验证。

0.6.9 验证：45 项网页回归、TypeScript 构建、Android APK 构建、14 项 Android 12 模拟器测试通过；网关实际更新后，文件上传与视频分段读取接口通过本机请求。

## 使用

1. 已由电脑 Local Console 安装网关的用户，先双击仓库根目录 `更新电脑网关.cmd`。脚本检查执行中的任务、备份旧程序、构建并同步安装目录，再重启对应网关；不替换用户配置或会话数据。
2. 双击 `打开电脑控制台.cmd`，获取手机可访问的电脑地址和配对码。
3. 安装 [Codex-Control-0.6.116.apk](../artifacts/Codex-Control-0.6.116.apk)，或在手机浏览器打开电脑控制台显示的局域网 HTTPS 地址加 `/downloads/android.apk` 下载。扫描电脑控制台的二维码完成配对，证书指纹和公网地址会自动填写；再填入本机保存的公网独立密码以启用外网回退。

新会话可以不选择项目。模型及思考强度位于同一个弹层，强度按模型保存。顶部 Codex 和新建按钮都能进入新会话。

0.5.0 统一白灰输入区、紧凑顶栏、底部操作面板和会话列表；首页标题与输入区集中呈现，图片可点开全屏查看、缩放和复位，代码块可独立复制，宽表和公式可横向阅读。模型列表默认折叠，点击当前模型展开搜索，思考强度保留在同一弹层；输入工具栏为停止和发送按钮保留空间。多图按批次上传，全部完成前禁止发送，超过 8 张直接提示，切换会话后不把旧上传结果加入新会话。

2026-09-26：116 项 JVM 单测通过；7 项 Android 12 模拟器交互测试在常规及 320dp 窄屏通过。覆盖批量上传锁定、会话切换隔离、按钮边界、公式、代码复制与宽表横滚。安装包为调试签名，未做实体手机验证。

## 执行与消息队列

当前会话执行时，输入消息后发送会进入电脑端持久队列。待发项可以编辑或取消，正常完成后按顺序执行。上一轮失败或中断时暂停队列，用户可重试。连接中断时尚未确定是否提交成功的消息不会自动重发。

“改为引导”使用 `turn/steer`。手机输入框中的内容可直接引导当前可识别的活动 turn，待发队列项也可改为引导；计划和快速模式消息仍等待下一轮。通过共享启动入口连接桌面进程后，两端使用原任务及其活动 turn。协议依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server?translationFallback=zh-Hans)。

网页和安卓只展示公开推理摘要、工具活动与任务状态。历史读取排除内部指令和分析内容，将远程附件包装还原为实际提问及图片附件。共享连接使用 WebSocket 接收执行更新；历史读取用于恢复消息。

## 构建与检查

使用 JDK 17 或兼容版本、Android SDK 35、Gradle 8.10.2。应用最低 Android 8，当前 targetSdk 31。交付使用 Release + R8 + 资源压缩，沿用既有本地签名以兼容覆盖安装；Debug 包只用于开发和仪器测试。

```powershell
cd android
.\gradlew.bat :app:assembleRelease :app:assembleDebug :app:testDebugUnitTest
.\gradlew.bat :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.localcodex.control.NativeFlowTest
```

交付文件位于 `app/build/outputs/apk/release/app-release.apk`。不要将 `app-debug.apk` 用作性能交付包。仅关闭不适用于直接分发的 Google Play 目标 API 发布政策检查；其他 Release Lint 保持启用。

`NativeFlowTest` 使用模拟器与隔离协议夹具，检查发送、队列操作、模型面板、新建会话、长历史刷新、输入时滚动位置、重连及图片/公式。测试还检查当前界面层级中没有 WebView。旧 WebView 的 CDP 脚本保留作历史版本验证，不能作为本版本的验收依据。

文件链接经网关授权下载。PDF 在应用内预览并可保存；Markdown 文件在应用内阅读、查看源码并可另存；其他文件通过 FileProvider 交给手机文件查看器或保存应用。文件编辑、diff 和终端是原生面板；网页开发预览仍可在网页版使用。尚未完成实体手机验证。

## 0.5.8

侧栏和会话菜单新增“用量与配额”，显示当前账号的额度窗口、剩余比例、重置时间，以及当前会话的输入、缓存、输出、推理、最近请求 Token 和上下文上限。趋势图默认显示今天，把 5 小时与 1 周额度放在同一时间轴上；网关只读取当前账号的真实历史采样，断档不连线，缺失的额度窗口显示“暂无数据”。需要同步更新电脑网关。实时额度失败时复用电脑控制台的当前账号记录，并展示记录时间；未知值不显示为零。

连续思考与执行记录合并折叠，消息增加复制反馈，运行时按钮明确区分加入队列与停止。置顶会话独立分组，搜索不受最近会话折叠影响。弹层增加进入动画和键盘避让。设计来源与本轮验证边界见 [交互对照](interaction-review.md)。

## 0.5.7

`Install-DesktopBridge.ps1` 安装共享组件并保存用户级 CLI 路径设置。安装后正常重开一次 Codex，以后从原来的图标启动即可自动共享。桌面和网关连接同一个本地认证 WebSocket 服务，保留原任务 ID、历史和待发队列；网关断开不会结束桌面服务。

桥接每次启动优先选择当前已安装桌面包的 `app/resources` 完整执行组件，再回退到完整的本地 CLI 缓存。不会选取正在解包的临时目录或缺少执行辅助程序的旧缓存，避免桌面更新后出现 `codex-code-mode-host.exe` 缺失。

该集成已在当前安装的 CLI 上用两个连接验证；实际桌面软件需重启后验证默认入口。若桌面未连接，网关等待重连并保留会话。

## 0.5.5

桌面历史中的 `<image ...>` 标记与文件列表会合并为去重的图片附件；网页及原生安卓通过同一受限接口直接显示图片。桌面版进程空闲但仍持有会话 writer 时，待发队列现在说明真实占用原因，不再误称仍有任务执行。网关与桌面版使用不同 app-server 进程，不能通过重试夺取桌面进程正在持有的写入权；队列仅在它实际释放后发送。

## 0.5.4

聊天输出链接和项目文件列表里的 PDF 使用 Android PdfRenderer 原生预览，支持翻页、缩放与保存原文件；文件按流写入应用缓存，单个 PDF 上限 100 MB。网页继续使用 PDF.js，修正了窄屏控制栏布局和文本预览的换行样式。

Chrome 网页回归 39 项通过；Android 12 模拟器原生流程中原有 10 项通过，新增的真实两页 PDF 预览、翻页和缩放测试也通过。APK 已在模拟器安装并核对 versionCode 18；实体手机仍待验证。

## 0.5.3

聊天中的 Markdown 文件链接在原生 TextView 上启用实际点击回调，手机可通过授权项目下载并打开输出文件。APK 使用明确的安装包 MIME；网关另提供固定的局域网下载路径 `/downloads/android.apk`，免于把 Windows 本地路径当手机链接。

桌面或其他客户端暂持有同一任务写入权时，网关把消息持久入队，返回排队回执；客户端显示队列状态。后台保留原消息、图片、模型与权限设置，按间隔重试，写入权释放后发送。不能对另一个进程的活动 turn 强行引导，也不会把排队消息标记为已完成。

## 0.5.2

原生侧栏的“项目”“最近会话”和各项目可折叠，展开状态保存。连接先建立实时通道，再异步读取项目与任务列表；打开会话优先获取历史和队列，避免被侧栏读取阻塞。轮询与首次加载共享单次历史请求，切换任务时丢弃过期结果。

模型、思考强度和执行权限按会话保存；新会话继承最近的全局选择。权限可选“询问 / 自动审批 / 完全访问”，默认完全访问，并随发送和队列项传给网关。writer 冲突不抢占其他客户端；未发送消息保留在输入框，队列项保留失败原因供重试。

本轮 38 项网页回归、网关 smoke、原生 9 项 Android 12 模拟器测试通过，APK 为 versionCode 16。完整旧安卓 instrumentation 集还包含针对不再使用的 LegacyControlScreen 的测试，运行时有 8 项旧界面断言失败；当前入口的 NativeFlowTest 已单独通过。实体手机未验证。

## 0.5.1

两端支持浅色、深色与跟随系统，选择自动保存。网页入口是“设置 → 外观”，安卓是顶部“会话菜单 → 外观”。原生正文、公式、代码与表格使用主题颜色。图片全屏预览新增保存按钮，通过系统文档选择器选定位置后下载原文件，不使用预览缩略图重新编码。

本轮 38 项网页回归、116 项 JVM 单测、8 项 Android 12 模拟器交互测试通过。图片保存测试由 ActivityResultRegistry 返回测试目标 URI，核对实际写出的原始字节；没有把模拟文件选择结果当成实体手机验证。已检查网页和安卓深色截图。

## 0.6.0：独立助手工作区

侧栏顶部切换 Codex、Claude Code、Antigravity、Grok Build。每个助手单独保存模型、强度、权限和草稿；切换时恢复自己的会话，会话列表、队列和用量按助手区分。模型弹层只列当前助手模型，服务端拒绝把原会话交给另一个助手。

新增的三个 CLI 接入均已完成真实首轮发送和原 session 第二轮续聊检查。Claude 使用 stream-json，Antigravity 使用 headless stream-json，Grok Build 使用 ACP。只显示公开输出与工具进度，不读取内部推理。当前只接续由本客户端创建的外部助手会话，尚未导入它们各自桌面端的全部历史。

CLI 能力保留实际边界：Antigravity 当前 stream 输入只接受文本，图片会明确拒绝；其 headless 询问模式尚无手机交互审批。Claude 和 Grok 已接审批协议，但真实审批与图片交互尚未设备验证。外部助手未提供的配额或 Token 显示缺失状态，不套用 Codex 数据。

验证：42 项网页回归、4 项助手协议/会话测试、网关 smoke、118 项 Android JVM 单测通过。Chrome 在 320/390/1440 宽度验证四工作区、独立草稿、模型记忆和刷新恢复，无页面异常或溢出。Android APK 和 instrumentation 编译通过；本轮没有连接设备，未运行设备交互测试。

运行中的安装版网关未重启。静态网页和 APK 可以直接更新；新后端由项目根目录“更新电脑网关.cmd”在无执行任务时更新。仅刷新旧网关网页不会启用新增 CLI。

## 0.6.2：聊天布局收紧

桌面会话标题与工具合并到 52px 顶栏；缩小消息间距、操作区上边距和输入框留白，保留 16px 正文。手机网页顶栏缩至 52px（另加安全区）；原生安卓顶栏 52dp，消息间距 12dp。侧栏、折叠栏和新会话首页使用当前助手品牌图标，切换时同步更新。

## 0.6.4：桌面删除同步

桌面会话数据库成功读取后，以其中的有效记录为准，旧网关缓存和旧 session_index 不再复活已删除的 Codex 会话。数据库不可读时保留缓存；新建会话提供两分钟索引宽限，网关当前承载的任务和其他 harness 不受该过滤影响。网页和安卓列表刷新发现当前会话已消失后回到新会话，保留原草稿。只调整网关展示，不修改桌面数据库或会话原文件。

专项测试覆盖删除、索引残留、数据库不可读、新建宽限、活动任务和外部助手保留。实机网关已核验默认工作区的会话 01a0ddf6-ca2f-7cf2-b554-8c0b151604f3 不再返回。安卓构建通过，设备交互未验证。

模型按钮去除固定档位的重复文本，无可调档位时隐藏思考滑条。0.6.5 移除已发送消息的“再次编辑”入口；消息保留复制，尚未发送的队列消息继续支持编辑。

0.6.6：助手图标统一浅灰，Codex 改为描边。Codex 增加读取 config.toml 的自定义权限；支持选择/自由文本问题卡片、显式提交和跨端处理状态同步。命令、文件、权限审批保留允许/拒绝，权限请求展示具体范围。

0.6.7：仅首页欢迎图标使用浅灰；侧栏与助手选择器恢复跟随主题的正文颜色，Codex 保留描边。

## 0.6.34 体验修订

- 移除历史骨架屏下方重复的转圈；骨架使用浅色慢速呼吸，消息入场改为缓入缓出。
- 子操作与摘要栏左侧对齐，移除额外缩进；图片查看操作展示可点击图片，混合命令与图片调用保留两类说明。
- 历史、审批、队列并行请求；连接成功复用网络客户端；手机缓存 Android Keystore 密钥句柄，服务器缓存解析后的证书。每次请求仍签名、检查证书有效期及防重放。
- 本机旧网关热读取测量：健康 1ms，模型 12ms，ICONIP 最近记录 7ms，审批 7ms，队列 6ms。该测量不代表手机网络耗时，也不构成优化前后速度对比。
