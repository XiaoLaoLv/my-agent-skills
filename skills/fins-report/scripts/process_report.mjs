/**
 * 财报 PDF 预处理脚本。
 *
 * 调用 MinerU API 将 PDF 转为结构化 JSON，并构建章节/表格索引，
 * 供 LLM 通过 grep/read 查询。
 *
 * 用法：
 *   node process_report.mjs --url <PDF_URL> --output <DIR> [--token <TOKEN>]
 *   node process_report.mjs --file <LOCAL_PDF> --output <DIR> [--token <TOKEN>]
 *
 * 输出目录结构：
 *   {output}/
 *     meta.json              文档元信息
 *     index.json             章节目录 + 表格索引
 *     sections.json          各章节正文（按 ref 索引）
 *     tables.json            各表格数据（按 ref 索引）
 *     full.md                MinerU 输出的完整 Markdown
 *     content_list.json      MinerU 原始输出（备用）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, unlinkSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { inflateRawSync } from "node:zlib";

const API_BASE = "https://mineru.net/api/v4";
const POLL_INTERVAL = 5000;
const POLL_MAX_WAIT = 1_800_000;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

async function apiFetch(path, token, options) {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`API 错误: ${data.msg}`);
  }
  return data.data;
}

async function submitTask(url, token, opts) {
  const payload = {
    url,
    is_ocr: opts.enableOcr !== false,
    enable_table: opts.enableTable !== false,
    language: opts.language ?? "ch",
  };
  if (opts.pageRanges) payload.page_ranges = opts.pageRanges;

  const data = await apiFetch("/extract/task", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.task_id;
}

async function submitLocalFile(filePath, token, opts) {
  const fileName = basename(filePath);

  const payload = {
    files: [{ name: fileName, is_ocr: opts.enableOcr !== false }],
    language: opts.language ?? "ch",
    enable_formula: false,
    enable_table: opts.enableTable !== false,
    model_version: opts.modelVersion ?? "vlm",
  };
  if (opts.pageRanges) payload.files[0].page_ranges = opts.pageRanges;

  const batchData = await apiFetch("/file-urls/batch", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const batchId = batchData.batch_id;
  const uploadUrl = batchData.file_urls[0];
  console.log(`  batch_id: ${batchId}`);

  const fileBuffer = readFileSync(filePath);
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    body: fileBuffer,
  });
  if (!uploadResp.ok) {
    const body = await uploadResp.text().catch(() => "");
    throw new Error(`上传失败: HTTP ${uploadResp.status} ${uploadResp.statusText}${body ? ` - ${body.slice(0, 300)}` : ""}`);
  }
  console.log("  上传成功");

  return pollBatch(batchId, token);
}

async function pollTask(taskId, token) {
  const start = Date.now();
  while (true) {
    const data = await apiFetch(`/extract/task/${taskId}`, token);
    if (data.state === "done") return data.full_zip_url;
    if (data.state === "failed") throw new Error(`解析失败: ${data.err_msg}`);

    const elapsed = Date.now() - start;
    if (elapsed > POLL_MAX_WAIT) throw new Error(`等待超时 (${POLL_MAX_WAIT / 1000}s)`);
    console.log(`  状态: ${data.state}，已等待 ${Math.floor(elapsed / 1000)}s...`);
    await sleep(POLL_INTERVAL);
  }
}

async function pollBatch(batchId, token) {
  const start = Date.now();
  while (true) {
    const data = await apiFetch(`/extract-results/batch/${batchId}`, token);
    const results = data.extract_result;
    if (results && results.length > 0) {
      const item = results[0];
      if (item.state === "done") return item.full_zip_url;
      if (item.state === "failed") throw new Error(`解析失败: ${item.err_msg}`);
      const progress = item.extract_progress
        ? ` (${item.extract_progress.extracted_pages ?? "?"}/${item.extract_progress.total_pages ?? "?"} 页)`
        : "";
      console.log(`  状态: ${item.state ?? "处理中"}${progress}，已等待 ${Math.floor((Date.now() - start) / 1000)}s...`);
      await sleep(POLL_INTERVAL);
      continue;
    }

    const elapsed = Date.now() - start;
    if (elapsed > POLL_MAX_WAIT) throw new Error(`等待超时 (${POLL_MAX_WAIT / 1000}s)`);
    console.log(`  状态: 处理中，已等待 ${Math.floor(elapsed / 1000)}s...`);
    await sleep(POLL_INTERVAL);
  }
}

function extractZip(zipPath, outputDir) {
  const buffer = readFileSync(zipPath);
  const root = resolve(outputDir);
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength).replace(/\\/g, "/");
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length) {
      throw new Error(`ZIP 格式错误: ${name}`);
    }

    const target = resolve(outputDir, name);
    if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
      throw new Error(`ZIP 路径不安全: ${name}`);
    }

    if (name.endsWith("/")) {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      const compressed = buffer.subarray(dataStart, dataEnd);
      let content;
      if (method === 0) {
        content = compressed;
      } else if (method === 8) {
        content = inflateRawSync(compressed, { finishFlush: 2 });
      } else {
        throw new Error(`不支持的 ZIP 压缩方法 ${method}: ${name}`);
      }
      if (uncompressedSize !== 0 && content.length !== uncompressedSize) {
        throw new Error(`ZIP 解压大小不匹配: ${name}`);
      }
      writeFileSync(target, content);
    }

    offset = dataEnd;
  }
}

async function downloadAndExtract(zipUrl, outputDir) {
  const zipPath = join(outputDir, "_download.zip");

  console.log("  下载 ZIP...");
  const resp = await fetch(zipUrl);
  if (!resp.body) throw new Error("下载失败: 无响应体");

  const fileStream = createWriteStream(zipPath);
  const nodeStream = Readable.fromWeb(resp.body);
  await pipeline(nodeStream, fileStream);

  console.log("  解压...");
  extractZip(zipPath, outputDir);
  unlinkSync(zipPath);

  const files = new Map();
  const listing = readdirSync(outputDir);
  for (const name of listing) {
    if (name) {
      files.set(name, join(outputDir, name));
    }
  }
  return files;
}

function findFileBySuffix(files, suffix) {
  for (const [name, path] of files) {
    if (name.endsWith(suffix)) return path;
  }
  return undefined;
}

function parseHtmlTable(html) {
  const rows = [];
  let pos = 0;

  const trOpenRe = /<tr[\s>]/gi;
  const trCloseRe = /<\/tr>/gi;
  const cellOpenRe = /<(td|th)(\s[^>]*)?\s*>/gi;
  const cellCloseRe = /<\/(td|th)>/gi;

  while (pos < html.length) {
    trOpenRe.lastIndex = pos;
    const trMatch = trOpenRe.exec(html);
    if (!trMatch) break;

    trCloseRe.lastIndex = trMatch.index + trMatch[0].length;
    const trCloseMatch = trCloseRe.exec(html);
    if (!trCloseMatch) break;

    const trContent = html.slice(trMatch.index + trMatch[0].length, trCloseMatch.index);
    const row = [];
    let cellPos = 0;

    while (cellPos < trContent.length) {
      cellOpenRe.lastIndex = cellPos;
      const cellOpen = cellOpenRe.exec(trContent);
      if (!cellOpen) break;

      cellCloseRe.lastIndex = cellOpen.index + cellOpen[0].length;
      const cellClose = cellCloseRe.exec(trContent);
      if (!cellClose) break;

      const cellContent = trContent.slice(cellOpen.index + cellOpen[0].length, cellClose.index);
      const text = cellContent.replace(/<[^>]*>/g, "").trim();
      row.push(text);
      cellPos = cellClose.index + cellClose[0].length;
    }

    if (row.length > 0) rows.push(row);
    pos = trCloseMatch.index + trCloseMatch[0].length;
  }
  return rows;
}

function findParentSection(sections, pageNo) {
  if (pageNo == null || sections.length === 0) {
    return sections.length > 0 ? sections[0].ref : null;
  }
  for (const s of sections) {
    const pr = s.page_range;
    if (pr && pr.length === 2 && pr[0] <= pageNo && pageNo <= pr[1]) {
      return s.ref;
    }
  }
  const last = sections[sections.length - 1];
  const pr = last.page_range;
  if (pr && pageNo >= pr[0]) return last.ref;
  return sections.length > 0 ? sections[0].ref : null;
}

function buildIndex(contentList) {
  const sections = [];
  const tables = [];
  const tableRefByItem = new Map();
  const tableRefToSectionRef = new Map();

  let globalTableIdx = 0;
  for (const item of contentList) {
    if (item.type !== "table") continue;
    globalTableIdx++;
    tableRefByItem.set(item, `t_${String(globalTableIdx).padStart(3, "0")}`);
  }

  let sectionCount = 0;
  let currentItems = [];
  let currentTitle = null;
  let currentLevel = 0;

  function flushSection() {
    if (currentItems.length === 0 && currentTitle === null) return;

    sectionCount++;
    const ref = `s_${String(sectionCount).padStart(3, "0")}`;

    const contentParts = [];
    const childTableRefs = [];
    for (const item of currentItems) {
      if (item.type === "table") {
        const tRef = tableRefByItem.get(item);
        childTableRefs.push(tRef);
        tableRefToSectionRef.set(tRef, ref);
        contentParts.push(`[表格 ${tRef}]`);
      } else if (item.type === "text") {
        const text = (item.text ?? "").trim();
        if (text) contentParts.push(text);
      }
    }

    const pages = currentItems
      .filter(it => typeof it.page_idx === "number")
      .map(it => it.page_idx + 1);
    const pageRange = pages.length > 0 ? [Math.min(...pages), Math.max(...pages)] : null;
    const preview = contentParts.join(" ").slice(0, 200);

    sections.push({
      ref,
      title: currentTitle,
      level: currentLevel,
      preview,
      page_range: pageRange,
      table_refs: childTableRefs,
    });
  }

  for (const item of contentList) {
    if (item.type === "discarded") continue;

    if (item.type === "table") {
      currentItems.push(item);
      continue;
    }

    if (item.type === "text") {
      const textLevel = item.text_level;
      const text = (item.text ?? "").trim();

      if (textLevel != null && text) {
        flushSection();
        currentItems = [];
        currentTitle = text;
        currentLevel = Number(textLevel);
      } else {
        currentItems.push(item);
      }
    }
  }
  flushSection();

  let tableIdx = 0;
  for (const item of contentList) {
    if (item.type !== "table") continue;

    tableIdx++;
    const tRef = tableRefByItem.get(item) ?? `t_${String(tableIdx).padStart(3, "0")}`;
    const pageNo = typeof item.page_idx === "number" ? item.page_idx + 1 : null;
    const captions = item.table_caption ?? [];
    const caption = captions.length > 0 ? captions[0] : null;
    const htmlBody = item.table_body ?? "";

    const allRows = parseHtmlTable(htmlBody);
    const headers = allRows.length > 0 ? allRows[0] : [];
    const dataRows = allRows.length > 1 ? allRows.slice(1) : [];

    const parentSection = tableRefToSectionRef.get(tRef) ?? findParentSection(sections, pageNo);

    tables.push({
      ref: tRef,
      caption,
      page_no: pageNo,
      row_count: dataRows.length,
      col_count: headers.length,
      headers,
      rows: dataRows,
      section_ref: parentSection,
      html: htmlBody,
    });
  }

  for (const t of tables) {
    if (t.section_ref) {
      const s = sections.find(sec => sec.ref === t.section_ref);
      if (s && !s.table_refs.includes(t.ref)) {
        s.table_refs.push(t.ref);
      }
    }
  }

  return { sections, tables };
}

function buildSectionsContent(contentList, index) {
  const sectionsByRef = new Map(index.sections.map(s => [s.ref, s]));
  const result = {};

  let sectionCount = 0;
  let currentItems = [];

  function flush() {
    if (currentItems.length === 0) return;
    sectionCount++;
    const ref = `s_${String(sectionCount).padStart(3, "0")}`;

    const contentParts = [];
    let tableIdxInSection = 0;
    for (const item of currentItems) {
      if (item.type === "table") {
        tableIdxInSection++;
        const sec = sectionsByRef.get(ref);
        if (sec) {
          const trs = sec.table_refs;
          if (tableIdxInSection - 1 < trs.length) {
            contentParts.push(`\n[表格 ${trs[tableIdxInSection - 1]}]\n`);
          }
        }
      } else if (item.type === "text") {
        const text = (item.text ?? "").trim();
        if (text && item.text_level == null) contentParts.push(text);
      }
    }

    const sec = sectionsByRef.get(ref);
    result[ref] = {
      ref,
      title: sec?.title ?? null,
      content: contentParts.join("\n"),
    };
  }

  for (const item of contentList) {
    if (item.type === "discarded") continue;
    if (item.type === "text" && item.text_level != null) {
      flush();
      currentItems = [];
    }
    currentItems.push(item);
  }
  flush();

  return result;
}

async function main() {
  const args = parseArgs(process.argv);

  const url = args.url;
  const filePath = args.file;
  const outputDir = args.output;
  const token = args.token ?? process.env.MINERU_API_TOKEN ?? "";
  const language = args.language ?? "ch";
  const enableOcr = args["no-ocr"] !== "true";
  const pageRanges = args.pages;

  if (!url && !filePath) {
    console.error("错误: 必须指定 --url 或 --file");
    process.exit(1);
  }
  if (!outputDir) {
    console.error("错误: 必须指定 --output");
    process.exit(1);
  }
  if (!token) {
    console.error(`缺少 MinerU API key。

请先设置 MINERU_API_TOKEN 环境变量，或在命令中传入 --token。

PowerShell 临时设置：
  $env:MINERU_API_TOKEN="你的 MinerU API key"

PowerShell 持久设置：
  setx MINERU_API_TOKEN "你的 MinerU API key"

然后重新运行本命令。`);
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  let zipUrl;

  if (filePath) {
    console.log(`[1/4] 上传文件: ${filePath}`);
    zipUrl = await submitLocalFile(filePath, token, { language, enableOcr, pageRanges });
  } else {
    console.log(`[1/4] 提交任务: ${url}`);
    const taskId = await submitTask(url, token, { language, enableOcr, pageRanges });
    console.log(`  task_id: ${taskId}`);
    console.log("[2/4] 等待解析完成...");
    zipUrl = await pollTask(taskId, token);
  }

  console.log("[3/4] 下载并解压...");
  const files = await downloadAndExtract(zipUrl, outputDir);

  const contentListPath = findFileBySuffix(files, "_content_list.json");
  if (!contentListPath) {
    console.error("错误: 未找到 content_list.json");
    process.exit(1);
  }

  const contentList = JSON.parse(readFileSync(contentListPath, "utf-8"));

  console.log("[4/4] 构建索引...");
  const index = buildIndex(contentList);
  const sectionsContent = buildSectionsContent(contentList, index);

  const tablesByRef = {};
  for (const t of index.tables) {
    tablesByRef[t.ref] = {
      ref: t.ref,
      caption: t.caption,
      page_no: t.page_no,
      headers: t.headers,
      row_count: t.row_count,
      col_count: t.col_count,
      rows: t.rows,
      section_ref: t.section_ref,
    };
  }

  const maxPage = contentList.reduce(
    (max, item) => (typeof item.page_idx === "number" ? Math.max(max, item.page_idx + 1) : max),
    0,
  );

  const meta = {
    source_url: url ?? null,
    source_file: filePath ?? null,
    total_sections: index.sections.length,
    total_tables: index.tables.length,
    total_pages: maxPage,
  };

  const write = (name, data) =>
    writeFileSync(join(outputDir, name), JSON.stringify(data, null, 2), "utf-8");

  write("meta.json", meta);
  write("index.json", index);
  write("sections.json", sectionsContent);
  write("tables.json", tablesByRef);

  console.log(`完成！输出目录: ${outputDir}`);
  console.log(`  章节: ${meta.total_sections} 个`);
  console.log(`  表格: ${meta.total_tables} 个`);
  console.log(`  页数: ${meta.total_pages} 页`);
}

main().catch(err => {
  console.error(`致命错误: ${err.message}`);
  process.exit(1);
});
