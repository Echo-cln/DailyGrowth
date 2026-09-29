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
