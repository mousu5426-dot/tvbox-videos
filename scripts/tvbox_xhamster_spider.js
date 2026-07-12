/**
 * TVBox JS0 爬虫 - xHamster.com (zh.xhamster.com) — v4
 * https://raw.githubusercontent.com/mousu5426-dot/tvbox-videos/main/configs/zhixvideos.json
 * 功能:
 *  - 列表页: 最新视频 / 最受欢迎 / 热门分类
 *  - 详情页: 提取 HLS 视频直链 (xhcdn / video-nss)
 *  - 支持无限滚动分页
 *  - 中英文标题
 * 
 * v4: 修复路径分页(/N格式), 修复无限制滚动(totalPages估算), 加速homeVod(3页→2页)
 * v3: 修复缺失 log 函数导致 TVBox 加载崩溃
 */
const TVBOX_UA = [
    "Dalvik/2.1.0 (Linux; U; Android 11; MI 10 Pro Build/RKQ1.200826.002)",
    "Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)",
    "Mozilla/5.0 (Linux; Android 9; V2196A Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36;tvbox/1.0",
    "Mozilla/5.0 (Linux; Android 9; TV BOX Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36",
];

let HOST = 'https://zh.xhamster.com';
let siteKey = '';
let siteType = 0;

// ---------- 工具函数 ----------

function getExt() { try { return typeof ext !== 'undefined' ? ext : {}; } catch (e) { return {}; } }

function getBaseUrl() { return (getExt().base_url || HOST).replace(/\/+$/, ''); }

function randomUA() { return TVBOX_UA[Math.floor(Math.random() * TVBOX_UA.length)]; }

function makeHeaders(extra) {
    var h = {
        'User-Agent': randomUA(),
        'Referer': getBaseUrl() + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
        'Cache-Control': 'no-cache',
    };
    if (extra) {
        for (var k in extra) { if (extra.hasOwnProperty(k)) h[k] = extra[k]; }
    }
    return h;
}

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

function sanitizeUrl(url) {
    if (!url) return url;
    url = url.replace(/THUMBNUM/g, '0');
    url = url.replace(/\{catePg\}/g, '1');
    url = url.replace(/\{pg\}/g, '1');
    url = url.replace(/\{[^}]+\}/g, '0');
    return url;
}

/** 调试日志 (通过TVBox的QuJs运行时输出到logcat) */
function log(msg) {
    try {
        console.log('[xhamster] ' + msg);
    } catch (e) {}
}

// ---------- 列表页解析 (JSON 优先, HTML 正则回退) ----------

/**
 * 从 window.initials JSON 提取视频列表 (每页 ~50 条, 是 HTML 正则模式的 10 倍)
 */
function parseFromInitials(html, base) {
    try {
        // 找到 window.initials= 在 script 内的位置
        var startMarker = 'window.initials=';
        var startIdx = html.indexOf(startMarker);
        if (startIdx === -1) return null;

        startIdx += startMarker.length;

        // 手动解析 JSON: 从 { 开始匹配括号
        var depth = 0;
        var jsonStart = -1;
        var jsonEnd = -1;
        for (var i = startIdx; i < html.length; i++) {
            if (html[i] === '{' && jsonStart === -1) jsonStart = i;
            if (html[i] === '{') depth++;
            else if (html[i] === '}') {
                depth--;
                if (depth === 0 && jsonStart !== -1) { jsonEnd = i + 1; break; }
            }
        }
        if (jsonStart === -1 || jsonEnd === -1) return null;

        var json = JSON.parse(html.substring(jsonStart, jsonEnd));
        var videoProps = json.layoutPage && json.layoutPage.videoListProps && json.layoutPage.videoListProps.videoThumbProps;
        if (!videoProps || !videoProps.length) return null;

        var results = [];
        var perPage = json.perPage || 48;
        var page = json.page || 1;
        var stats = json.statistics || {};

        for (var vi = 0; vi < videoProps.length; vi++) {
            var v = videoProps[vi];
            var vodId = v.pageURL || (base + '/videos/' + v.id);
            // 过滤非视频子类型
            if (v.videoType && v.videoType !== 'video') continue;

            var duration = '';
            if (v.duration) {
                var sec = parseInt(v.duration);
                if (sec > 0) {
                    var m = Math.floor(sec / 60);
                    var s = sec % 60;
                    duration = m + ':' + (s < 10 ? '0' : '') + s;
                }
            }

            results.push({
                vod_id: vodId,
                vod_name: (v.titleLocalized || v.title || '视频').substring(0, 80),
                vod_pic: v.thumbURL || v.imageURL || '',
                vod_remarks: duration || (v.isUHD === 'true' ? 'HD' : ''),
            });
        }

        log('parseFromInitials: 总视频=' + results.length + ' perPage=' + perPage + ' 页=' + page +
            ' 总量=' + (stats.videos || '?'));
        if (results.length > 0) {
            log('  第一条vod_id=' + results[0].vod_id);
            log('  第一条vod_name=' + results[0].vod_name);
        }
        return { list: results, page: page, perPage: perPage, stats: stats };
    } catch (e) {
        log('parseFromInitials: 解析失败 — ' + e.message);
        return null;
    }
}

/**
 * 解析 xHamster 视频列表页 HTML，提取视频信息
 * 
 * 策略: 不依赖特定容器 class，改为直接匹配 `<a href=".../videos/...">` 
 * 作为视频锚点，然后在附近区域提取缩略图、标题、时长
 * 兼容 /newest, /popular, /top 等所有列表页
 */
function parseVideoList(html, base, limit) {
    limit = limit || 40;

    var results = [];
    var seenHrefs = {};

    log('parseVideoList: html.length=' + html.length + ' limit=' + limit);

    // [FIXED] 支持双引号和单引号
    var linkRe = /<a[^>]*href\s*=\s*["']([^"'\s]*\/videos\/[^"'\s]*)["'][^>]*>/gi;
    var hrefCount = 0;
    var m;
    while ((m = linkRe.exec(html)) !== null) {
        hrefCount++;
        var href = m[1];
        if (!href.startsWith('http')) href = base + href;
        if (seenHrefs[href]) continue;
        seenHrefs[href] = true;

        var linkContent = m[0]; // 使用整个 <a> 标签内容

        // 用 match 索引前+后区域找图 (data-src 或 src)
        var searchStart = Math.max(0, m.index - 800);
        var searchEnd = Math.min(html.length, m.index + 1500);
        var nearby = html.substring(searchStart, searchEnd);

        // ---- 缩略图 ----
        var pic = '';
        // 优先 data-src (懒加载)
        var dsM = nearby.match(/<img[^>]*data-src\s*=\s*["']([^"']*)["'][^>]*>/i);
        if (dsM && dsM[1].indexOf('blank') === -1 && dsM[1].indexOf('data:') !== 0) {
            pic = sanitizeUrl(dsM[1]);
        }
        if (!pic) {
            var srcM = nearby.match(/<img[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/i);
            if (srcM && srcM[1].indexOf('blank') === -1 && srcM[1].indexOf('data:') !== 0) {
                pic = sanitizeUrl(srcM[1]);
            }
        }
        if (!pic) {
            var thumbM = nearby.match(/data-thumb\s*=\s*["']([^"']*)["']/i);
            if (thumbM) pic = sanitizeUrl(thumbM[1]);
        }
        // 尝试 og:image 或其他 meta (后备)
        if (!pic) {
            var ogM = nearby.match(/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']*)["']/i);
            if (ogM) pic = sanitizeUrl(ogM[1]);
        }

        // ---- 标题 ----
        var title = '';
        // 方式A: 链接内的 img[alt] 
        var altM = linkContent.match(/alt\s*=\s*"([^"]*)"/i);
        if (!altM) altM = linkContent.match(/alt\s*=\s*'([^']*)'/i);
        if (altM && altM[1].length > 2 && altM[1] !== 'Video') title = clean(altM[1]);
        // 方式B: data-title
        if (!title) {
            var dtM = nearby.match(/data-title\s*=\s*"([^"]*)"/i);
            if (!dtM) dtM = nearby.match(/data-title\s*=\s*'([^']*)'/i);
            if (dtM) title = clean(dtM[1]);
        }
        // 方式C: title 属性
        if (!title) {
            var taM = linkContent.match(/title\s*=\s*"([^"]*)"/i);
            if (!taM) taM = linkContent.match(/title\s*=\s*'([^']*)'/i);
            if (taM && taM[1].length > 2) title = clean(taM[1]);
        }
        // 方式D: URL slug
        if (!title) {
            var slug = href.split('/').pop() || '';
            title = slug.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
            if (title.length < 2) title = '';
        }
        if (!title) title = '视频 ' + (results.length + 1);

        // ---- 时长 ----
        var duration = '';
        var durM = nearby.match(/<[^>]*class\s*=\s*["'][^"']*(?:duration|time|badge)[^"']*["'][^>]*>([^<]{1,20})<\/[^>]*>/i);
        if (durM) {
            var d = durM[1].trim();
            if (/^\d/.test(d) && /[:分钟分秒\dhms]/.test(d)) duration = d;
        }

        // 过滤: 排除创作者/频道/分类聚合页 (非独立视频)
        if (href.indexOf('/creators/') === -1 && href.indexOf('/channels/') === -1 && href.indexOf('/categories/') === -1) {
            results.push({
                vod_id: href,
                vod_name: title.substring(0, 80),
                vod_pic: pic || '',
                vod_remarks: duration || '',
            });
        }

        if (results.length >= limit) break;
    }

    log('parseVideoList: href总匹配=' + hrefCount + ' 去重后=' + results.length + ' 条');
    if (results.length > 0) {
        log('  第一条vod_id=' + results[0].vod_id);
        log('  第一条vod_name=' + results[0].vod_name);
        log('  第一条vod_pic=' + (results[0].vod_pic || '(无)').substring(0, 80));
    }
    return results;
}

// ---------- 从详情页提取视频直链 ----------

function extractVideoUrls(html) {
    var results = {
        mp4Urls: [],
        hlsUrls: [],
        masterHls: '',
    };

    // ---- 模式A: <link rel="preload" as="fetch"> (HLS Master, xHamster新版) ----
    // [FIXED] 不依赖属性顺序, 先匹配所有 link 再检查 rel/as
    var preloadLinkRe = /<link[^>]*>/gi;
    var plm;
    while ((plm = preloadLinkRe.exec(html)) !== null) {
        var tag = plm[0];
        // 检查是否同时有 rel="preload" 和 as="fetch"
        if (/rel\s*=\s*["']preload["']/i.test(tag) && /as\s*=\s*["']fetch["']/i.test(tag)) {
            var hrefM = tag.match(/href\s*=\s*["']([^"']*\.m3u8[^"']*)["']/i);
            if (hrefM) {
                var lu = hrefM[1];
                if (results.hlsUrls.indexOf(lu) === -1) results.hlsUrls.push(lu);
                if (lu.indexOf('_TPL_') !== -1 && !results.masterHls) results.masterHls = lu;
            }
        }
    }

    // ---- 模式B: <video src="..."> (MP4降级源 / noscript) ----
    var videoRe = /<video[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/gi;
    var vm;
    while ((vm = videoRe.exec(html)) !== null) {
        var vu = vm[1];
        if (vu.indexOf('thumb-') === -1 && vu.indexOf('preview') === -1 && vu.indexOf('sprite') === -1) {
            if (results.mp4Urls.indexOf(vu) === -1) results.mp4Urls.push(vu);
        }
    }

    // ---- 模式C: <source src="..."> ----
    var sourceRe = /<source[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/gi;
    var sm2;
    while ((sm2 = sourceRe.exec(html)) !== null) {
        var su = sm2[1];
        if (su.indexOf('.m3u8') !== -1) {
            if (results.hlsUrls.indexOf(su) === -1) results.hlsUrls.push(su);
            if (su.indexOf('_TPL_') !== -1 && !results.masterHls) results.masterHls = su;
        } else if (su.indexOf('.mp4') !== -1) {
            if (su.indexOf('thumb-') === -1 && su.indexOf('preview') === -1) {
                if (results.mp4Urls.indexOf(su) === -1) results.mp4Urls.push(su);
            }
        }
    }

    // ---- 模式D: <script> 块内的旧格式 (向后兼容) ----
    var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = scriptRe.exec(html)) !== null) {
        var text = m[1];

        // D1: setVideoUrl series
        var sh = text.match(/setVideoUrl(?:High|Low)?\s*[=:]\s*["']([^"']+)["']/);
        if (sh && results.mp4Urls.indexOf(sh[1]) === -1) results.mp4Urls.push(sh[1]);

        // D2: 对象属性 src/url/file
        var srcRe = /(?:src|url|file)\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
        var sm;
        while ((sm = srcRe.exec(text)) !== null) {
            var u = sm[1];
            if (u.indexOf('.m3u8') !== -1) {
                if (results.hlsUrls.indexOf(u) === -1) results.hlsUrls.push(u);
                if (u.indexOf('_TPL_') !== -1 && !results.masterHls) results.masterHls = u;
            } else if (u.indexOf('.mp4') !== -1) {
                if (results.mp4Urls.indexOf(u) === -1) results.mp4Urls.push(u);
            }
        }

        // D3: 直接裸 URL (CDN 链接) in script
        var rawRe = /(https?:\/\/[^"'\s<>]*(?:xhcdn|video)[^"'\s<>]*\.(?:mp4|m3u8)[^"'\s<>,\]]*)/gi;
        var rm;
        while ((rm = rawRe.exec(text)) !== null) {
            var ru = rm[1];
            if (ru.indexOf('thumb-') !== -1 || ru.indexOf('static-') !== -1 || ru.indexOf('ic-') !== -1) continue;
            if (ru.indexOf('.m3u8') !== -1) {
                if (results.hlsUrls.indexOf(ru) === -1) results.hlsUrls.push(ru);
            } else if (ru.indexOf('.mp4') !== -1) {
                if (results.mp4Urls.indexOf(ru) === -1) results.mp4Urls.push(ru);
            }
        }
    }

    // ---- 模式E: HTML body 中裸 CDN URL (后备) ----
    if (results.hlsUrls.length === 0 && results.mp4Urls.length === 0) {
        var bodyRe = /(https?:\/\/[^"'\s<>]*(?:xhcdn|video)[^"'\s<>]*\.(?:mp4|m3u8)[^"'\s<>,\]]*)/gi;
        var bm;
        while ((bm = bodyRe.exec(html)) !== null) {
            var bu = bm[1];
            if (bu.indexOf('thumb-') !== -1 || bu.indexOf('static-') !== -1 || bu.indexOf('ic-') !== -1) continue;
            if (bu.indexOf('.m3u8') !== -1) {
                if (results.hlsUrls.indexOf(bu) === -1) results.hlsUrls.push(bu);
            } else if (bu.indexOf('.mp4') !== -1) {
                if (results.mp4Urls.indexOf(bu) === -1) results.mp4Urls.push(bu);
            }
        }
    }

    // 过滤: 排除可疑URL
    results.mp4Urls = results.mp4Urls.filter(function(u) {
        return u.indexOf('preview') === -1 && u.indexOf('thumb') === -1 && u.indexOf('sprite') === -1;
    });

    // 去重 HLS: 优先保留 _TPL_ master
    if (results.masterHls) {
        results.hlsUrls = [results.masterHls];
    } else {
        var deduped = [];
        for (var hi = 0; hi < results.hlsUrls.length; hi++) {
            if (deduped.indexOf(results.hlsUrls[hi]) === -1) deduped.push(results.hlsUrls[hi]);
        }
        // 优先保留最高清晰度
        var qOrder = ['1080p', '720p', '480p', '240p', '144p'];
        var sorted = [];
        for (var qi = 0; qi < qOrder.length; qi++) {
            for (var hi = 0; hi < deduped.length; hi++) {
                if (deduped[hi].indexOf(qOrder[qi]) !== -1 && sorted.indexOf(deduped[hi]) === -1) {
                    sorted.push(deduped[hi]);
                }
            }
        }
        for (var hi = 0; hi < deduped.length; hi++) {
            if (sorted.indexOf(deduped[hi]) === -1) sorted.push(deduped[hi]);
        }
        results.hlsUrls = sorted.slice(0, 3);
    }

    return results;
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
            { type_id: '/newest', type_name: '最新视频' },
            { type_id: '/popular', type_name: '最受欢迎' },
            { type_id: '/top', type_name: '最高评分' },
        ],
        filters: {},
    });
}

async function homeVod() {
    try {
        var base = getBaseUrl();
        var allList = [];
        // [FIXED] 移动端: /popular → 404, 改用 /best/weekly + /best/monthly
        // v3: 路径分页格式, 减少到2页加快加载速度 (第1页不加 /1)
        var pages = ['/newest', '/best/weekly'];
        for (var pi = 0; pi < pages.length; pi++) {
            try {
                var url = base + pages[pi];
                var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 15000 });
                var html = resp.content || '';
                // [FIXED] 检测网络错误并记录
                if (resp._error) {
                    log('homeVod: 请求失败 ' + pages[pi] + ' — ' + resp._error);
                    continue;
                }
                if (html.length < 500) {
                    log('homeVod: 页面内容过短 ' + pages[pi] + ' (html.length=' + html.length + '), 可能被CF阻断');
                    continue;
                }
                var list = parseFromInitials(html, base);
                if (list) {
                    for (var li = 0; li < list.list.length; li++) allList.push(list.list[li]);
                    log('homeVod: ' + pages[pi] + ' JSON模式 → ' + list.list.length + ' 条');
                } else {
                    var htmlList = parseVideoList(html, base, 40);
                    for (var li = 0; li < htmlList.length; li++) allList.push(htmlList[li]);
                    log('homeVod: ' + pages[pi] + ' HTML模式 → ' + htmlList.length + ' 条');
                }
            } catch (e) {
                log('homeVod: 异常 ' + pages[pi] + ' — ' + e.message);
            }
        }
        return JSON.stringify({ list: allList });
    } catch (e) {
        log('homeVod: 致命错误 — ' + e.message);
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
            url = tid + (pg > 1 ? sep + 'page=' + pg : '');
            var mm = tid.match(/^https?:\/\/[^\/]+/);
            catBase = mm ? mm[0] : getBaseUrl();
        } else {
            var base = getBaseUrl();
            // [FIXED] xHamster 路径分页: 第1页不加 /1, 第2页起用 /2, /3 ...
            url = base + tid + (pg > 1 ? '/' + pg : '');
            catBase = base;
        }

        var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 15000 });
        var html = resp.content || '';

        log('category: tid=' + tid + ' pg=' + pg + ' url=' + url + ' html.length=' + html.length);
        if (html.length > 0) {
            log('  html前200=' + html.substring(0, 200).replace(/\n/g, ' '));
        }

        // [FIXED] 检测网络错误和 Cloudflare
        if (resp._error) {
            log('  WARNING: 网络请求失败 — ' + resp._error);
            return JSON.stringify({ page: pg, pagecount: 0, limit: 30, total: 0, list: [] });
        }
        if (html.indexOf('cloudflare') !== -1 || html.indexOf('Cloudflare') !== -1) {
            log('  WARNING: Cloudflare challenge detected! 可能需要更换代理或UA');
        }
        if (html.indexOf('Just a moment') !== -1) {
            log('  WARNING: Cloudflare "Just a moment" 拦截!');
        }
        if (html.indexOf('Error code 520') !== -1 || html.indexOf('Error code 5') !== -1) {
            log('  WARNING: Cloudflare error page (5xx) — 源站故障或CF拦截');
        }

        var list;
        var totalPages = 1;

        // [NEW] 优先从 JSON 提取 (50条/页)
        var initialsResult = parseFromInitials(html, base);
        if (initialsResult) {
            list = initialsResult.list;
            var totalVideos = initialsResult.stats.videos || 0;
            if (totalVideos > 0) {
                totalPages = Math.ceil(totalVideos / initialsResult.perPage);
            } else {
                // stats.videos 为空时保守估算, 始终允许向下滚动
                totalPages = pg + 15;
            }
            log('category: JSON模式 页=' + pg + ' 总页=' + totalPages + ' 视频=' + list.length);
        } else {
            // 回退: HTML 正则解析
            var totalPagesFallback = 1;
            var pgRe = /<a[^>]*href\s*=\s*["'][^"']*\/?(\d+)["'][^>]*>/gi;
            var maxPg = 0;
            var pMatch;
            while ((pMatch = pgRe.exec(html)) !== null) {
                var n = parseInt(pMatch[1]);
                if (n > maxPg) maxPg = n;
            }
            if (maxPg > 0) totalPagesFallback = Math.min(maxPg + 10, 500);
            totalPages = totalPagesFallback;
            list = parseVideoList(html, catBase, 60);
            log('category: HTML模式 页=' + pg + ' 总页=' + totalPages + ' 视频=' + list.length);
        }

        return JSON.stringify({ page: pg, pagecount: totalPages, limit: 30, total: totalPages * 30, list: list });
    } catch (e) {
        log('category: 异常 — ' + e.message);
        return JSON.stringify({ page: pg, pagecount: 0, limit: 30, total: 0, list: [] });
    }
}

async function detail(id) {
    try {
        // [FIXED] 始终使用 getBaseUrl(), 不依赖跨调用的 CAT_BASE 状态
        var base = getBaseUrl();
        var url = id.indexOf('http') === 0 ? id : base + (id.indexOf('/') === 0 ? id : '/' + id);
        var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 20000 });
        var html = resp.content || '';

        // [FIXED] 检测网络错误
        if (resp._error) {
            log('detail: 网络请求失败 — ' + resp._error);
        }

        // ---- 提取元数据 ----
        var title = '';
        var pic = '';

        var t = html.match(/<title\s*>([\s\S]*?)<\/title>/i);
        // [FIXED] title 清理 — 更全面的后缀匹配
        if (t) {
            title = clean(t[1])
                .replace(/\s*[-|–—–]\s*xHamster.*$/i, '')
                .replace(/\s*[-|–—–]\s*Free\s*Porn.*$/i, '')
                .replace(/\s*[:：]\s*[主出]演[\s:：].+$/i, '')
                .replace(/\s*[主出]演[\s:：].+$/i, '')
                .replace(/\s*[-|–—–]\s*(?:卡通|红发|内射|大鸡巴|射精|HD|1080p|720p|4K).*$/i, '')
                .trim();
        }

        var og = html.match(/<meta\s+[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"]*)["']/i);
        if (og) pic = sanitizeUrl(og[1]);
        if (!pic) {
            var poster = html.match(/poster\s*=\s*["']([^"]*)["']/i);
            if (poster) pic = sanitizeUrl(poster[1]);
        }

        var desc = '';
        var d = html.match(/<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"]*)["']/i);
        if (d) desc = d[1].slice(0, 300);

        var vod = {
            vod_id: id,
            vod_name: title || '视频',
            vod_pic: pic || '',
            vod_content: desc || '',
        };

        // ---- 提取视频直链 ----
        var urls = extractVideoUrls(html);

        log('detail: title="' + title + '" html.length=' + html.length + ' hlsUrls=' + urls.hlsUrls.length + ' mp4Urls=' + urls.mp4Urls.length);
        if (urls.hlsUrls.length > 0) log('  hls[0]=' + urls.hlsUrls[0]);
        if (urls.mp4Urls.length > 0) log('  mp4[0]=' + urls.mp4Urls[0]);

        // HLS 优先 (TVBox 的播放器基于 ExoPlayer 支持 HLS)
        if (urls.hlsUrls.length > 0) {
            var playFrom = [];
            var playUrl = [];
            for (var hi = 0; hi < urls.hlsUrls.length; hi++) {
                // [FIXED] 从 URL 中提取分辨率标签
                var label = 'HLS';
                var resMatch = urls.hlsUrls[hi].match(/\/(\d+p)\//);
                if (resMatch) label = resMatch[1];
                else if (hi > 0) label = '线路' + (hi + 1);
                playFrom.push(label);
                playUrl.push(label + '$' + urls.hlsUrls[hi]);
            }
            vod.vod_play_from = playFrom.join('$$$');
            vod.vod_play_url = playUrl.join('#');
        } else if (urls.mp4Urls.length > 0) {
            var mp4Urls = urls.mp4Urls.filter(function(u) { return u.indexOf('.mp4') !== -1 && u.indexOf('m3u8') === -1; });
            if (mp4Urls.length > 0) {
                vod.vod_play_from = 'MP4';
                vod.vod_play_url = 'MP4直链$' + mp4Urls[0];
            } else {
                vod.vod_play_from = '源';
                vod.vod_play_url = '直接播放$' + url;
            }
        } else {
            vod.vod_play_from = '源';
            vod.vod_play_url = '直接播放$' + url;
        }

        return JSON.stringify({ list: [vod] });
    } catch (e) {
        log('detail: 异常 — ' + e.message);
        return JSON.stringify({ list: [] });
    }
}

async function play(flag, id) {
    // [FIXED] 如果 URL 含 _TPL_ 模板, 替换为 720p 默认清晰度
    var finalUrl = id;
    if (finalUrl.indexOf('_TPL_') !== -1) {
        finalUrl = finalUrl.replace('_TPL_', 'h264,720p');
        log('play: 替换 _TPL_ → h264,720p');
    }
    return JSON.stringify({ parse: 0, url: finalUrl });
}

async function search(wd, pg) {
    pg = pg || 1;
    try {
        var base = getBaseUrl();
        // [FIXED] 使用正确的搜索 URL 格式
        var url = base + '/search/' + encodeURIComponent(wd) + '?page=' + pg;
        var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 15000 });
        var html = resp.content || '';

        // 如果 /search/ 路径无效, 降级到旧格式
        if (!html || html.length < 500) {
            log('search: /search/ 路径返回内容过短, 尝试降级 ?k= 格式');
            var fallbackUrl = base + '/?k=' + encodeURIComponent(wd);
            resp = await req(fallbackUrl, { headers: makeHeaders(), method: 'get', timeout: 15000 });
            html = resp.content || '';
        }

        var list = parseFromInitials(html, base);
        if (list) {
            log('search: JSON模式 → ' + list.list.length + ' 条');
            return JSON.stringify({ list: list.list, page: pg });
        }
        var listFallback = parseVideoList(html, base, 20);
        log('search: HTML模式 → ' + listFallback.length + ' 条');
        return JSON.stringify({ list: listFallback, page: pg });
    } catch (e) {
        log('search: 异常 — ' + e.message);
        return JSON.stringify({ list: [], page: pg });
    }
}

export function __jsEvalReturn() {
    return { init: init, home: home, homeVod: homeVod, category: category, detail: detail, play: play, search: search };
}