"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_util_1 = require("node:util");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const ticker_1 = require("../lib/ticker");
const form_utils_1 = require("../lib/form-utils");
const cninfo_1 = require("../lib/cninfo");
const hkexnews_1 = require("../lib/hkexnews");
async function main() {
    const { values } = (0, node_util_1.parseArgs)({
        options: {
            ticker: { type: "string", required: true },
            "output-dir": { type: "string", required: true },
            forms: { type: "string" },
            "start-date": { type: "string" },
            "end-date": { type: "string" },
            help: { type: "boolean", short: "h" },
        },
        strict: true,
    });
    if (values.help) {
        console.log(`Usage: node scripts/download.js --ticker <code> --output-dir <dir> [--forms FY,H1] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]`);
        process.exit(0);
    }
    const ticker = values.ticker;
    const outputDir = values["output-dir"];
    const formsRaw = values.forms;
    const startDate = values["start-date"];
    const endDate = values["end-date"];
    const normalized = (0, ticker_1.normalizeTicker)(ticker);
    const targetPeriods = (0, form_utils_1.resolveTargetPeriods)(formsRaw);
    const window = (0, form_utils_1.resolveWindow)(startDate, endDate);
    const tickerDir = (0, node_path_1.join)(outputDir, normalized.canonical);
    await (0, promises_1.mkdir)(tickerDir, { recursive: true });
    console.error(`[info] ticker=${normalized.canonical} market=${normalized.market} exchange=${normalized.exchange}`);
    console.error(`[info] periods=${targetPeriods.join(",")} window=${window.startDate}~${window.endDate}`);
    console.error(`[info] output=${tickerDir}`);
    const isCn = normalized.market === "CN";
    const resolve = isCn ? cninfo_1.resolveCompany : hkexnews_1.resolveCompany;
    const list = isCn ? cninfo_1.listCandidates : hkexnews_1.listCandidates;
    const download = isCn ? cninfo_1.downloadPdf : hkexnews_1.downloadPdf;
    const profile = await resolve(normalized.canonical);
    console.error(`[info] company=${profile.companyName} (${profile.companyId})`);
    const unsupportedPeriods = isCn ? ["Q2", "Q4"] : [];
    const effectivePeriods = targetPeriods.filter((p) => !unsupportedPeriods.includes(p));
    const candidates = await list(normalized.canonical, profile, effectivePeriods, window);
    const filings = [];
    for (const period of unsupportedPeriods.filter((p) => targetPeriods.includes(p))) {
        filings.push({
            documentId: "",
            status: "skipped",
            fiscalYear: 0,
            fiscalPeriod: period,
            filingDate: "",
            filePath: null,
            reasonCode: "unsupported_period",
            reasonMessage: `巨潮暂无独立 ${period} 分类`,
        });
    }
    for (const candidate of candidates) {
        const periodWindow = (0, form_utils_1.resolvePeriodWindow)(candidate.fiscalPeriod, window, startDate);
        if (candidate.filingDate < periodWindow.startDate || candidate.filingDate > periodWindow.endDate) {
            filings.push(buildFiling(candidate, "skipped", "outside_window", "不在业务窗口内"));
            continue;
        }
        const suffix = candidate.amended ? "_amended" : "";
        const filename = `${candidate.fiscalPeriod}_${candidate.fiscalYear}${suffix}.pdf`;
        const filePath = (0, node_path_1.join)(tickerDir, filename);
        try {
            const pdfBytes = await download(candidate);
            await (0, promises_1.writeFile)(filePath, pdfBytes);
            filings.push({
                documentId: candidate.sourceId,
                status: "downloaded",
                fiscalYear: candidate.fiscalYear,
                fiscalPeriod: candidate.fiscalPeriod,
                filingDate: candidate.filingDate,
                filePath,
                reasonCode: null,
                reasonMessage: null,
            });
            console.error(`[ok] ${candidate.fiscalPeriod} ${candidate.fiscalYear} -> ${filename}`);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            filings.push(buildFiling(candidate, "failed", "download_error", msg));
            console.error(`[fail] ${candidate.fiscalPeriod} ${candidate.fiscalYear}: ${msg}`);
        }
    }
    const missing = effectivePeriods.filter((p) => !filings.some((f) => f.fiscalPeriod === p && (f.status === "downloaded" || f.status === "skipped")));
    for (const period of missing) {
        const year = new Date().getFullYear();
        filings.push({
            documentId: "",
            status: "skipped",
            fiscalYear: year,
            fiscalPeriod: period,
            filingDate: "",
            filePath: null,
            reasonCode: "candidate_not_found",
            reasonMessage: "主源未返回对应财期报告",
        });
    }
    const result = {
        ticker: normalized.canonical,
        companyName: profile.companyName,
        filings,
        summary: {
            total: filings.length,
            downloaded: filings.filter((f) => f.status === "downloaded").length,
            skipped: filings.filter((f) => f.status === "skipped").length,
            failed: filings.filter((f) => f.status === "failed").length,
        },
    };
    console.log(JSON.stringify(result, null, 2));
}
function buildFiling(candidate, status, reasonCode, reasonMessage) {
    return {
        documentId: candidate.sourceId,
        status,
        fiscalYear: candidate.fiscalYear,
        fiscalPeriod: candidate.fiscalPeriod,
        filingDate: candidate.filingDate,
        filePath: null,
        reasonCode,
        reasonMessage,
    };
}
main().catch((e) => {
    console.error(`[fatal] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
});
