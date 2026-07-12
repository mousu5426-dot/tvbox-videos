/**
 * ========================================================
 * TVBox 实战级爬虫 - JS0/drpy2 风格 - 模拟攻击者行为
 * ========================================================
 * 攻击场景:
 *   攻击者在 TVBox 配置中添加一个 JS 爬虫源
 *   爬虫引擎自动执行 JS0 接口采集
 *   服务器无法区分爬虫和真实 TVBox 用户
 *
 * 对应 Python 版: tvbox_attack_spider.py
 * 本文件为 JS0/drpy2 标准接口实现，可直接被 TVBox 加载
 *
 * 关键隐蔽技术:
 *   1. 请求特征 = 真实 TVBox 客户端（UA/Headers）
 *   2. 随机间隔 = 看起来像正常用户操作节奏
 *   3. 渐进式采集 = 先采集元数据，延迟后再取直链
 *   4. 错误重试 + 优雅降级 = 像真实用户在操作
 * ========================================================
 */

// ========================================================
// TVBox 真实客户端特征池
// ========================================================
const TVBOX_UA_POOL = [
    // TVBox okhttp 原生
    "okhttp/3.12",
    "okhttp/3.15",
    "okhttp/4.9.3",
    "Dalvik/2.1.0 (Linux; U; Android 11; MI 10 Pro Build/RKQ1.200826.002)",
    "Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)",
    "Dalvik/2.1.0 (Linux; U; Android 10; V1962A Build/QP1A.190711.020)",
    // FongMi TVBox
    "Mozilla/5.0 (Linux; Android 9; V2196A Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36;tvbox/1.0",
    // Pluto TVBox
    "Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.023; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/96.0.4664.104 Mobile Safari/537.36",
    // 影视TV
    "Mozilla/5.0 (Linux; Android 9; TV BOX Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36",
    // 猫影视
    "Mozilla/5.0 (Linux; U; Android 4.4.2; zh-cn; X96 Max Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Safari/537.36",
];

// TVBox 常见请求头模板
const TVBOX_HEADERS_TEMPLATES = [
    {
        "User-Agent": "okhttp/3.12",
        "Accept-Encoding": "gzip",
        "Connection": "close",
    },
    {
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 11; MI 10 Pro Build/RKQ1.200826.002)",
        "Accept-Encoding": "gzip",
        "Connection": "Keep-Alive",
    },
    {
        "User-Agent": "Mozilla/5.0 (Linux; Android 9; V2196A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36;tvbox/1.0",
        "Referer": "http://127.0.0.1:8080/",
        "Accept-Encoding": "gzip, deflate",
    },
];

function randomHeaders(referer) {
    const tmpl = TVBOX_HEADERS_TEMPLATES[Math.floor(Math.random() * TVBOX_HEADERS_TEMPLATES.length)];
    const headers = Object.assign({}, tmpl);
    if (referer) headers["Referer"] = referer;
    if (Math.random() < 0.3) headers["X-Requested-With"] = "TVBox";
    if (Math.random() < 0.2) headers["Cache-Control"] = "no-cache";
    return headers;
}

function randomDelay() {
    const ms = 500 + Math.floor(Math.random() * 1500);
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getExt() {
    try { return typeof ext !== "undefined" ? ext : {}; } catch (e) { return {}; }
}

function getBaseUrl() {
    const cfg = getExt();
    return cfg.base_url || "http://127.0.0.1:8080";
}

function cleanTitle(title) {
    if (!title) return "";
    return title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/").replace(/&nbsp;/g, " ").trim();
}

function sanitizeUrl(url) {
    if (!url) return "";
    return url.replace(/THUMBNUM/g, "0").replace(/\{catePg\}/g, "1")
        .replace(/\{pg\}/g, "1").replace(/\{[^}]+\}/g, "0");
}

function tvboxRequest(url, referer, options = {}) {
    const headers = randomHeaders(referer);
    const reqOpts = { headers: headers, timeout: options.timeout || 30, redirect: options.redirect !== undefined ? options.redirect : true };
    if (options.method) reqOpts.method = options.method;
    if (options.body) reqOpts.body = options.body;
    return req(url, reqOpts);
}

function extractDirectLinks(html) {
    const links = [];
    const seen = new Set();
    // setVideoUrlHigh
    const highMatches = html.match(/setVideoUrlHigh\s*\(\s*'([^']+)'\s*\)/g);
    if (highMatches) {
        for (const m of highMatches) {
            const u = m.replace(/setVideoUrlHigh\s*\(\s*'([^']+)'\s*\)/, "$1");
            if (u && !seen.has(u)) { seen.add(u); links.push({ name: "高清MP4", url: u }); }
        }
    }
    // setVideoUrlLow
    const lowMatches = html.match(/setVideoUrlLow\s*\(\s*'([^']+)'\s*\)/g);
    if (lowMatches) {
        for (const m of lowMatches) {
            const u = m.replace(/setVideoUrlLow\s*\(\s*'([^']+)'\s*\)/, "$1");
            if (u && !seen.has(u)) { seen.add(u); links.push({ name: "标清MP4", url: u }); }
        }
    }
    // m3u8
    const hlsRegex = /https?:\/\/[^"\'<>\s]+\.m3u8[^"\'<>\s,]*/g;
    let hlsMatch;
    while ((hlsMatch = hlsRegex.exec(html)) !== null) {
        const u = hlsMatch[0];
        if (!seen.has(u)) { seen.add(u); links.push({ name: "HLS流", url: u }); if (links.filter(l => l.name === "HLS流").length >= 2) break; }
    }
    // mp4
    const mp4Regex = /https?:\/\/[^"\'<>\s]+\.mp4[^"\'<>\s,]*/g;
    let mp4Match;
    while ((mp4Match = mp4Regex.exec(html)) !== null) {
        const u = mp4Match[0];
        if (!seen.has(u) && !u.includes("preview")) { seen.add(u); links.push({ name: "MP4直链", url: u }); if (links.filter(l => l.name === "MP4直链").length >= 3) break; }
    }
    return links;
}

async function home() {
    await randomDelay();
    const baseUrl = getBaseUrl();
    try {
        const resp = await tvboxRequest(baseUrl + "/");
        const html = resp.content || resp.text || "";
        const catRegex = /<a\s+href="(\/[^"]*)"[^>]*>([^<]*)<\/a>/g;
        const categories = [];
        const seen = new Set();
        let match;
        while ((match = catRegex.exec(html)) !== null) {
            let name = cleanTitle(match[2]);
            if (name && !seen.has(name) && name.length < 20 && !name.includes("首页") && !name.includes("上一页") && !name.includes("下一页")) {
                seen.add(name);
                categories.push({ type_id: match[1], type_name: name });
            }
        }
        return { class: categories.slice(0, 20) };
    } catch (e) {
        log("home() 错误: " + e.message);
        return { class: [] };
    }
}

async function homeVod() {
    await randomDelay();
    const baseUrl = getBaseUrl();
    try {
        const resp = await tvboxRequest(baseUrl + "/");
        const html = resp.content || resp.text || "";
        const vodList = [];
        const blockRegex = /<a\s+href="(\/video[^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?title="([^"]*)"[^>]*>[\s\S]*?<span\s+class="duration">([^<]*)<\/span>/g;
        let match;
        while ((match = blockRegex.exec(html)) !== null) {
            let img = match[2];
            if (img && !img.startsWith("http")) img = baseUrl + (img.startsWith("/") ? img : "/" + img);
            vodList.push({ vod_id: match[1], vod_name: cleanTitle(match[3]), vod_pic: img || "", vod_remarks: match[4].trim() });
            if (vodList.length >= 40) break;
        }
        return { list: vodList };
    } catch (e) {
        log("homeVod() 错误: " + e.message);
        return { list: [] };
    }
}

async function category(tid, pg) {
    await randomDelay();
    const baseUrl = getBaseUrl();
    try {
        let url = pg > 1 ? baseUrl + "/new/" + pg : baseUrl + (tid.startsWith("/") ? tid : "/" + tid);
        const resp = await tvboxRequest(url);
        const html = resp.content || resp.text || "";
        const videoRegex = /<a\s+href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
        const vodList = [];
        let match;
        while ((match = videoRegex.exec(html)) !== null) {
            vodList.push({ vod_id: match[1], vod_name: cleanTitle(match[2]), vod_pic: "" });
        }
        return { page: pg, pagecount: 1000, list: vodList };
    } catch (e) {
        log("category() 错误: " + e.message);
        return { page: pg, pagecount: 0, list: [] };
    }
}

async function detail(ids) {
    await randomDelay();
    const baseUrl = getBaseUrl();
    ids = sanitizeUrl(ids);
    try {
        const url = baseUrl + (ids.startsWith("/") ? ids : "/" + ids);
        const resp = await tvboxRequest(url, baseUrl + "/");
        const html = resp.content || resp.text || "";
        const vod = {};
        const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) vod.vod_name = cleanTitle(titleMatch[1]);
        const ogImgMatch = html.match(/<meta\s+property="og:image"[^>]*content="([^"]*)"/i);
        if (ogImgMatch) vod.vod_pic = ogImgMatch[1];
        const tagRegex = /<a\s+href="\/(?:c|tags|kw)\/([^"]*)"[^>]*>([^<]*)<\/a>/g;
        const tags = [];
        let tagMatch;
        while ((tagMatch = tagRegex.exec(html)) !== null) { if (tagMatch[2].trim()) tags.push(tagMatch[2].trim()); }
        if (tags.length > 0) vod.vod_tag = [...new Set(tags)].slice(0, 20).join(";");
        const descMatch = html.match(/<meta\s+name="description"[^>]*content="([^"]*)"/i);
        if (descMatch) vod.vod_content = descMatch[1].slice(0, 300);
        const playUrls = extractDirectLinks(html);
        if (playUrls.length > 0) {
            const playFrom = playUrls.map((_, i) => "线路" + (i + 1)).join("$$$");
            const playUrl = playUrls.map(p => p.name + "$" + p.url).join("#");
            vod.vod_play_from = playFrom;
            vod.vod_play_url = playUrl;
        }
        return vod;
    } catch (e) {
        log("detail() 错误: " + e.message + " (ids=" + ids + ")");
        return {};
    }
}

async function search(wd, pg) {
    await randomDelay();
    const baseUrl = getBaseUrl();
    try {
        const url = baseUrl + "/?k=" + encodeURIComponent(wd);
        const resp = await tvboxRequest(url);
        const html = resp.content || resp.text || "";
        const videoRegex = /<a\s+href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
        const results = [];
        let match;
        while ((match = videoRegex.exec(html)) !== null) {
            results.push({ vod_id: match[1], vod_name: cleanTitle(match[2]) });
            if (results.length >= 20) break;
        }
        return { list: results, page: pg || 1 };
    } catch (e) {
        log("search() 错误: " + e.message);
        return { list: [], page: pg || 1 };
    }
}

async function play(flag, id) {
    return { playUrl: id, parse: 0 };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { home, homeVod, category, detail, search, play };
}
