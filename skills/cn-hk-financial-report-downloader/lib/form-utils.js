"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FORMS = void 0;
exports.resolveTargetPeriods = resolveTargetPeriods;
exports.resolveWindow = resolveWindow;
exports.resolvePeriodWindow = resolvePeriodWindow;
exports.DEFAULT_FORMS = ["FY", "H1", "Q1", "Q2", "Q3", "Q4"];
const ANNUAL_LOOKBACK_YEARS = 5;
const INTERIM_LOOKBACK_YEARS = 2;
const LOOKBACK_GRACE_DAYS = 60;
const TOKEN_TO_PERIOD = {
    FY: "FY", ANNUAL: "FY", 年报: "FY", 年度报告: "FY",
    H1: "H1", "1H": "H1", 半年报: "H1", 中报: "H1",
    Q1: "Q1", "1Q": "Q1", 一季报: "Q1", 一季度报告: "Q1",
    Q2: "Q2", "2Q": "Q2", 二季报: "Q2", 二季度报告: "Q2",
    Q3: "Q3", "3Q": "Q3", 三季报: "Q3", 三季度报告: "Q3",
    Q4: "Q4", "4Q": "Q4", 四季报: "Q4", 四季度报告: "Q4",
};
function resolveTargetPeriods(rawForms) {
    if (!rawForms)
        return [...exports.DEFAULT_FORMS];
    const tokens = rawForms.split(/[,，\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    const seen = new Set();
    const canonicalOrder = ["FY", "H1", "Q1", "Q2", "Q3", "Q4"];
    for (const token of tokens) {
        const period = TOKEN_TO_PERIOD[token];
        if (period)
            seen.add(period);
    }
    if (seen.size === 0)
        return [...exports.DEFAULT_FORMS];
    return canonicalOrder.filter((p) => seen.has(p));
}
function subtractYears(date, years) {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() - years);
    if (result.getMonth() !== date.getMonth()) {
        result.setDate(28);
    }
    return result;
}
function formatDate(d) {
    const yyyy = d.getFullYear().toString().padStart(4, "0");
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}
function parseDate(value, isEnd) {
    const raw = value.trim();
    if (/^\d{4}$/.test(raw)) {
        const y = parseInt(raw, 10);
        return isEnd ? new Date(y, 11, 31) : new Date(y, 0, 1);
    }
    if (/^\d{4}-\d{1,2}$/.test(raw)) {
        const [y, m] = raw.split("-").map(Number);
        if (isEnd) {
            const next = m === 12 ? new Date(y + 1, 0, 1) : new Date(y, m, 1);
            return new Date(next.getTime() - 86400000);
        }
        return new Date(y, m - 1, 1);
    }
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
        const [y, m, d] = raw.split("-").map(Number);
        return new Date(y, m - 1, d);
    }
    throw new Error(`日期格式非法: ${value}`);
}
function resolveWindow(startDate, endDate, today) {
    const anchor = today ?? new Date();
    const end = endDate ? parseDate(endDate, true) : anchor;
    const start = startDate
        ? parseDate(startDate, false)
        : new Date(subtractYears(end, ANNUAL_LOOKBACK_YEARS).getTime() - LOOKBACK_GRACE_DAYS * 86400000);
    if (start > end)
        throw new Error(`start_date 不能晚于 end_date: ${formatDate(start)} > ${formatDate(end)}`);
    return { startDate: formatDate(start), endDate: formatDate(end) };
}
function resolvePeriodWindow(period, window, explicitStart) {
    if (explicitStart)
        return window;
    const end = parseDate(window.endDate, true);
    const lookback = period === "FY" ? ANNUAL_LOOKBACK_YEARS : INTERIM_LOOKBACK_YEARS;
    const start = new Date(subtractYears(end, lookback).getTime() - LOOKBACK_GRACE_DAYS * 86400000);
    if (start > end)
        return window;
    return { startDate: formatDate(start), endDate: window.endDate };
}
