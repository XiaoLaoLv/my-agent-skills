"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTicker = normalizeTicker;
const CN_PREFIXES = {
    "000": "SZSE",
    "001": "SZSE",
    "002": "SZSE",
    "003": "SZSE",
    "300": "SZSE",
    "301": "SZSE",
    "600": "SSE",
    "601": "SSE",
    "603": "SSE",
    "605": "SSE",
    "688": "SSE",
};
function stripPrefixSuffix(raw) {
    const s = raw.trim();
    const prefixMatch = s.match(/^(?:HKEX|HK|SSE|SH|SS|SZSE|SZ)[.:\-_]?(.+)$/i);
    if (prefixMatch) {
        const token = s.match(/^(HKEX|HK|SSE|SH|SS|SZSE|SZ)/i)[1].toUpperCase();
        const core = prefixMatch[1];
        if (["HK", "HKEX"].includes(token))
            return { core, market: "HK" };
        if (["SH", "SS", "SSE", "SZ", "SZSE"].includes(token))
            return { core, market: "CN" };
    }
    const suffixSepMatch = s.match(/^(.+?)[.\-_](HKEX|HK|SSE|SH|SS|SZSE|SZ|NASDAQ|NYSE|OQ|PK|US|N|O)$/i);
    if (suffixSepMatch) {
        const token = suffixSepMatch[2].toUpperCase();
        const core = suffixSepMatch[1];
        if (["HK", "HKEX"].includes(token))
            return { core, market: "HK" };
        if (["SH", "SS", "SSE", "SZ", "SZSE"].includes(token))
            return { core, market: "CN" };
    }
    const suffixNoSepMatch = s.match(/^(.+?)(HKEX|HK|SSE|SH|SS|SZSE|SZ|NASDAQ|NYSE|OQ|PK|US)$/i);
    if (suffixNoSepMatch) {
        const token = suffixNoSepMatch[2].toUpperCase();
        const core = suffixNoSepMatch[1];
        if (["HK", "HKEX"].includes(token))
            return { core, market: "HK" };
        if (["SH", "SS", "SSE", "SZ", "SZSE"].includes(token))
            return { core, market: "CN" };
    }
    return { core: s };
}
function normalizeTicker(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        throw new Error("ticker 不能为空");
    const { core, market: hintMarket } = stripPrefixSuffix(trimmed);
    const digits = core.replace(/\D/g, "");
    if (hintMarket === "HK" || /^\d{1,5}$/.test(digits) && digits.length <= 5 && !CN_PREFIXES[digits.slice(0, 3)]) {
        if (digits.length === 0)
            throw new Error(`HK ticker 缺少数字: ${raw}`);
        const canonical = digits.length <= 4 ? digits.padStart(4, "0") : digits;
        return { canonical, market: "HK", exchange: "HKEX", raw: trimmed };
    }
    if (digits.length === 6) {
        const prefix = digits.slice(0, 3);
        const exchange = CN_PREFIXES[prefix];
        if (exchange) {
            return { canonical: digits, market: "CN", exchange, raw: trimmed };
        }
        throw new Error(`未支持的 A 股前缀 ${prefix}（ticker=${raw}）`);
    }
    if (hintMarket === "CN") {
        throw new Error(`A 股 ticker 必须为 6 位数字: ${raw}`);
    }
    throw new Error(`无法识别的 ticker: ${raw}`);
}
