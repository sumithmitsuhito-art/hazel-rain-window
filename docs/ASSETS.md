# 素材来源与资源管线

所有构建输入均在仓库内，不依赖上级目录。

| 素材 | 原件 | 运行副本 |
| --- | --- | --- |
| 缩减伴奏 | assets/source/music/背景音乐（缩减版）.wav | assets/production/music.m4a |
| 25 条语音 | assets/source/voice/*.mp4 | assets/production/v01.flac 至 v25.flac |
| 坐姿人物 | assets/art/hazel-seated-atlas-v1.png | assets/production/hazel-uniform-idle.webp |
| 背景和特效 | src 中的程序绘制 | 不使用背景位图 |

音乐和语音由用户提供，人物按用户参考与草图生成。运行时仅使用制服坐姿一张图；保留源图用于重新提取，不代表恢复动作或服装切换。生成记录见 assets/art/generation-prompts.json。人物源图的哈希与字节数记在 catalog.json 的 characters.source、characters.sourceSha256 与 characters.sourceBytes；源图仍保留全部 8 个精灵，管线只提取 runtime 使用的一张。

原语音 MP4 是音频输入封装，派生 FLAC 体积更大但避免二次有损压缩。原 WAV 留存，伴奏 AAC 256 kbps 是有损副本。哈希、起音裁切与响度见 catalog.json 和 assets/analysis。

npm run prepare:assets 从原件生成生产素材和元数据；npm run build 将 27 项运行资源内嵌到 HTML，运行素材合计 5,259,814 字节。

尚未指定代码许可证。音乐、语音、角色参考和生成素材的公开再分发授权未在项目中确认，不自动声明为 MIT、CC 或公有领域。旧参考项目未参与运行构建，其授权不推定为本项目授权。
