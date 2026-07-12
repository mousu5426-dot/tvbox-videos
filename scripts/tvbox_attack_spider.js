/** TVBox JS0 爬虫 - xvideos.com (v5)
 * 
 * 更新说明 (v5):
 *  - 修复标题提取: 加强<script>块剥离, 防止JS代码当标题
 *  - 修复分页循环: 当pg>实际总页数时返回空列表
 *  - 增加调试日志输出(通过logcat可见)
 *
 * 更新说明 (v4):
 *  - 修复totalPages默认值为1, 避免/best无限分页
 *  - 修复标题提取: 方式B先剥离<script>再提取文本
 *  - 移除无效的PAGE_CACHE机制
 * 
 * 更新说明 (v3-v2):
 *  - 修复setVideoUrlHigh/Low匹配
 *  - 增加Cookie/Referer头
 *  - 修复时长误匹配"10分钟前"
 *  - 改进vod_play_url格式
 *  - 从分页器提取真实总页数
 *  - 多组视频直链正则后备用
 *  - 优化User-Agent轮换策略
 */
const TVBOX_UA = [
    "Dalvik/2.1.0 (Linux; U; Android 11; MI 10 Pro Build/RKQ1.200826.002)",
    "Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)",
    "Mozilla/5.0 (Linux; Android 9; V2196A Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36;tvbox/1.0",
    "Mozilla/5.0 (Linux; Android 9; TV BOX Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36",
];

let HOST = 'https://www.xvideos.com';
let siteKey = '';
let siteType = 0;
let CAT_BASE = '';

// ---------- 工具函数 ----------

function getExt() { try { return typeof ext !== 'undefined' ? ext : {}; } catch (e) { return {}; } }

function getBaseUrl() { const cfg = getExt(); return cfg.base_url || HOST; }

function randomUA() { return TVBOX_UA[Math.floor(Math.random() * TVBOX_UA.length)]; }

/** 调试日志 (通过TVBox的QuJs运行时输出到logcat) */
function log(msg) {
    try {
        console.log('[v5] ' + msg);
    } catch (e) {}
}

/** 生成常用 HTTP 头 */
function makeHeaders(extra) {
    var h = {
        'User-Agent': randomUA(),
        'Referer': getBaseUrl() + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    };
    if (extra) {
        for (var k in extra) { if (extra.hasOwnProperty(k)) h[k] = extra[k]; }
    }
    return h;
}

/** 解码 HTML 实体 */
function clean(s) {
    if (!s) return '';
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#34;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(parseInt(n)); })
        .trim();
}

/** 清理 URL 占位符 */
function sanitizeUrl(url) {
    if (!url) return url;
    url = url.replace(/THUMBNUM/g, '0');
    url = url.replace(/\{catePg\}/g, '1');
    url = url.replace(/\{pg\}/g, '1');
    url = url.replace(/\{[^}]+\}/g, '0');
    return url;
}

/** 从 URL slug 提取标题 */
function urlToTitle(vodId) {
    try {
        if (!vodId) return '';
        var parts = vodId.split('/');
        if (parts.length < 3) return '';
        var slug = decodeURIComponent(parts.slice(2).join('/'));
        var t = slug.replace(/[_-]/g, ' ');
        t = t.replace(/\s+/g, ' ').trim();
        if (/^\d{3,4}p$|^4K$|^HD$/i.test(t)) return '';
        if (t.length >= 3) return t.charAt(0).toUpperCase() + t.slice(1);
        // 后备: slug 太短(如 "_-_"), 提取视频ID段中非垃圾字符
        var vid = parts[1] || '';
        // 从原始 slug 中去掉分隔符后剩余的任何字母
        var meaningful = slug.replace(/[_\-.\s]/g, '').trim();
        if (meaningful.length >= 2) return meaningful.toUpperCase();
        // 最终后备: 使用 video ID (如 ooeulhvca47)
        return vid.substring(0, 10);
    } catch (e) { return ''; }
}

/** 拼接完整图片 URL */
function makeImgUrl(img, base) {
    if (!img) return '';
    img = sanitizeUrl(img);
    if (img.startsWith('//')) return 'https:' + img;
    if (!img.startsWith('http')) return base + (img.startsWith('/') ? img : '/' + img);
    return img;
}

/** 从 HTML 片段提取图片 URL */
function extractImgUrl(html) {
    var ds = html.match(/data-src\s*=\s*"([^"]*)"/);
    if (ds && ds[1] && !ds[1].includes('blank.gif') && !ds[1].includes('data:image') && ds[1] !== '') return ds[1];
    var src = html.match(/src\s*=\s*"([^"]*)"/);
    if (src && src[1] && !src[1].includes('blank.gif') && !src[1].includes('data:image') && src[1] !== '') return src[1];
    return '';
}

/** 安全的提取时长: 仅匹配独立时长标签, 避免误匹配"10分钟前" */
function extractDuration(text) {
    if (!text) return '';
    // 只匹配纯时长文本: "12分钟", "10 min", "1h 30min", "25:30"
    // 排除包含"前"、"ago"等时间相对词
    if (/前|ago|前|前/i.test(text)) return '';
    var m = text.match(/(\d+)\s*(?:分钟|min|分)\s*(?:\d+\s*秒)?/i);
    if (m) return m[1] + '分钟';
    var m2 = text.match(/(\d+):(\d{2})/);
    if (m2) {
        var min = parseInt(m2[1]);
        var sec = parseInt(m2[2]);
        if (min < 180 && sec < 60) return m2[1] + ':' + m2[2];
    }
    return '';
}

/** 从全局 HTML 收集所有时长(过滤"前/ago"等) */
function collectDurations(html) {
    var durs = [];
    // <span class="duration">...</span>
    var durRe = /<span[^>]*class="duration"[^>]*>([^<]*)<\/span>/gi;
    var m;
    while ((m = durRe.exec(html)) !== null) {
        var d = m[1].trim();
        if (/前|ago|前/i.test(d)) continue;
        durs.push(d);
    }
    // 如果 span 方式没找到, 尝试 <div class="duration"> 或带 data-duration 属性
    if (durs.length === 0) {
        var durRe2 = /<(?:span|div)[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]*)<\/(?:span|div)>/gi;
        while ((m = durRe2.exec(html)) !== null) {
            var d2 = m[1].trim();
            if (/前|ago|前/i.test(d2)) continue;
            if (/\d/.test(d2)) durs.push(d2);
        }
    }
    // 后备: <div class="video-time"> 等
    if (durs.length === 0) {
        var durRe3 = /<(?:span|div)[^>]*class="[^"]*time[^"]*"[^>]*>([^<]*)<\/(?:span|div)>/gi;
        while ((m = durRe3.exec(html)) !== null) {
            var d3 = m[1].trim();
            if (/前|ago|前/i.test(d3)) continue;
            if (/\d/.test(d3)) durs.push(d3);
        }
    }
    return durs;
}

// ---------- 视频列表解析 ----------

function parseVideoList(html, base, limit) {
    limit = limit || 40;

    // ---- 第1部分: 按容器块提取 href + img ----
    var blockRe = /<div[^>]*class="[^"]*thumb-block[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>)?/gi;
    var blocks = [];
    var m;
    while ((m = blockRe.exec(html)) !== null) {
        var inner = m[1].trim();
        if (inner && inner.match(/\/video[^"'\s]*/i)) {
            blocks.push(inner);
        }
    }

    // 后备容器
    if (blocks.length === 0) {
        var fallbacks = [
            { re: /<article[^>]*>([\s\S]*?)<\/article>/gi, name: 'article' },
            { re: /<div[^>]*class="[^"]*video-[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, name: 'video-' },
            { re: /<li[^>]*>([\s\S]*?)<\/li>/gi, name: 'li' },
        ];
        for (var fi = 0; fi < fallbacks.length; fi++) {
            var fb = fallbacks[fi];
            while ((m = fb.re.exec(html)) !== null) {
                if (m[1].match(/\/video[^"'\s]*/i) && m[1].indexOf('<img') !== -1) {
                    blocks.push(m[1]);
                }
            }
            if (blocks.length > 0) break;
        }
    }

    log('parseVideoList: thumb-block数=' + blocks.length);

    // 从块中提取 href 和 img (一一对应)
    var hrefList = [];
    var imgList = [];
    for (var bi = 0; bi < blocks.length; bi++) {
        var block = blocks[bi];
        var hrefM = block.match(/href=["'](\/video[^"'\s]*)["']/i);
        if (!hrefM) continue;
        var href = hrefM[1];
        if (hrefList.indexOf(href) !== -1) continue;

        var imgUrl = '';
        var ds = block.match(/<img[^>]*data-src=["']([^"'<]*)["']/i);
        if (ds && !ds[1].includes('blank.gif') && !ds[1].includes('data:image')) {
            imgUrl = ds[1];
        } else {
            var s = block.match(/<img[^>]*src=["']([^"'<]*)["']/i);
            if (s && !s[1].includes('blank.gif') && !s[1].includes('data:image') && !s[1].includes('/assets/')) {
                imgUrl = s[1];
            }
        }
        // 尝试 data-thumb 属性
        if (!imgUrl) {
            var dt = block.match(/data-thumb\s*=\s*"([^"]*)"/i);
            if (dt) imgUrl = dt[1];
        }

        hrefList.push(href);
        imgList.push(imgUrl);
    }

    // ---- 第2部分: 全局提取标题 ----
    var titleByHref = {};
    var qualRe = /^\d{3,4}p$|^4K$|^HD$/i;
    // 方式A: <a href="..." title="..."> (最可靠, /new 页面有)
    var tA = /<a\s+href=["'](\/video[^"'\s]*)["'][^>]*title=["']([^"'<]*)["']/gi;
    while ((m = tA.exec(html)) !== null) {
        if (!titleByHref[m[1]]) titleByHref[m[1]] = clean(m[2]);
    }
    // 方式B: <a href="...">文本</a> (跳过img+script, 跳过分辨率纯数字)
    var tB = /<a[^>]*href=["'](\/video[^"'\s]*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = tB.exec(html)) !== null) {
        if (!titleByHref[m[1]]) {
            // 先移除 script 块(避免JS代码被当作标题), 再移HTML标签
            var txt = m[2]
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<[^>]+>/g, '')
                .trim();
            if (txt && !qualRe.test(txt)) titleByHref[m[1]] = clean(txt);
        }
    }
    // 方式C: URL slug (/best 页面没有 title 属性, 依赖 slug)
    for (var hi = 0; hi < hrefList.length; hi++) {
        if (!titleByHref[hrefList[hi]]) {
            var slugT = urlToTitle(hrefList[hi]);
            if (slugT) titleByHref[hrefList[hi]] = slugT;
        }
    }
    // 方式D: img[alt] 属性 (/best 页面 alt 目前是"视频", 仅后备)
    for (var bi = 0; bi < blocks.length; bi++) {
        var block = blocks[bi];
        var hrefM2 = block.match(/href=["'](\/video[^"'\s]*)["']/i);
        if (!hrefM2) continue;
        var href2 = hrefM2[1];
        if (titleByHref[href2]) continue;
        var altM = block.match(/<img[^>]*alt\s*=\s*"([^"]*)"[^>]*>/i);
        if (altM && altM[1] && altM[1] !== '视频' && altM[1] !== 'video' && altM[1].length >= 3) {
            titleByHref[href2] = clean(altM[1]);
        }
    }
    // 方式E: 用 urlToTitle 再试一次 (确保所有 href 都有标题)
    for (var hi = 0; hi < hrefList.length; hi++) {
        if (!titleByHref[hrefList[hi]]) {
            var fallback = urlToTitle(hrefList[hi]);
            titleByHref[hrefList[hi]] = fallback || ('视频' + (hi + 1));
        }
    }

    // ---- 清理: 检测JS代码冒充标题, 替换为slug ----
    var jsRe = /(?:function|"use strict"|\.push\(|\.querySelector|window\.)/i;
    for (var ci = 0; ci < hrefList.length; ci++) {
        var chkTitle = titleByHref[hrefList[ci]];
        if (chkTitle && jsRe.test(chkTitle)) {
            var slugFix = urlToTitle(hrefList[ci]);
            log('标题是JS代码, 替换为slug: "' + chkTitle.substring(0,40) + '..." → "' + slugFix + '"');
            titleByHref[hrefList[ci]] = slugFix || ('视频' + (ci + 1));
        }
    }

    // ---- 收集时长 ----
    var durations = collectDurations(html);

    // ---- 第3部分: 合并结果 ----
    var list = [];
    for (var i = 0; i < hrefList.length && list.length < limit; i++) {
        var pic = imgList[i] ? makeImgUrl(imgList[i], base) : '';
        list.push({
            vod_id: hrefList[i],
            vod_name: titleByHref[hrefList[i]] || '',
            vod_pic: pic,
            vod_remarks: durations[i] || '',
        });
    }
    // 日志: 输出前3个标题用于调试
    for (var di = 0; di < Math.min(3, list.length); di++) {
        log('  视频' + di + ': "' + list[di].vod_name + '" | ' + list[di].vod_remarks);
    }
    return list;
}

// ---------- TVBox 标准接口 ----------

async function init(cfg) {
    siteKey = cfg.skey;
    siteType = cfg.stype;
    if (cfg.ext && cfg.ext.base_url) HOST = cfg.ext.base_url;
}

async function home() {
    return JSON.stringify({
        class: [
            { type_id: '/new', type_name: '最新视频' },
            { type_id: '/best', type_name: '最受欢迎' },
            { type_id: '/popular-tags', type_name: '热门标签' },
        ],
        filters: {},
    });
}

async function homeVod() {
    CAT_BASE = '';
    try {
        var base = getBaseUrl();
        var allList = [];
        var pages = ['/new/1', '/new/2', '/best/1'];
        for (var pi = 0; pi < pages.length; pi++) {
            try {
                var url = base + pages[pi];
                var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 15000 });
                var html = resp.content || '';
                if (html.length < 500) continue;
                var list = parseVideoList(html, base, 30);
                for (var li = 0; li < list.length; li++) allList.push(list[li]);
            } catch (e) {}
        }
        return JSON.stringify({ list: allList });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

async function category(tid, pg, filter, extend) {
    pg = pg || 1;
    if (pg <= 0) pg = 1;
    try {
        var url, catBase;
        if (tid.indexOf('http') === 0) {
            var sep = tid.indexOf('?') !== -1 ? '&' : '?';
            url = tid + (pg > 1 ? sep + 'p=' + pg : '');
            var mm = tid.match(/^https?:\/\/[^\/]+/);
            catBase = mm ? mm[0] : getBaseUrl();
            CAT_BASE = catBase;
        } else {
            var base = getBaseUrl();
            var path = tid.replace(/\/\d+$/, '');
            url = base + path + '/' + pg;
            catBase = base;
            CAT_BASE = '';
        }
        var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 15000 });
        var html = resp.content || '';
        log('category: tid=' + tid + ' pg=' + pg + ' url=' + url + ' responseLen=' + html.length);

        // 从分页器提取总页数
        var totalPages = 1;
        var pgRe = /<a[^>]*href=["'][^"']*\/?(\d+)["'][^>]*>(\d+)<\/a>/gi;
        var maxPg = 0;
        var pMatch;
        while ((pMatch = pgRe.exec(html)) !== null) {
            var n = parseInt(pMatch[1]);
            if (n > maxPg) maxPg = n;
            var n2 = parseInt(pMatch[2]);
            if (n2 > maxPg) maxPg = n2;
        }
        if (maxPg > 0) totalPages = Math.min(maxPg + 10, 500);

        // 关键修复: 如果请求的页数超过实际总页数, 返回空列表
        // 避免 TVBox 持续请求下一页导致内容循环
        if (pg > 1 && totalPages === 1) {
            log('category: pg=' + pg + ' > totalPages=1 (无分页器), 返回空列表');
            return JSON.stringify({ page: pg, pagecount: 1, limit: 30, total: 30, list: [] });
        }
        if (pg > totalPages) {
            log('category: pg=' + pg + ' > totalPages=' + totalPages + ', 返回空列表');
            return JSON.stringify({ page: pg, pagecount: totalPages, limit: 30, total: totalPages * 30, list: [] });
        }

        var list = parseVideoList(html, catBase, 60);

        return JSON.stringify({ page: pg, pagecount: totalPages, limit: 30, total: totalPages * 30, list: list });
    } catch (e) {
        return JSON.stringify({ page: pg, pagecount: 0, limit: 30, total: 0, list: [] });
    }
}

/**
 * 从 script 内容中提取视频直链
 * 支持多种模式:
 *   - setVideoUrlHigh('url')
 *   - setVideoUrlLow('url')
 *   - html5video.setVideoUrlHigh
 *   - 对象赋值 videoUrl="..."
 *   - 常规 JSON 配置 {url: "...", ...}
 */
function extractVideoUrls(html) {
    var results = {
        highUrl: '',
        lowUrl: '',
        hlsUrls: [],
        mp4Urls: [],
        fallbackUrl: '',
    };

    var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = scriptRe.exec(html)) !== null) {
        var text = m[1];

        // 1. setVideoUrlHigh / setVideoUrlLow (经典格式)
        var h = text.match(/setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (h && !results.highUrl) results.highUrl = h[1];
        var l = text.match(/setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (l && !results.lowUrl) results.lowUrl = l[1];

        // 2. object.setVideoUrlHigh / html5video.setVideoUrlHigh
        if (!results.highUrl) {
            var oh = text.match(/(?:html5video|videoPlayer|player)\.setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]\s*\)/);
            if (oh) results.highUrl = oh[1];
        }
        if (!results.lowUrl) {
            var ol = text.match(/(?:html5video|videoPlayer|player)\.setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]\s*\)/);
            if (ol) results.lowUrl = ol[1];
        }

        // 3. videoUrl = "..." 或 video_url: "..."
        if (!results.highUrl) {
            var vu = text.match(/(?:videoUrl|video_url|videoSrc)\s*[:=]\s*['"]([^'"]+)['"]/);
            if (vu) results.highUrl = vu[1];
        }

        // 4. 收集所有的 .m3u8
        var hlsRe = /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>,]*/g;
        var hm;
        while ((hm = hlsRe.exec(text)) !== null) {
            if (results.hlsUrls.indexOf(hm[0]) === -1) results.hlsUrls.push(hm[0]);
        }

        // 5. 收集 .mp4 (排除缩略图/预览)
        var mp4Re = /https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>,]*(?![^<]*preview)(?![^<]*thumb)/gi;
        var mm;
        while ((mm = mp4Re.exec(text)) !== null) {
            var mp4Url = mm[0];
            // 排除明显不是视频的 mp4
            if (mp4Url.indexOf('preview') === -1 && mp4Url.indexOf('thumb') === -1 && mp4Url.indexOf('sprite') === -1) {
                if (results.mp4Urls.indexOf(mp4Url) === -1) results.mp4Urls.push(mp4Url);
            }
        }
    }

    // 6. 全局 HTML 中直接找 m3u8/mp4 (非 script 后备)
    if (results.hlsUrls.length === 0 && results.mp4Urls.length === 0 && !results.highUrl) {
        var bodyHls = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>,]*/);
        if (bodyHls) results.hlsUrls.push(bodyHls[0]);
        var bodyMp4 = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>,]*(?![^<]*preview)/);
        if (bodyMp4) results.mp4Urls.push(bodyMp4[0]);
    }

    return results;
}

async function detail(id) {
    try {
        var base = CAT_BASE || getBaseUrl();
        var url = base + (id.indexOf('/') === 0 ? id : '/' + id);
        var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 20000 });
        var html = resp.content || '';

        // ---- 提取元数据 ----
        var title = '';
        var pic = '';

        var t = html.match(/<title>([\s\S]*?)<\/title>/i);
        if (t) title = clean(t[1]).replace(/ - (xvideos|xvideos\.red)\..*$/i, '');

        var og = html.match(/<meta\s+property="og:image"[^>]*content="([^"]*)"/i);
        if (og) pic = sanitizeUrl(og[1]);

        // 图片后备: data-thumb / poster
        if (!pic) {
            var pt = html.match(/poster\s*=\s*"([^"]*)"/i);
            if (pt) pic = sanitizeUrl(pt[1]);
        }
        if (!pic) {
            var dt = html.match(/data-thumb\s*=\s*"([^"]*)"/i);
            if (dt) pic = sanitizeUrl(dt[1]);
        }

        var desc = '';
        var d = html.match(/<meta\s+name="description"[^>]*content="([^"]*)"/i);
        if (d) desc = d[1].slice(0, 300);

        var vod = {
            vod_id: id,
            vod_name: title || '视频',
            vod_pic: pic || '',
            vod_content: desc || '',
        };

        // ---- 提取视频直链 ----
        var urls = extractVideoUrls(html);

        if (urls.highUrl) {
            vod.vod_play_from = '高清';
            vod.vod_play_url = '高清MP4$' + urls.highUrl;
            if (urls.lowUrl) {
                vod.vod_play_from += '$$$标清';
                vod.vod_play_url += '#' + '标清MP4$' + urls.lowUrl;
            }
        } else if (urls.hlsUrls.length > 0) {
            // 多个 HLS 源全部提供
            var playFrom = [];
            var playUrl = [];
            for (var hi = 0; hi < urls.hlsUrls.length && hi < 3; hi++) {
                playFrom.push('线路' + (hi + 1));
                playUrl.push('HLS流$' + urls.hlsUrls[hi]);
            }
            vod.vod_play_from = playFrom.join('$$$');
            vod.vod_play_url = playUrl.join('#');
        } else if (urls.mp4Urls.length > 0) {
            var mp4PlayFrom = [];
            var mp4PlayUrl = [];
            for (var mi = 0; mi < urls.mp4Urls.length && mi < 3; mi++) {
                mp4PlayFrom.push('线路' + (mi + 1));
                mp4PlayUrl.push('MP4直链$' + urls.mp4Urls[mi]);
            }
            vod.vod_play_from = mp4PlayFrom.join('$$$');
            vod.vod_play_url = mp4PlayUrl.join('#');
        } else {
            // 最终后备: 使用页面 URL 本身 (让 TVBox 自己解析)
            vod.vod_play_from = '源';
            vod.vod_play_url = '直接播放$' + url;
        }

        return JSON.stringify({ list: [vod] });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

async function play(flag, id) {
    // flag: 线路标识, id: 视频URL
    // TVBox 中 parse=0 表示不解析直接播放
    return JSON.stringify({ parse: 0, url: id });
}

async function search(wd, pg) {
    pg = pg || 1;
    try {
        var base = getBaseUrl();
        var url = base + '/?k=' + encodeURIComponent(wd);
        var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 15000 });
        var html = resp.content || '';
        var list = parseVideoList(html, base, 20);
        return JSON.stringify({ list: list, page: pg });
    } catch (e) {
        return JSON.stringify({ list: [], page: pg });
    }
}

export function __jsEvalReturn() {
    return { init: init, home: home, homeVod: homeVod, category: category, detail: detail, play: play, search: search };
}