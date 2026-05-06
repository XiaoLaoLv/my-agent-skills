---
name: cn-hk-financial-report-downloader
description: "下载中国 A 股与港股上市公司的财务报告 PDF。使用场景：用户要求下载、获取、检索或保存 A 股/港股年报、半年报、一季报、三季报、季度报告、业绩公告、巨潮资讯网（CNINFO）公告、披露易（HKEXnews）文件，或按股票代码批量归档中港上市公司财报。"
metadata: {"openclaw":{"emoji":"📊","requires":{"bins":["node"]}}}
---

# 中港财报下载器

使用 `scripts/download.js` 下载 A 股和港股财务报告 PDF。脚本调用巨潮资讯网（A 股）或披露易（港股），筛选正式财务报告，下载 PDF，并输出结构化 JSON 结果。

这是发布版 skill：运行代码已编译为 JavaScript，不依赖 `node_modules`、TypeScript 或 `npx tsx`。目标环境只需要 Node.js 18 或更高版本。

## 工作流程

1. 确认股票代码和报告类型。
2. 在 skill 目录运行下载脚本。
3. 若用户没有指定输出目录，优先保存到当前工作区的 `reports/`。
4. 下载完成后，向用户返回保存路径、公司名称、财年、报告期和披露日期。
5. 若没有找到报告，说明查询窗口、报告类型和脚本返回的 `reasonCode`。

## 命令

```bash
node scripts/download.js \
  --ticker <股票代码> \
  --output-dir <保存目录> \
  [--forms FY,H1,Q1,Q2,Q3,Q4] \
  [--start-date YYYY-MM-DD] \
  [--end-date YYYY-MM-DD]
```

参数：

- `--ticker`：必填。A 股为 6 位代码，如 `601318`、`600519`；港股为 4-5 位代码，如 `0700`、`9988`。
- `--output-dir`：必填。PDF 保存目录。
- `--forms`：可选。`FY` 年报，`H1` 半年报，`Q1` 一季报，`Q2` 二季报，`Q3` 三季报，`Q4` 四季报。默认下载全部支持类型。
- `--start-date` / `--end-date`：可选。限制公告披露日期窗口。

## 示例

下载中国平安 2025 年年报：

```bash
node scripts/download.js --ticker 601318 --output-dir ./reports --forms FY --start-date 2026-01-01 --end-date 2026-05-06
```

下载贵州茅台年报：

```bash
node scripts/download.js --ticker 600519 --output-dir ./reports --forms FY
```

下载腾讯控股全部可用财报：

```bash
node scripts/download.js --ticker 0700 --output-dir ./reports
```

## 输出

文件保存为：

```text
{output-dir}/{ticker}/{FY|H1|Q1|Q2|Q3|Q4}_{fiscal_year}[_amended].pdf
```

示例：

```text
reports/601318/FY_2025.pdf
reports/000001/H1_2024.pdf
reports/0700/FY_2024_amended.pdf
```

## 规则

- A 股使用巨潮资讯网；港股使用披露易。
- A 股没有稳定独立的 `Q2`、`Q4` 分类；脚本会把这类请求标记为 `skipped`。
- 排除摘要、英文版、ESG 报告、取消公告、募集说明书、审计报告、提示性公告等非正式报告正文。
- 保留更正、修订、更新后的正式报告，并优先选择修订版本。
- 下载后校验 PDF 文件大小和 PDF 文件头。

## 依赖和注意事项

- 需要 Node.js 18 或更高版本，使用原生 `fetch`。
- 访问巨潮或披露易需要网络权限；在受限沙盒中运行时，请申请联网授权。
- 不要运行 `npm install` 或 `npx tsx`；发布包已包含可直接运行的 JavaScript。
