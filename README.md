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

缺项词卡提供“自动补全缺失资料”操作。当前可持久化的备用来源为 Wiktionary，经 FreeDictionaryAPI.com 获取结构化数据；数据采用 CC BY-SA 4.0。页面展示来源链接与许可，新增例句标记为“开放词典例句 · 非真题”。机器翻译会明确标注“待核对”。

- 会尝试补充缺失的英/美音标、中文释义、开放词典例句和例句翻译。
- 仅补缺失字段，不覆盖已有词义、音标或例句。
- Wiktionary 数据没有足够依据时，字段继续显示“待补充”。
- 不从语料猜测生成“必记搭配”；无可靠搭配来源时保持待补充。
- Wiktionary 与机器翻译并非 Oxford/Cambridge 权威学习词典内容，也不会标成六级真题。

Oxford Sandbox 的服务端变量为 `OXFORD_APP_ID`、`OXFORD_APP_KEY`、`OXFORD_API_BASE_URL`。凭证只能配置在服务端环境，不可使用 `NEXT_PUBLIC_*` 或提交到 GitHub。Sandbox 额度耗尽时可使用 Wiktionary 路径继续补全。Oxford 标准 API/Sandbox 凭证不自动赋予长期保存权；在获得 Oxford 对云端存储的明确许可前，Oxford 返回内容不会写入 Supabase。