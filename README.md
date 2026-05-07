# Agent Skills

个人 agent skills 仓库，用来集中维护、测试和发布可复用的 skill。

## 目录结构

```text
agent-skills/
├── skills/   # 每个子目录是一个独立 skill
├── scripts/  # 仓库维护脚本
└── dist/     # 打包生成的 .skill 文件
```

## 已包含的 skills

- `cn-hk-financial-report-downloader`：下载 A 股与港股上市公司财务报告 PDF。
- `fins-report`：将财报 PDF 预处理为结构化 JSON，供后续查询使用。
- `fins-query`：针对已预处理的财报目录与表格数据进行检索查询。

## 校验

```bash
npm run validate
```

校验内容包括：

- 每个 skill 必须包含 `SKILL.md`
- `SKILL.md` 必须包含 YAML frontmatter
- frontmatter 必须包含 `name` 和 `description`
- skill 目录名必须和 frontmatter `name` 一致
- 若存在 `agents/openai.yaml`，必须包含 `display_name`、`short_description`、`default_prompt`

## 打包

```bash
npm run package
```

打包产物会写入 `dist/*.skill`。`.skill` 本质是 zip 包，可用于分享或导入支持该格式的 agent 工具。

## 安装到本机

先在仓库内注册 CLI：

```bash
npm link
```

一次性安装仓库里的全部 skills 到 `~/.agents/skills/`：

```bash
myagentskills
```

安装到其他 agent 的 skills 目录：

```bash
myagentskills -- /path/to/agent/skills
```

也可以用环境变量指定目标目录：

```bash
AGENT_SKILLS_DIR=/path/to/agent/skills myagentskills
```

安装脚本会覆盖目标目录里的同名 skill，但不会删除其他 skill。

如果目标工具支持 `.skill` 导入，也可以使用 `dist/*.skill`。

## CLI 命令

`myagentskills` 支持这些用法：

```bash
myagentskills
myagentskills -- /path/to/agent/skills
myagentskills install /path/to/agent/skills
myagentskills validate
myagentskills package
```

默认命令是安装：`myagentskills` 等价于安装全部 skills 到 `~/.agents/skills/`。

不想注册 CLI 时，也可以在仓库内使用 npm 脚本：

```bash
npm run install:local
npm run install:local -- /path/to/agent/skills
```
