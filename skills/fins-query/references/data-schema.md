# 数据结构参考

## meta.json

```json
{
  "source_url": "https://...",
  "total_sections": 22,
  "total_tables": 10,
  "total_pages": 5
}
```

## index.json

```json
{
  "sections": [
    {
      "ref": "s_003",
      "title": "第三节 管理层讨论与分析",
      "level": 1,
      "preview": "2024年度公司实现营业收入...",
      "page_range": [7, 19],
      "table_refs": ["t_005", "t_006"]
    }
  ],
  "tables": [
    {
      "ref": "t_005",
      "caption": "分行业营业收入",
      "page_no": 8,
      "headers": ["行业", "收入(亿元)", "同比"],
      "row_count": 5,
      "col_count": 3,
      "section_ref": "s_003"
    }
  ]
}
```

## sections.json

```json
{
  "s_003": {
    "ref": "s_003",
    "title": "第三节 管理层讨论与分析",
    "content": "公司主营业务分为... [表格 t_005]\n..."
  }
}
```

正文中 `[表格 t_xxx]` 是表格占位符，需去 tables.json 取实际数据。

## tables.json

```json
{
  "t_005": {
    "ref": "t_005",
    "caption": "分行业营业收入",
    "page_no": 8,
    "headers": ["行业", "收入(亿元)", "同比"],
    "rows": [["消费电子", "32.1", "15.2%"]],
    "row_count": 5,
    "col_count": 3,
    "section_ref": "s_003"
  }
}
```

## 约定

- `page_range`、`page_no`：1-based 页码
- `level`：标题层级，1 = 最高级（第一节/重要提示），数字越大越细
- `headers`：表头行；`rows`：数据行（不含表头）
- 章节→表格：一对多（`table_refs` 数组）
- 表格→章节：多对一（`section_ref` 单值）
