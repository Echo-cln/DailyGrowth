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


## 权威词典查询与云端保存

词卡资料缺失时，页面提供 Oxford Learner’s Dictionaries 与 Cambridge Dictionary 的官方查询入口。当前仅跳转到词典网页，不会将受版权保护的词典内容自动写入 Supabase。

Oxford 官方 API 可提供定义、发音和例句，但标准条款不允许缓存或保存内容；持久化需要另行取得授权。Cambridge API 也需要申请访问权限，其普通条款不允许将结果存入中间数据库。取得明确允许持久化的授权并配置服务端 API 凭据后，才能启用自动写入词库。

已有云端词条和已验证的六级真题记录保持不变；没有可靠来源的字段继续显示“待补充”。