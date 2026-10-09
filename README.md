# DailyGlow

> 把学习、洞察与训练收进同一份每日计划。

**产品名：DailyGlow**  
**仓库名：DailyGrowth**（仓库名不影响网页标题、Logo 或用户看到的产品名）

## 独立云端内容通道

| Type | 用途 | 生成来源 |
| --- | --- | --- |
| `growth_brief` | 每日成长简报 | 早间每日简报任务 |
| `market_brief` | 基金与市场分析 | 午后市场复盘任务 |
| `workout_plan` | 今日训练 | DailyGlow 训练计划 |

内容以 **用户 + 日期 + 类型** 独立保存。导入市场分析不会覆盖每日简报或训练计划。

## 云端状态

- Supabase 表与 RLS 已于 2026-09-29 创建并验证。
- 下一步：迁入 DailyGlow 网页代码，接入 `/daily` 首页与 `/api/daily-hub` 云端接口。

## 溯·辞词汇补全邮件

Gmail Apps Script 每 5 分钟扫描一次补全邮件，并调用受保护的 /api/vocabulary-enrichment。导入只补原始 CET-6 核心词库中的空字段；已有例句（尤其真题原句）不会被替换。补全后，今日新词与复习项读取同一词库，不会重复创建学习任务。

邮件正文使用以下标记包住 JSON。Apps Script 使用现有 DAILYGLOW_IMPORT_URL 和 DAILYGLOW_IMPORT_KEY 配置，无需新增密钥；更新脚本后运行一次 setupDailyGlowBridge 即可让原有 5 分钟触发器继续扫描。

    DAILYGLOW_CET6_ENRICHMENT_V1
    BEGIN_DAILYGLOW_VOCAB_JSON
    {"date":"2026-10-09","words":[{"word":"example","phoneticUk":"/ɪɡˈzɑːmpəl/","phoneticUs":"/ɪɡˈzæmpəl/","phoneticSourceLabel":"Oxford Learner's Dictionaries","example":{"sentence":"She gave a clear example to explain the rule.","translation":"她举了一个清晰的例子来解释这条规则。","sourceType":"original","sourceLabel":"DailyGlow 原创六级语境例句"},"collocations":[{"phrase":"a typical example","translation":"一个典型的例子","sourceLabel":"Oxford Learner's Dictionaries"}]}]}
    END_DAILYGLOW_VOCAB_JSON

example.sourceType 只能是 original 或 dictionary；不要把非真题例句标成真题。词条的音标和搭配也应带来源名称。导入接口按单词逐条校验并返回补全/跳过明细。

## 词卡资料自动补全

词卡保留“自动补全缺失资料”操作。自动补全目标是从 Oxford、Cambridge 等权威学习词典获取资料，并写入云端词库，供每日学习与复习使用。

Oxford 的 API 调用已支持通过服务端环境变量配置，不把凭证写入代码或 GitHub：

- `OXFORD_APP_ID`
- `OXFORD_APP_KEY`
- `OXFORD_API_BASE_URL`（Sandbox 测试时填 Oxford 提供的 API Base URL；生产环境按 Oxford 许可提供的地址配置）

`OXFORD_APP_ID` 和 `OXFORD_APP_KEY` 只配置在托管平台的服务端环境变量中，不要放在 `NEXT_PUBLIC_*` 变量、浏览器代码、邮件正文或 GitHub。当前 Oxford 示例接口只进行实时查询，不会写入 Supabase。

**注意：Sandbox 凭证只用于其许可范围内的评估/测试。** 只有在 Oxford 明确许可将返回的词典内容持久化到云端数据库后，才启用词卡自动写入；授权未配置时，自动补全接口会明确提示并且不修改词库。不要以查询跳转或未授权抓取代替自动补全。

已有云端词条和已验证的六级真题记录保持不变；没有可确认来源的字段继续显示“待补充”。
