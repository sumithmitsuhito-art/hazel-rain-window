# 雨雾节拍 · 灰泽满

本地音乐点击游戏，当前版本 **0.5.2**。深墨蓝雨雾、居中单张人物、稀疏长光线与点击粒子反馈。动态判定线版本已回退，本次整理不改变玩法。

[打开游戏](dist/game.html) · [开发规则](AGENTS.md) · [设计约定](docs/DESIGN.md) · [素材说明](docs/ASSETS.md) · [验收记录](docs/VALIDATION.md)

## 直接游玩

下载或复制 `dist/game.html`，双击打开，点击进入即可。首次用户手势启动音乐。人物、音乐和语音全部内嵌，游玩无需安装依赖、服务器或联网。

舞台任意位置点击，随机播放语音，吸附到下一半拍；同一格连续点击保留最后一次声音。点击位置决定视觉反馈位置，不决定音色。面板可调音量、拍点和动效。设置支持 JSON 导入导出；文件入口下的存储持久性由浏览器决定。

## 开发与构建

在本目录使用 Node.js 24 和 npm；已验证 Node 24.15.0、npm 11.12.1。依赖由 package-lock.json 锁定。

```sh
npm ci --cache .npm-cache --no-audit --no-fund
npm test
npm run build
npm run dev
```

预览地址以终端输出为准。首次安装依赖需要联网，成品运行无需联网。生产素材已保留，普通构建无需处理原音频。更换素材后运行：

```sh
npm run prepare:assets
npm run build
npm test
npm run test:browser
```

素材处理使用项目依赖中的 FFmpeg 和 sharp，不修改系统配置。浏览器检查默认使用 Windows Edge，其他安装路径通过当前会话 HAZEL_EDGE_PATH 指定。Linux/macOS 浏览器自动化尚未验证。

## 目录

| 路径 | 用途 |
| --- | --- |
| src/ | 输入、音频、队列、设置、视觉及页面模板 |
| assets/source/ | 原音乐和 25 条原语音，保留原件 |
| assets/art/ | 当前人物源图及生成记录 |
| assets/production/ | 实际使用的 27 项运行素材 |
| assets/analysis/ | 音乐拍点和语音起音分析 |
| assets/catalog.json | 资源索引、哈希及音频元数据 |
| tools/、tests/ | 素材处理、构建和验证 |
| dist/game.html | 可独立分发的游戏 |
| docs/ | 设计、素材、验收和整理说明 |
| build-report.json | 当前构建字节数及哈希 |

index.html 是跳转入口；源码模板在 src/template.html。

## 后续建立 GitHub 仓库

直接以本目录为仓库根目录即可；构建和素材处理均不依赖上级目录。提交源码、锁文件、原始与生产素材、文档和当前单 HTML；依赖、缓存、浏览器配置及临时测试结果已忽略。

尚未初始化或发布远程仓库，也未指定许可证。素材来源及使用边界见 ASSETS.md，不自动给音乐、语音或人物赋予开源授权。

历史研究、用户人物参考和退回版本不属于本仓库。旧迭代证据保留在原工作区 project-history/game-before-organize-2026-10-07/，当前项目无需访问它们。
