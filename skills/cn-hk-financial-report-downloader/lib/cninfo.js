"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCompany = resolveCompany;
exports.listCandidates = listCandidates;
exports.downloadPdf = downloadPdf;
const title_filter_1 = require("./title-filter");
const CNINFO_BASE_URL = "http://www.cninfo.com.cn";
const CNINFO_STATIC_BASE_URL = "http://static.cninfo.com.cn/";
const CNINFO_STOCK_JSON_URL = `${CNINFO_BASE_URL}/new/data/szse_stock.json`;
const CNINFO_QUERY_URL = `${CNINFO_BASE_URL}/new/hisAnnouncement/query`;
const PERIOD_TO_CATEGORY = {
    FY: "category_ndbg_szsh;",
    H1: "category_bndbg_szsh;",
    Q1: "category_yjdbg_szsh;",
    Q3: "category_sjdbg_szsh;",
};
const UNSUPPORTED_PERIODS = new Set(["Q2", "Q4"]);
const TICKER_PREFIX_TO_MARKET = {
    "000": { column: "szse", plate: "sz" },
    "001": { column: "szse", plate: "sz" },
    "002": { column: "szse", plate: "sz" },
    "003": { column: "szse", plate: "sz" },
    "300": { column: "szse", plate: "sz" },
    "301": { column: "szse", plate: "sz" },
    "600": { column: "sse", plate: "sh" },
    "601": { column: "sse", plate: "sh" },
    "603": { column: "sse", plate: "sh" },
    "605": { column: "sse", plate: "sh" },
    "688": { column: "sse", plate: "sh" },
};
const PDF_MAGIC = Buffer.from("%PDF-");
const PDF_MIN_BYTES = 1024;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE = 0.8;
const SLEEP_SECONDS = 0.3;
const USER_AGENT = "OpenClaw-CN-HK-Skill/1.0";
const HTML_TAG_RE = /<[^>]+>/g;
let stockMappingCache = null;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
let lastRequestAt = 0;
async function throttle() {
    if (SLEEP_SECONDS <= 0)
        return;
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    const remaining = SLEEP_SECONDS * 1000 - elapsed;
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
async function httpGetJson(url) {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            await throttle();
            const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            markRequestDone();
            return json;
        }
        catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            await retryBackoff(attempt);
        }
    }
    throw new Error(`GET JSON 失败: url=${url} error=${lastError?.message}`);
}
async function httpPostForm(url, data) {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            await throttle();
            const body = new URLSearchParams(data);
            const resp = await fetch(url, {
                method: "POST",
                headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
                body,
            });
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            markRequestDone();
            return json;
        }
        catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            await retryBackoff(attempt);
        }
    }
    throw new Error(`POST form 失败: url=${url} error=${lastError?.message}`);
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
function cleanHtml(text) {
    return text.replace(HTML_TAG_RE, "").trim();
}
function formatAnnouncementDate(raw) {
    if (typeof raw === "number") {
        return new Date(raw).toISOString().slice(0, 10);
    }
    if (typeof raw === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw))
            return raw;
        if (/^\d+$/.test(raw))
            return new Date(parseInt(raw, 10)).toISOString().slice(0, 10);
    }
    return null;
}
function parseRawAnnouncement(raw) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const r = raw;
    const secCode = String(r.secCode ?? "").trim();
    const adjunctType = String(r.adjunctType ?? "").trim().toUpperCase();
    if (adjunctType !== "PDF")
        return null;
    const announcementId = String(r.announcementId ?? "").trim();
    const title = cleanHtml(String(r.announcementTitle ?? "").trim());
    const adjunctUrl = String(r.adjunctUrl ?? "").trim();
    const announcementDate = formatAnnouncementDate(r.announcementTime);
    if (!secCode || !announcementId || !title || !adjunctUrl || !announcementDate)
        return null;
    return { secCode, announcementId, title, announcementDate, adjunctUrl };
}
function resolveExchangeContext(ticker) {
    if (ticker.length !== 6 || !/^\d{6}$/.test(ticker)) {
        throw new Error(`巨潮仅支持 6 位 A 股代码，收到 ticker=${ticker}`);
    }
    const prefix = ticker.slice(0, 3);
    const ctx = TICKER_PREFIX_TO_MARKET[prefix];
    if (!ctx)
        throw new Error(`巨潮未支持的 A 股前缀 ${prefix}（ticker=${ticker}）`);
    return ctx;
}
async function fetchStockMapping() {
    if (stockMappingCache)
        return stockMappingCache;
    const payload = (await httpGetJson(CNINFO_STOCK_JSON_URL));
    const items = payload.stockList;
    if (!Array.isArray(items))
        throw new Error(`巨潮 stockList schema 异常`);
    const mapping = {};
    for (const raw of items) {
        if (typeof raw !== "object" || raw === null)
            continue;
        const r = raw;
        const code = String(r.code ?? "").trim();
        const orgId = String(r.orgId ?? "").trim();
        const companyName = String(r.zwjc ?? "").trim() || code;
        if (!code || !orgId)
            continue;
        mapping[code] = { code, orgId, companyName };
    }
    stockMappingCache = mapping;
    return mapping;
}
async function queryAnnouncements(opts) {
    const announcements = [];
    let pageNum = 1;
    while (true) {
        const payload = (await httpPostForm(CNINFO_QUERY_URL, {
            pageNum: String(pageNum),
            pageSize: "30",
            column: opts.column,
            tabName: "fulltext",
            plate: opts.plate,
            stock: `${opts.stock},${opts.orgId}`,
            searchkey: "",
            secid: "",
            category: opts.category,
            trade: "",
            seDate: `${opts.startDate}~${opts.endDate}`,
            sortName: "time",
            sortType: "desc",
            isHLtitle: "true",
        }));
        const items = payload.announcements;
        if (!Array.isArray(items) || items.length === 0)
            break;
        for (const raw of items) {
            const parsed = parseRawAnnouncement(raw);
            if (parsed && parsed.secCode === opts.stock)
                announcements.push(parsed);
        }
        const hasMore = !!payload.hasMore;
        if (!hasMore || pageNum > 50)
            break;
        pageNum++;
    }
    return announcements;
}
function pickBest(items) {
    if (items.length === 0)
        return null;
    return items.reduce((best, item) => {
        const bestScore = (0, title_filter_1.isAmendedTitle)(best.title) ? 1 : 0;
        const itemScore = (0, title_filter_1.isAmendedTitle)(item.title) ? 1 : 0;
        if (itemScore > bestScore)
            return item;
        if (itemScore === bestScore && item.announcementDate > best.announcementDate)
            return item;
        return best;
    });
}
const PERIOD_SORT = { FY: 0, H1: 1, Q1: 2, Q2: 3, Q3: 4, Q4: 5 };
async function resolveCompany(ticker) {
    const ctx = resolveExchangeContext(ticker);
    const mapping = await fetchStockMapping();
    const entry = mapping[ticker];
    if (!entry)
        throw new Error(`巨潮 stockList 未命中 ticker=${ticker}`);
    return {
        provider: "cninfo",
        companyId: `CNINFO:${entry.orgId}`,
        companyName: entry.companyName,
        ticker,
    };
}
async function listCandidates(ticker, profile, targetPeriods, window) {
    const ctx = resolveExchangeContext(ticker);
    const orgId = profile.companyId.replace("CNINFO:", "");
    const grouped = new Map();
    for (const period of targetPeriods) {
        const category = PERIOD_TO_CATEGORY[period];
        if (!category) {
            if (UNSUPPORTED_PERIODS.has(period))
                continue;
            continue;
        }
        const items = await queryAnnouncements({
            column: ctx.column,
            plate: ctx.plate,
            stock: ticker,
            orgId,
            category,
            startDate: window.startDate,
            endDate: window.endDate,
        });
        for (const item of items) {
            if ((0, title_filter_1.isTitleBlocked)(item.title))
                continue;
            const fiscalYear = (0, title_filter_1.inferFiscalYear)(item.title, item.announcementDate);
            if (fiscalYear === null)
                continue;
            const key = `${period}:${fiscalYear}`;
            const list = grouped.get(key) ?? [];
            list.push(item);
            grouped.set(key, list);
        }
    }
    const candidates = [];
    for (const [key, items] of grouped) {
        const [periodStr, yearStr] = key.split(":");
        const period = periodStr;
        const fiscalYear = parseInt(yearStr, 10);
        const best = pickBest(items);
        if (!best)
            continue;
        const sourceUrl = CNINFO_STATIC_BASE_URL + best.adjunctUrl.replace(/^\//, "");
        candidates.push({
            provider: "cninfo",
            sourceId: best.announcementId,
            sourceUrl,
            title: best.title,
            filingDate: best.announcementDate,
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
