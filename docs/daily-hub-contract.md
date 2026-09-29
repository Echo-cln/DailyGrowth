# DailyGlow Daily Hub：定时任务内容协议

DailyGlow 的首页有三条独立内容通道。它们按 **日期 + 内容类型** 保存，因此导入「基金市场」不会覆盖「每日简报」或「今日训练」。

| 内容类型 | 用途 | 建议由哪条定时任务生成 |
| --- | --- | --- |
| `growth_brief` | 每日简报、学习或生活行动 | 每日简报任务 |
| `market_brief` | 基金与市场观察 | 基金市场分析任务 |
| `workout_plan` | 训练动作与完成记录 | DailyGlow 运动计划任务 |

在 DailyGlow 的「今日」页面选择相应卡片的“导入”，填写标题和摘要，然后粘贴下方的 `payload` JSON。**不要把鉴权密钥或个人账户信息放进 JSON。**

```json
{
  "items": [
    {
      "id": "morning-read",
      "title": "阅读今日简报",
      "summary": "关注一条政策变化和一个自己的行动。",
      "url": "https://example.com"
    },
    {
      "id": "one-action",
      "title": "完成一个 20 分钟专注块",
      "summary": "完成即可勾选。"
    }
  ],
  "note": "可选的额外说明"
}
```

`id` 应在同一份内容中保持稳定；它用来保存每个事项的勾选状态。`title` 必填，`summary` 和 `url` 可选。以后若扩展阅读链接、评分、图表或 AI 来源，可以直接加在 `payload` 内，不会破坏旧内容。

## 自动导入接口

部署环境配置 `DAILYGLOW_IMPORT_KEY` 和 `DAILYGLOW_IMPORT_USER_ID` 后，可信云端工作流可向 `POST /api/daily-import` 发送下列 JSON。它只接受请求头 `x-dailyglow-import-key` 中的导入密钥，且写入的账户由服务器环境变量固定；浏览器、GitHub 和公开仓库都拿不到该密钥。

```json
{
  "contentType": "growth_brief",
  "contentDate": "2026-09-29",
  "title": "早间成长简报",
  "summary": "今日最值得关注的三件事。",
  "payload": {
    "items": [
      { "id": "focus-1", "title": "完成一个行动", "summary": "简短、可执行。" }
    ]
  }
}
```

同一用户、日期和内容类型会更新为最新版本；三种内容类型彼此独立。

## 给定时任务的输出要求

让两个定时任务分别只输出 JSON，不要混合 Markdown、寒暄或代码围栏：

```text
请仅输出符合 DailyGlow payload 协议的 JSON。生成 3–6 个 items；每项必须有稳定的 id、简洁的 title、可选 summary。内容类型：growth_brief。
```

基金任务仅将最后一项改为 `内容类型：market_brief`。ChatGPT 定时任务本身不会自动拥有你的 Supabase 写入权限；要自动写入，需要由可信云端工作流携带导入密钥调用上述接口。
