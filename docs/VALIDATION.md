# 当前验收记录

日期 2026-10-07，版本 0.5.2。0.5.1 的整理结论保留在 docs/evidence 下的证据文件，那些文件记录改动前的构建（7,087,114 字节），不再代表当前产物。

## 本次改动（0.5.1 → 0.5.2）

- 构建内嵌资源的 MIME 按扩展名判定（webp / m4a / flac），不再把 FLAC 一律标成 audio/mp4；遇到未知扩展名直接报错。运行时代码未变，codeBytes 仍为 34,300。
- catalog.json 增加 characters.source、characters.sourceSha256 与 characters.sourceBytes，人物源图哈希现在可自证。
- 人物提取改成显式帧清单，不再要求源图连通分量恰好为 8；仍只产出 uniform idle 一张，源图保留全部精灵。
- 重新执行 npm run prepare:assets：27 项运行素材逐字节与改动前一致，合计 5,259,814 字节，分析文件未变，catalog.json 只增加人物源图字段。

## 已验证（0.5.2）

- npm test：14 项通过，涵盖拍点与相位、循环半拍对齐、同格替换、旧队列清理、设置校验、语音裁切起音和稀疏光线。
- npm run build：单 HTML 生成成功，7,087,291 字节；gzip 测量 5,085,256 字节，不代表文件本身大小。连续两次构建 SHA-256 一致（0495e3a4…），构建可复现。
- 27 项内嵌资源哈希与 catalog 一致；25 条语音源文件、音乐源 WAV 与人物源 PNG 的哈希独立核验通过。
- 自包含检查：无外部 src/href、无 fetch/XHR/WebSocket、无 @import、无 CSS 外链；唯一的 http 串是 favicon 内联 SVG 的命名空间。
- GitHub Pages 线上部署核验：站点根返回 200（870 字节，含指向 ./dist/game.html 的相对跳转与兜底链接），`dist/game.html` 返回 200、Content-Length 7,087,291，SHA-256 与本地构建完全一致（0495e3a4…）。这只证明线上产物与本地构建字节相同，不替代浏览器试玩。

## 尚未覆盖

- **0.5.2 尚未重跑浏览器验收。** 0.5.1 的双入口结论（file:// 与本地 HTTP、25 条语音解码、同格合并、横竖屏、故障恢复）见 docs/evidence/browser-summary.json，对应的是改动前的 7,087,114 字节构建。本次改动只影响内嵌资源的 MIME 字符串与 catalog 字段，未触及运行时代码，但在重跑 npm run test:browser 之前不应把该结论算作 0.5.2 的。
- 真人混听、逐条裁切听感、循环接缝、实体触屏设备、Safari/Firefox 和其他系统尚未验收。自动化浏览器采用静音运行，但音频信号与解码由程序检查，不能代替真人听感判断。

## 复现

在仓库根目录执行 README 中的安装、素材处理、构建和测试命令。浏览器检查默认依赖本机 Windows Edge；可以通过当前会话 HAZEL_EDGE_PATH 指定兼容 Chromium 路径，其他环境未实测。
