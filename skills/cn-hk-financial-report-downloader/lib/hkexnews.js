"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCompany = resolveCompany;
exports.listCandidates = listCandidates;
exports.downloadPdf = downloadPdf;
const title_filter_1 = require("./title-filter");
const HKEXNEWS_BASE_URL = "https://www1.hkexnews.hk";
const HKEXNEWS_ACTIVE_STOCK_URL = `${HKEXNEWS_BASE_URL}/ncms/script/eds/activestock_sehk_c.json`;
const HKEXNEWS_INACTIVE_STOCK_URL = `${HKEXNEWS_BASE_URL}/ncms/script/eds/inactivestock_sehk_c.json`;
const HKEXNEWS_TITLE_SEARCH_URL = `${HKEXNEWS_BASE_URL}/search/titleSearchServlet.do`;
const PDF_MAGIC = Buffer.from("%PDF-");
const PDF_MIN_BYTES = 1024;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE = 0.8;
const SLEEP_SECONDS = 0.3;
const USER_AGENT = "OpenClaw-CN-HK-Skill/1.0";
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const PERIOD_TO_CATEGORY = {
    FY: { t1code: "40000", t2Gcode: "-2", t2code: "40100" },
    H1: { t1code: "40000", t2Gcode: "-2", t2code: "40200" },
    Q1: { t1code: "10000", t2Gcode: "3", t2code: "13600" },
    Q2: { t1code: "10000", t2Gcode: "3", t2code: "13600" },
    Q3: { t1code: "10000", t2Gcode: "3", t2code: "13600" },
    Q4: { t1code: "10000", t2Gcode: "3", t2code: "13600" },
};
const PERIOD_INFERENCE_TOKENS = {
    FY: ["ANNUAL REPORT", "年報", "年报", "年度報告", "年度报告"],
    H1: ["INTERIM REPORT", "HALF-YEAR", "HALF YEAR", "中期報告", "中期报告", "半年報", "半年度報告"],
    Q1: ["FIRST QUARTER", "FIRST QUARTERLY", "THREE MONTHS", "3 MONTHS", "第一季度", "第一季", "一季度", "一季", "三個月", "三个月"],
    Q2: ["SECOND QUARTER", "SECOND QUARTERLY", "SIX MONTHS", "6 MONTHS", "HALF YEAR", "Q2", "第二季度", "第二季", "二季度", "二季", "六個月", "六个月", "半年"],
    Q3: ["THIRD QUARTER", "THIRD QUARTERLY", "NINE MONTHS", "9 MONTHS", "第三季度", "第三季", "三季度", "三季", "九個月", "九个月"],
    Q4: ["FOURTH QUARTER", "FOURTH QUARTERLY", "TWELVE MONTHS", "12 MONTHS", "FULL YEAR", "Q4", "第四季度", "第四季", "四季度", "四季", "十二個月", "十二个月", "全年"],
};
const PERIOD_SORT = { FY: 0, H1: 1, Q1: 2, Q2: 3, Q3: 4, Q4: 5 };
let stockMappingCache = null;
let lastRequestAt = 0;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function throttle() {
    if (SLEEP_SECONDS <= 0)
        return;
    const now = Date.now();
    const remaining = SLEEP_SECONDS * 1000 - (now - lastRequestAt);
    if (remaining > 0)
        await sleep(remaining);
}
function markRequestDone() {
    lastRequestAt = Date.now();
}
async function retryBackoff(attempt) {
    if (attempt >= MAX_RETRIES - 1)
        return;
    await sleep(RETRY_BACKOFF_BASE * Math.pow(2, attempt) * 1000);
}
async function httpGetJson(url, params) {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            await throttle();
            const u = params ? `${url}?${new URLSearchParams(params)}` : url;
            const resp = await fetch(u, { headers: { "User-Agent": USER_AGENT } });
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            markRequestDone();
            try {
                return JSON.parse(text);
            }
            catch {
                return tryParseJsonList(text);
            }
        }
        catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            await retryBackoff(attempt);
        }
    }
    throw new Error(`GET JSON 失败: url=${url} error=${lastError?.message}`);
}
async function httpDownloadBytes(url) {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            await throttle();
            const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status}`);
            const arrayBuf = await resp.arrayBuffer();
            markRequestDone();
            return Buffer.from(arrayBuf);
        }
        catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            await retryBackoff(attempt);
        }
    }
    throw new Error(`PDF 下载失败: url=${url} error=${lastError?.message}`);
}
function tryParseJsonList(text) {
    const cleaned = text.trim();
    if (!cleaned || cleaned === "null")
        return [];
    try {
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function extractRows(payload) {
    if (Array.isArray(payload))
        return payload;
    if (typeof payload !== "object" || payload === null)
        return [];
    const obj = payload;
    for (const key of ["stockInfo", "stockList", "stocks", "data", "result", "records", "rows"]) {
        const value = obj[key];
        if (Array.isArray(value))
            return value;
        if (typeof value === "string") {
            const parsed = tryParseJsonList(value);
            if (parsed.length > 0)
                return parsed;
        }
    }
    return [];
}
function stripHtml(raw) {
    return raw.replace(BR_RE, " ").replace(TAG_RE, "").replace(/\s+/g, " ").trim();
}
function firstText(data, keys) {
    for (const key of keys) {
        const value = data[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
        if (typeof value === "number")
            return String(value);
    }
    return null;
}
function toHkexStockCode(raw) {
    const digits = raw.replace(/\D/g, "");
    if (!digits)
        throw new Error(`HK ticker 缺少数字: ${raw}`);
    if (raw.trim().toUpperCase().endsWith(".HK") && digits.length > 5) {
        return digits.slice(0, 5);
    }
    if (digits.length <= 4)
        return digits.padStart(5, "0");
    if (digits.length === 5)
        return digits;
    throw new Error(`HK ticker 位数非法: ${raw}`);
}
function parseStockMappingEntry(raw) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const r = raw;
    const code = firstText(r, ["stockCode", "STOCK_CODE", "stock_code", "code", "CODE", "c"]);
    const stockId = firstText(r, ["stockId", "STOCK_ID", "stock_id", "id", "ID", "i"]);
    const name = firstText(r, ["stockName", "STOCK_NAME", "name", "NAME", "longName", "n"]);
    if (!code || !stockId)
        return null;
    return {
        stockCode: toHkexStockCode(code),
        stockId,
        companyName: stripHtml(name || code),
    };
}
function parseFilingDate(raw) {
    if (!raw)
        return null;
    const isoMatch = raw.match(/(?<year>\d{4})[-/](?<month>\d{1,2})[-/](?<day>\d{1,2})/);
    if (isoMatch?.groups) {
        const { year, month, day } = isoMatch.groups;
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    const dmyMatch = raw.match(/(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{4})/);
    if (dmyMatch?.groups) {
        const { year, month, day } = dmyMatch.groups;
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return null;
}
function inferFiscalYearFromTitle(title, filingDate) {
    const match = title.match(/(20\d{2}|19\d{2})/);
    if (match)
        return parseInt(match[1], 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(filingDate))
        return parseInt(filingDate.slice(0, 4), 10);
    return null;
}
function inferPeriodFromText(title, categoryText) {
    const combined = `${title} ${categoryText}`.toUpperCase();
    const normalized = categoryText.toUpperCase();
    const hasQuarter = /季度/.test(categoryText) || /QUARTER/.test(normalized);
    const order = hasQuarter
        ? ["Q4", "Q3", "Q2", "Q1", "H1", "FY"]
        : ["H1", "FY", "Q4", "Q3", "Q2", "Q1"];
    for (const period of order) {
        const tokens = PERIOD_INFERENCE_TOKENS[period];
        if (tokens.some((t) => combined.includes(t.toUpperCase())))
            return period;
    }
    return null;
}
function containsCjk(text) {
    return /[\u4e00-\u9fff]/.test(text);
}
function isEnglishAnnouncement(title, categoryText) {
    if (!containsCjk(title) && !containsCjk(categoryText)) {
        const upper = `${title} ${categoryText}`.toUpperCase();
        if (["ANNUAL REPORT", "INTERIM REPORT", "QUARTERLY REPORT", "QUARTERLY RESULTS"].some((t) => upper.includes(t))) {
            return true;
        }
    }
    return false;
}
function matchesStock(payload, target) {
    const tokens = new Set();
    const text = payload.replace(BR_RE, ",").replace(TAG_RE, "");
    for (const raw of text.split(/[,;，\s]+/)) {
        const digits = raw.replace(/\D/g, "");
        if (!digits)
            continue;
        tokens.add(digits.length <= 4 ? digits.padStart(5, "0") : digits);
    }
    return tokens.has(target);
}
function buildAbsoluteUrl(fileLink) {
    const text = fileLink.trim();
    if (text.startsWith("http://") || text.startsWith("https://"))
        return text;
    if (text.startsWith("/"))
        return `${HKEXNEWS_BASE_URL}${text}`;
    return `${HKEXNEWS_BASE_URL}/${text}`;
}
async function fetchStockMapping() {
    if (stockMappingCache)
        return stockMappingCache;
    const mapping = {};
    for (const url of [HKEXNEWS_ACTIVE_STOCK_URL, HKEXNEWS_INACTIVE_STOCK_URL]) {
        const payload = await httpGetJson(url);
        for (const raw of extractRows(payload)) {
            const entry = parseStockMappingEntry(raw);
            if (entry && !mapping[entry.stockCode]) {
                mapping[entry.stockCode] = entry;
            }
        }
    }
    stockMappingCache = mapping;
    return mapping;
}
async function resolveCompany(ticker) {
    const stockCode = toHkexStockCode(ticker);
    const mapping = await fetchStockMapping();
    const entry = mapping[stockCode];
    if (!entry)
        throw new Error(`披露易 stock list 未命中 ticker=${ticker}`);
    return {
        provider: "hkexnews",
        companyId: `HKEX:${entry.stockId}`,
        companyName: entry.companyName,
        ticker,
    };
}
async function listCandidates(ticker, profile, targetPeriods, window) {
    const stockId = profile.companyId.replace("HKEX:", "");
    const stockCode = toHkexStockCode(ticker);
    const categoryGroups = new Map();
    for (const period of targetPeriods) {
        const spec = PERIOD_TO_CATEGORY[period];
        const key = `${spec.t1code}:${spec.t2Gcode}:${spec.t2code}`;
        const list = categoryGroups.get(key) ?? [];
        if (!list.includes(period))
            list.push(period);
        categoryGroups.set(key, list);
    }
    const grouped = new Map();
    for (const [, requestedPeriods] of categoryGroups) {
        const firstPeriod = requestedPeriods[0];
        const spec = PERIOD_TO_CATEGORY[firstPeriod];
        const payload = await httpGetJson(HKEXNEWS_TITLE_SEARCH_URL, {
            lang: "zh",
            category: "0",
            market: "SEHK",
            stockId,
            searchType: "1",
            documentType: "-1",
            t1code: spec.t1code,
            t2Gcode: spec.t2Gcode,
            t2code: spec.t2code,
            fromDate: window.startDate.replace(/-/g, ""),
            toDate: window.endDate.replace(/-/g, ""),
            "MB-Daterange": "0",
            rowRange: "100",
            sortByOptions: "DateTime",
            sortDir: "0",
        });
        for (const raw of extractRows(payload)) {
            if (typeof raw !== "object" || raw === null)
                continue;
            const r = raw;
            const fileType = firstText(r, ["FILE_TYPE", "fileType", "file_type"]);
            if (fileType && fileType.toUpperCase() !== "PDF")
                continue;
            const documentId = firstText(r, ["NEWS_ID", "newsId", "DOC_ID", "docID", "documentId", "id", "SEQUENCE"]);
            const title = stripHtml(firstText(r, ["TITLE", "title", "LONG_TEXT", "longText"]) ?? "");
            const fileLink = firstText(r, ["FILE_LINK", "fileLink", "url"]);
            const stockCodePayload = firstText(r, ["STOCK_CODE", "stockCode", "stock_code"]) ?? "";
            const categoryText = stripHtml(firstText(r, ["LONG_TEXT", "longText", "SHORT_TEXT", "shortText"]) ?? "");
            const rawDate = firstText(r, ["DATE_TIME", "RELEASE_TIME", "dateTime", "releaseTime"]);
            const filingDate = parseFilingDate(rawDate ?? null);
            if (!documentId || !title || !fileLink || !stockCodePayload || !filingDate)
                continue;
            if (!matchesStock(stockCodePayload, stockCode))
                continue;
            if (isEnglishAnnouncement(title, categoryText))
                continue;
            const inferredPeriod = inferPeriodFromText(title, categoryText);
            if (!inferredPeriod || !requestedPeriods.includes(inferredPeriod))
                continue;
            const fiscalYear = inferFiscalYearFromTitle(title, filingDate);
            if (fiscalYear === null)
                continue;
            const key = `${inferredPeriod}:${fiscalYear}`;
            const list = grouped.get(key) ?? [];
            list.push({ documentId, title, fileLink, stockCodePayload, categoryText, filingDate });
            grouped.set(key, list);
        }
    }
    const candidates = [];
    for (const [key, items] of grouped) {
        const [periodStr, yearStr] = key.split(":");
        const period = periodStr;
        const fiscalYear = parseInt(yearStr, 10);
        const best = items.length > 0
            ? items.reduce((b, item) => {
                const bScore = (0, title_filter_1.isAmendedTitle)(b.title) ? 1 : 0;
                const iScore = (0, title_filter_1.isAmendedTitle)(item.title) ? 1 : 0;
                if (iScore > bScore)
                    return item;
                if (iScore === bScore && item.filingDate > b.filingDate)
                    return item;
                return b;
            })
            : null;
        if (!best)
            continue;
        const sourceUrl = buildAbsoluteUrl(best.fileLink);
        candidates.push({
            provider: "hkexnews",
            sourceId: best.documentId,
            sourceUrl,
            title: best.title,
            filingDate: best.filingDate,
            fiscalYear,
            fiscalPeriod: period,
            amended: (0, title_filter_1.isAmendedTitle)(best.title),
        });
    }
    candidates.sort((a, b) => {
        if (a.fiscalYear !== b.fiscalYear)
            return b.fiscalYear - a.fiscalYear;
        return PERIOD_SORT[a.fiscalPeriod] - PERIOD_SORT[b.fiscalPeriod];
    });
    return candidates;
}
async function downloadPdf(candidate) {
    const payload = await httpDownloadBytes(candidate.sourceUrl);
    if (payload.length < PDF_MIN_BYTES) {
        throw new Error(`PDF 字节数过小 (${payload.length} bytes)`);
    }
    if (!payload.slice(0, 5).equals(PDF_MAGIC)) {
        throw new Error("PDF magic bytes 校验失败");
    }
    return payload;
}
