/**
 * ========================================================
 * TVBox JS0/drpy2 爬虫 - xvideos.com 视频源
 * ========================================================
 * 对应 Python 版: tvbox_attack_spider.py
 * TVBox 配置 (填入 zhixvideos.json 的 sites 数组):
 *   {
 *       "key": "attack_spider",
 *       "name": "安全测试爬虫",
 *       "type": 3,
 *       "api": "./scripts/tvbox_attack_spider.js",
 *       "searchable": 1,
 *       "quickSearch": 1,
 *       "changeable": 1,
 *       "ext": {
 *           "base_url": "https://www.xvideos.com",
 *           "嗅探词": "m3u8#.mp4#setVideoUrlHigh#setVideoUrlLow",
 *           "并发数": "5"
 *       }
 *   }
 * ========================================================
 */

// ========================================================
// TVBox 真实客户端 UA 池
// ========================================================
const TVBOX_UA_POOL = [
    "okhttp/3.12",
    "okhttp/3.15",
    "Dalvik/2.1.0 (Linux; U; Android 11; MI 10 Pro Build/RKQ1.200826.002)",
    "Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)",
    "Dalvik/2.1.0 (Linux; U; Android 10; V1962A Build/QP1A.190711.020)",
    "Mozilla/5.0 (Linux; Android 9; V2196A Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36;tvbox/1.0",
    "Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.023; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/96.0.4664.104 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 9; TV BOX Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36",
];

let siteKey = '';
let siteType = 0;

/**
 * 安全获取配置中的 ext 对象
 */
function getExt() {
    try {
        return typeof ext !== "undefined" ? ext : {};
    } catch (e) {
        return {};
    }
}

/**
 * 获取基础 URL
 */
function getBaseUrl() {
    const cfg = getExt();
    return cfg.base_url || "https://www.xvideos.com";
}

/**
 * 获取随机 UA
 */
function randomUA() {
    return TVBOX_UA_POOL[Math.floor(Math.random() * TVBOX_UA_POOL.length)];
}

/**
 * 修复 URL 占位符
 */
function sanitizeUrl(url) {
    if (!url) return "";
    return url
        .replace(/THUMBNUM/g, "0")
        .replace(/\{catePg\}/g, "1")
        .replace(/\{pg\}/g, "1")
        .replace(/\{[^}]+\}/g, "0");
}

/**
 * 清理 HTML 实体
 */
function cleanTitle(title) {
    if (!title) return "";
    return title
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&nbsp;/g, " ")
        .trim();
}

/**
 * 从 HTML 中提取视频直链
 */
function extractDirectLinks(html) {
    const links = [];
    const seen = new Set();

    // 方法1: setVideoUrlHigh (高清)
    let m;
    const highRe = /setVideoUrlHigh\s*\(\s*'([^']+)'\s*\)/g;
    while ((m = highRe.exec(html)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); links.push({ name: "高清MP4", url: m[1] }); }
    }

    // 方法2: setVideoUrlLow (标清)
    const lowRe = /setVideoUrlLow\s*\(\s*'([^']+)'\s*\)/g;
    while ((m = lowRe.exec(html)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); links.push({ name: "标清MP4", url: m[1] }); }
    }

    // 方法3: m3u8
    const hlsRe = /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>,]*/g;
    let hlsCount = 0;
    while ((m = hlsRe.exec(html)) !== null) {
        if (!seen.has(m[0])) { seen.add(m[0]); links.push({ name: "HLS流", url: m[0] }); hlsCount++; }
        if (hlsCount >= 2) break;
    }

    // 方法4: mp4
    const mp4Re = /https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>,]*/g;
    let mp4Count = 0;
    while ((m = mp4Re.exec(html)) !== null) {
        if (!seen.has(m[0]) && !m[0].includes("preview")) {
            seen.add(m[0]); links.push({ name: "MP4直链", url: m[0] }); mp4Count++;
        }
        if (mp4Count >= 3) break;
    }

    return links;
}


// ========================================================
// JS0 标准接口
// ========================================================

/**
 * init() - 接收 TVBox 配置
 */
async function init(cfg) {
    siteKey = cfg.skey;
    siteType = cfg.stype;
}

/**
 * home() - 获取分类
 */
async function home() {
    return JSON.stringify({
        class: [
            { type_id: "/new/1", type_name: "最新视频" },
            { type_id: "/best/1", type_name: "最受欢迎" },
            { type_id: "/rated/1", type_name: "最高评分" },
            { type_id: "/popular-search", type_name: "热门搜索" },
        ],
        filters: {},
    });
}

/**
 * homeVod() - 首页推荐
 */
async function homeVod() {
    const baseUrl = getBaseUrl();
    try {
        const resp = await req(baseUrl + "/", { headers: { "User-Agent": randomUA() } });
        const html = resp.content || "";
        const vodList = [];

        // 提取视频块: 匹配缩略图、标题、链接、时长
        const blockRe = /<div\s+class="thumb-inside">[\s\S]*?<a\s+href="(\/video[^"]*)"[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<p\s+class="title">([^<]*)<\/p>[\s\S]*?(?:<span\s+class="duration">([^<]*)<\/span>)?/g;
        let m;
        while ((m = blockRe.exec(html)) !== null) {
            const path = m[1];
            let img = m[2] || "";
            const title = cleanTitle(m[3]);
            const duration = (m[4] || "").trim();
            if (img && !img.startsWith("http")) img = baseUrl + (img.startsWith("/") ? img : "/" + img);
            vodList.push({ vod_id: path, vod_name: title || "未知", vod_pic: img, vod_remarks: duration });
            if (vodList.length >= 40) break;
        }

        // 备用: 如果上面没匹配到，用更宽松的正则
        if (vodList.length === 0) {
            const fallbackRe = /<a\s+href="(\/video[^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?title="([^"]*)"[^>]*>/g;
            while ((m = fallbackRe.exec(html)) !== null) {
                const path = m[1];
                let img = m[2] || "";
                const title = cleanTitle(m[3]);
                if (img && !img.startsWith("http")) img = baseUrl + (img.startsWith("/") ? img : "/" + img);
                vodList.push({ vod_id: path, vod_name: title || "未知", vod_pic: img, vod_remarks: "" });
                if (vodList.length >= 40) break;
            }
        }

        return JSON.stringify({ list: vodList });
    } catch (e) {
        log("homeVod error: " + e.message);
        return JSON.stringify({ list: [] });
    }
}

/**
 * category(tid, pg) - 分类列表
 */
async function category(tid, pg) {
    const baseUrl = getBaseUrl();
    pg = pg || 1;
    if (pg <= 0) pg = 1;
    try {
        let url;
        if (tid === "/new/1" || tid === "/best/1" || tid === "/rated/1") {
            const base = tid.replace(/\/\d+$/, "");
            url = baseUrl + base + "/" + pg;
        } else {
            url = baseUrl + (tid.startsWith("/") ? tid : "/" + tid);
        }

        const resp = await req(url, { headers: { "User-Agent": randomUA() } });
        const html = resp.content || "";
        const vodList = [];

        const linkRe = /<a\s+href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
        let m;
        while ((m = linkRe.exec(html)) !== null) {
            vodList.push({ vod_id: m[1], vod_name: cleanTitle(m[2]), vod_pic: "" });
        }

        // 备用: 如果上面没匹配到
        if (vodList.length === 0) {
            const fallbackRe = /<a\s+href="(\/video[^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>/g;
            while ((m = fallbackRe.exec(html)) !== null) {
                const path = m[1];
                let img = m[2] || "";
                if (img && !img.startsWith("http")) img = baseUrl + (img.startsWith("/") ? img : "/" + img);
                vodList.push({ vod_id: path, vod_name: "视频" + path.replace("/video", ""), vod_pic: img });
            }
        }

        // 去重
        const seen = new Set();
        const unique = [];
        for (const v of vodList) {
            if (!seen.has(v.vod_id)) { seen.add(v.vod_id); unique.push(v); }
        }

        return JSON.stringify({
            page: pg,
            pagecount: 100,
            limit: 30,
            total: 3000,
            list: unique,
        });
    } catch (e) {
        log("category error: " + e.message);
        return JSON.stringify({ page: pg, pagecount: 0, limit: 30, total: 0, list: [] });
    }
}

/**
 * detail(ids) - 详情 + 提取直链
 */
async function detail(ids) {
    const baseUrl = getBaseUrl();
    ids = sanitizeUrl(ids);
    try {
        const url = baseUrl + (ids.startsWith("/") ? ids : "/" + ids);
        const resp = await req(url, { headers: { "User-Agent": randomUA() } });
        const html = resp.content || "";

        // 标题
        let title = "";
        const t = html.match(/<title>([\s\S]*?)<\/title>/i);
        if (t) title = cleanTitle(t[1]).replace(/\s*-\s*xvideos\s*.*$/i, "");

        // 封面
        let pic = "";
        const og = html.match(/<meta\s+property="og:image"[^>]*content="([^"]*)"/i);
        if (og) pic = og[1];

        // 描述
        let desc = "";
        const d = html.match(/<meta\s+name="description"[^>]*content="([^"]*)"/i);
        if (d) desc = d[1].slice(0, 300);

        // 提取直链
        const playUrls = extractDirectLinks(html);

        const vod = {
            vod_id: ids,
            vod_name: title || "视频",
            vod_pic: pic || "",
            vod_content: desc || "",
            vod_remarks: playUrls.length > 0 ? "已解析" : "直链提取失败",
        };

        if (playUrls.length > 0) {
            const playFrom = playUrls.map((_, i) => "线路" + (i + 1)).join("$$$");
            const playUrl = playUrls.map(p => p.name + "$" + p.url).join("#");
            vod.vod_play_from = playFrom;
            vod.vod_play_url = playUrl;
        } else {
            // 没有直链时，把视频页面本身作为播放源
            vod.vod_play_from = "页面播放";
            vod.vod_play_url = "直接播放$" + url;
        }

        return JSON.stringify({ list: [vod] });
    } catch (e) {
        log("detail error: " + e.message);
        return JSON.stringify({
            list: [{
                vod_id: ids,
                vod_name: "加载失败",
                vod_pic: "",
                vod_remarks: "错误: " + e.message,
                vod_play_from: "源",
                vod_play_url: "播放$" + (baseUrl + (ids.startsWith("/") ? ids : "/" + ids)),
            }],
        });
    }
}

/**
 * search(wd, pg) - 搜索
 */
async function search(wd, pg) {
    const baseUrl = getBaseUrl();
    pg = pg || 1;
    try {
        const url = baseUrl + "/?k=" + encodeURIComponent(wd);
        const resp = await req(url, { headers: { "User-Agent": randomUA() } });
        const html = resp.content || "";
        const results = [];

        const re = /<a\s+href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            results.push({ vod_id: m[1], vod_name: cleanTitle(m[2]) });
            if (results.length >= 20) break;
        }

        return JSON.stringify({ list: results, page: pg });
    } catch (e) {
        log("search error: " + e.message);
        return JSON.stringify({ list: [], page: pg });
    }
}

/**
 * play(flag, id) - 播放
 */
async function play(flag, id) {
    return JSON.stringify({ parse: 0, url: id });
}


// ========================================================
// 导出 JS0 接口
// ========================================================
if (typeof module !== "undefined" && module.exports) {
    module.exports = { init, home, homeVod, category, detail, search, play };
}
