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


## 词卡缺项按需补齐

学习词卡在英美音标、中文释义、必记搭配、例句或翻译缺失时，会显示“补齐缺失词条资料”。点击后网页调用受登录保护的 `/api/free-lexicon`，只补数据库中的空字段并刷新当前词卡；不会覆盖已有六级真题例句或已有学习记录。

- IPA、释义和补充例句来自 Free Dictionary API 返回的 Wiktionary 数据。Wiktionary 是开放社区词典，不等同于 Oxford、Cambridge 等权威学习词典；补充例句不是六级真题，页面会明确标示。
- 按需补全不会根据 Datamuse 或共现语料新造“必记搭配”。只会为词库中已有、但缺中文翻译的搭配补机器翻译，并标注来源及“待核对”；机器翻译不视为权威译文。
- 已有六级真题例句会保留。若没有可确认的真题或词典字段，仍显示“待补充”，不会伪装成真题或权威来源。
- 如果外部服务暂时无结果，缺项仍保留，用户可以稍后重试。
- 这个按钮适用于词库中已存在、但不一定属于当天计划的单词；尚未进入云端词库的单词需先导入词库。
