---
name: fins-report
description: >
  将财报 PDF 转为结构化 JSON（章节 + 表格索引）。使用 MinerU API 解析 PDF，
  输出 meta.json / index.json / sections.json / tables.json / full.md。
  Use when: (1) 用户提供了财报 PDF URL 或本地文件需要预处理，
  (2) 用户说"处理财报"、"解析年报"、"把 PDF 转成可查的 JSON"，
  (3) workspace/fins/{ticker}/ 下没有对应数据时需要先跑预处理。
---

# 财报预处理

调用 MinerU API 将财报 PDF 转为结构化 JSON，供 `fins-query` skill 查询。

## 用法

```bash
# URL
node scripts/process_report.mjs \
  --url "https://example.com/report.pdf" \
  --output workspace/fins/600519

# 本地文件
node scripts/process_report.mjs \
  --file "/path/to/report.pdf" \
  --output workspace/fins/600519

# 指定页码
node scripts/process_report.mjs \
  --url "https://..." --output workspace/fins/600519 \
  --pages "1-50"
```

## MinerU API key

用户需要自行提供 MinerU API key。安装脚本会在本 skill 目录下根据 `.env.example` 创建 `.env`，请让用户自己填写：

```bash
MINERU_API_TOKEN=你的 MinerU API key
```

不要把 `.env`、API key、`--token` 参数值写入仓库、`SKILL.md`、`.skill` 包或聊天记录。

脚本读取顺序：

1. `--token`
2. 环境变量 `MINERU_API_TOKEN`
3. 本 skill 目录下的 `.env`
4. `~/.config/my-agent-skills/mineru.env`

如果缺少 token，脚本会打印 `.env` 的具体位置并提醒用户填写。

PowerShell 临时设置（只对当前终端有效）仍可使用：

```powershell
$env:MINERU_API_TOKEN="你的 MinerU API key"
```

其他参数：`--language`（默认 ch）、`--no-ocr true`（禁用 OCR）。

## 输出

```
workspace/fins/{ticker}/
├── meta.json              # 总页数/章节数/表格数（脚本生成）
├── index.json             # 章节目录 + 表格索引（脚本生成）
├── sections.json          # 章节正文 by ref（脚本生成）
├── tables.json            # 表格数据 by ref（脚本生成）
├── full.md                # 完整 Markdown（MinerU 输出）
└── *_content_list.json    # MinerU 原始输出
```

脚本生成的 4 个 JSON 是查询入口，其余为 MinerU ZIP 解压产物。
