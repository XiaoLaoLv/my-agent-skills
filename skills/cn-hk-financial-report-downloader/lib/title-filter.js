"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTitleBlocked = isTitleBlocked;
exports.isAmendedTitle = isAmendedTitle;
exports.inferFiscalYear = inferFiscalYear;
const TITLE_BLOCKLIST = [
    "摘要", "已取消", "已撤销", "撤回", "取消", "更正前",
    "募集说明书", "ESG", "可持续发展", "审计报告", "财务报表", "意见",
    "（英文）", "(英文)", "英文)", "英文）", "英文版", "英文简版", "英文简本",
    "english", "港股公告", "h股公告", "h股",
];
const REPORT_NOTICE_TOKENS = ["公告", "提示性公告", "自愿性披露公告"];
const REPORT_TITLE_TOKENS = [
    "年度报告", "年报", "半年度报告", "一季度报告",
    "第一季度报告", "三季度报告", "第三季度报告",
];
const TITLE_AMENDED_TOKENS = ["更正", "更正后", "修订", "补充", "修正", "修訂", "補充", "REVISED", "SUPPLEMENTAL"];
function isTitleBlocked(title) {
    const lowered = title.toLowerCase();
    if (TITLE_BLOCKLIST.some((token) => lowered.includes(token.toLowerCase())))
        return true;
    if (_hasReportLanguageMarker(title))
        return true;
    const hasReportTitle = REPORT_TITLE_TOKENS.some((t) => title.includes(t));
    const hasNoticeTitle = REPORT_NOTICE_TOKENS.some((t) => title.includes(t));
    return hasReportTitle && hasNoticeTitle;
}
function _hasReportLanguageMarker(title) {
    if (!title.includes("英文"))
        return false;
    return REPORT_TITLE_TOKENS.some((t) => title.includes(t));
}
function isAmendedTitle(title) {
    const upper = title.toUpperCase();
    return TITLE_AMENDED_TOKENS.some((token) => upper.includes(token.toUpperCase()));
}
function inferFiscalYear(title, announcementDate) {
    const fyMatch = title.match(/(\d{4})\s*年[年度]?\s*(年度报告|年报)/);
    if (fyMatch)
        return parseInt(fyMatch[1], 10);
    const yearMatch = title.match(/(\d{4})\s*年/);
    if (yearMatch)
        return parseInt(yearMatch[1], 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(announcementDate))
        return parseInt(announcementDate.slice(0, 4), 10);
    return null;
}
