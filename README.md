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

## 校验

```bash
node scripts/validate-skills.js
```

校验内容包括：

- 每个 skill 必须包含 `SKILL.md`
- `SKILL.md` 必须包含 YAML frontmatter
- frontmatter 必须包含 `name` 和 `description`
- skill 目录名必须和 frontmatter `name` 一致
- 若存在 `agents/openai.yaml`，必须包含 `display_name`、`short_description`、`default_prompt`

## 打包

```bash
node scripts/package-skills.js
```

打包产物会写入 `dist/*.skill`。`.skill` 本质是 zip 包，可用于分享或导入支持该格式的 agent 工具。

## 安装到本机

把某个 skill 目录复制到 agent 的 skills 目录即可，例如：

```bash
cp -R skills/cn-hk-financial-report-downloader ~/.agents/skills/
```

如果目标工具支持 `.skill` 导入，也可以使用 `dist/cn-hk-financial-report-downloader.skill`。
