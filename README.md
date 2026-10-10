# DailyGlow

> 把每日简报、英语学习和训练计划放在一个地方，记录今天要做的事，也能回看做过什么。

**产品名：DailyGlow** · **仓库名：DailyGrowth**

DailyGlow 是基于 Next.js 与 Supabase 的个人学习和日常计划应用。当前仓库包括英语词汇学习、每日内容中心、训练记录、洞察页，以及供邮件自动化使用的导入接口。

## 功能

- **CET-6 词汇学习**：每日新词、复习任务、掌握度记录、词卡和学习历史。
- **缺项资料自动补全**：通过 Wiktionary（经 FreeDictionaryAPI.com 提供）补充词卡空缺，并展示来源链接、许可和机器翻译提示。
- **Oxford 实时例句查询**：使用服务端 Oxford 凭证按需查询；结果只用于当前请求，不写入数据库。
- **每日内容中心**：按用户、日期和内容类型保存成长简报、市场观察与训练计划，互不覆盖。
- **训练与洞察**：查看训练计划、历史完成情况和学习数据。
- **邮件导入**：受密钥保护的 API 可接收每日内容和词汇资料；词汇导入只补允许写入的空字段。

## 技术栈

- Next.js 16（App Router）、React 19、TypeScript
- Supabase Auth、Postgres 与 PostgREST
- EdgeOne Pages 配置文件：edgeone.json
- OpenAI Responses API：用于定时生成每日简报和训练内容
- ESLint；包管理器使用 npm

## 本地开发

要求 Node.js >=22.13.0 和 npm。

    npm ci
    # 仓库目前没有提交 .env.example；请按下方变量清单创建 .env.local
    npm run dev

打开 http://localhost:3000。

常用命令：

    npm run dev       # 本地开发
    npm run lint      # ESLint
    npm run build     # Next.js 生产构建
    npm start         # 启动已构建的应用

可选维护脚本：

    npm run import:enhanced
    npm run repair:collocations

两个脚本读取 .env.local，运行前请先检查脚本内容、数据库目标和影响范围。

## 环境变量

在本地 .env.local 或部署平台的服务端环境变量中配置。变量名以代码中的读取逻辑为准：

| 变量 | 用途 |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Supabase 项目 URL；也可用服务端变量 SUPABASE_URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Supabase Publishable Key；兼容旧名 NEXT_PUBLIC_SUPABASE_ANON_KEY |
| SUPABASE_SECRET_KEY | 服务端访问数据库所需的 Secret Key；兼容旧名 SUPABASE_SERVICE_ROLE_KEY |
| OPENAI_API_KEY | 定时内容生成所用的 OpenAI API 密钥 |
| DAILYGLOW_IMPORT_USER_ID | 定时生成及邮件导入内容归属的 Supabase 用户 UUID |
| DAILYGLOW_IMPORT_KEY | 邮件导入接口共享密钥；请使用高熵随机值 |
| DAILYGLOW_OPENAI_MODEL | 可选；生成模型，默认 gpt-6-astra |
| OXFORD_APP_ID | 可选；Oxford 实时查询 App ID |
| OXFORD_APP_KEY | 可选；Oxford 实时查询 App Key |
| OXFORD_API_BASE_URL | 可选；Oxford API 基址，默认官方 API v2 地址 |

SUPABASE_SECRET_KEY、OPENAI_API_KEY、DAILYGLOW_IMPORT_KEY 和 Oxford 凭证只能放在服务端。不要使用 NEXT_PUBLIC_ 前缀，不要写进源码、邮件内容或 README。

## Supabase

应用通过 Supabase Auth 验证用户，再由服务端调用 PostgREST。部署前需要准备好项目 URL、Publishable Key、服务端 Secret Key，以及应用所需的基础词库与用户表。

仓库内的 supabase/ 目录包含 DailyGlow 每日内容相关 SQL。应用还依赖词汇学习及账户资料等现有表；这些基础表和 CET-6 词库需在目标 Supabase 项目中预先建立。执行 SQL 前先检查目标项目与当前 schema，避免重复应用或覆盖已有数据。所有用户数据都应保持 RLS 保护。

关键数据按以下维度隔离：

- 每日内容：用户 + 日期 + 类型
- 学习进度：用户 + 单词 + 学习轨道
- 每日任务与任务项：用户任务下的词汇记录

## API 概览

| 路径 | 方法 | 用途与访问方式 |
| --- | --- | --- |
| /api/auth | GET / POST | 登录与账户认证流程 |
| /api/state | GET / POST | 读取学习状态、任务和词库；需要用户 Bearer Token |
| /api/daily-hub | GET / POST | 读取、保存每日内容及完成状态；需要用户 Bearer Token |
| /api/daily-import | POST | 导入每日内容；使用 x-dailyglow-import-key |
| /api/daily-vocabulary | GET / POST | 读取或更新每日词汇学习数据；需要用户 Bearer Token |
| /api/free-lexicon | POST | 查询并补充 Wiktionary 开放词典资料；需要用户 Bearer Token |
| /api/oxford-example?word=... | GET | Oxford 实时例句查询；需要用户 Bearer Token |
| /api/vocabulary-enrichment | GET / POST | Gmail 词汇资料导入；POST 使用 x-dailyglow-import-key |
| /api/cron/daily-generate | GET | 定时生成每日简报和训练计划；由 EdgeOne 定时任务调用 |

定时生成支持 ?type=growth_brief、?type=market_brief 或 ?type=workout_plan；不传 type 时生成默认的成长简报与训练计划。只应由受控的部署定时任务触发该接口。

## Oxford 额度与开放词典回退

词卡上的“自动补全缺失资料”使用 Wiktionary 开放词典数据，因此不消耗 Oxford Sandbox 额度。若 Oxford 额度耗尽，用户仍可通过这个按钮补充可用的缺失内容。

- Wiktionary 数据经 FreeDictionaryAPI.com 获取；词卡标注 Wiktionary 来源链接及 CC BY-SA 4.0 许可。
- 自动补全只写入空缺字段，不覆盖已有内容；没有可靠资料时会继续显示待补充。
- 可补充的内容包括音标、释义、例句和机器翻译。机器翻译标记为待核对。
- 不会根据语料猜测搭配；开放词典例句会标为非真题并提示待核验。
- Oxford Sandbox/API 凭证不自动授予长期保存返回内容的权利。Oxford 例句仅实时展示，不写入 Supabase。

## 邮件自动化

仓库的 automation/gmail-apps-script/Code.gs 是 Gmail Apps Script 桥接脚本。每日内容导入使用 /api/daily-import；CET-6 词汇资料导入使用 /api/vocabulary-enrichment。请求必须带有与服务端一致的 DAILYGLOW_IMPORT_KEY。

词汇邮件按约定使用 DAILYGLOW_CET6_ENRICHMENT_V1 标记，并包含 BEGIN_DAILYGLOW_VOCAB_JSON / END_DAILYGLOW_VOCAB_JSON 包裹的 JSON。导入时会校验原始 CET-6 核心词库成员、来源和字段格式，并保留已存在的核验例句。

部署后，请在 Apps Script 属性中设置脚本所需的导入 URL 和密钥；具体属性名以 Code.gs 中的配置读取逻辑为准。不要把密钥贴进邮件或日志。

## EdgeOne 部署

仓库根目录的 edgeone.json 定义两项 Asia/Shanghai 时区的定时任务：

- 每天 08:05：调用 /api/cron/daily-generate
- 每天 14:05：调用 /api/cron/daily-generate?type=market_brief

将 GitHub 仓库连接到 EdgeOne Pages，并在项目服务端环境中配置上方所需变量。构建设置使用仓库的 npm lockfile 和 npm run build。推送到生产分支后，等待 EdgeOne 构建和发布成功，再通过线上站点验证登录、词卡、导入与定时接口。定时任务需要有效的 OPENAI_API_KEY 和 DAILYGLOW_IMPORT_USER_ID。

## 数据来源与许可

Wiktionary 内容按 CC BY-SA 4.0 提供，并在使用处保留词条来源链接与许可说明。FreeDictionaryAPI.com 提供结构化词典响应。MyMemory 仅用于缺少中文翻译时生成机器译文；译文不是人工审校内容。

邮件导入内容须提供可追溯来源。Oxford 实时结果与 Wiktionary 持久化资料采用不同处理方式：前者不保存，后者保留出处与许可信息。

## 目录结构

    app/
      api/                  认证、词汇、每日内容、定时生成接口
      daily/                每日内容页
      insights/             学习洞察页
      training/             训练页
      page.tsx              CET-6 学习主页
    automation/
      gmail-apps-script/    Gmail 导入桥接
    data/                   学习历史数据
    docs/                   每日内容数据契约
    lib/                    Supabase REST 与词汇数据工具
    supabase/               每日内容相关 SQL
    edgeone.json            EdgeOne 定时任务

## 当前实现边界

- 词库自动补全依赖 FreeDictionaryAPI.com、Wiktionary 和 MyMemory 的可用性与服务限制。
- Oxford 实时查询仅展示本次响应；额度、权限或服务不可用时，不影响 Wiktionary 自动补全路径。
- 自动生成内容会随日期、模型与数据源变化；市场内容仅作一般信息观察，不构成投资建议。
- 新环境需要先配置 Supabase 基础表、认证、词库数据及部署密钥，单独运行前端构建不能替代这些服务端准备工作。
