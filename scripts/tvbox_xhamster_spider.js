/**
 * TVBox JS0 爬虫 - xHamster.com (zh.xhamster.com)
 * https://raw.githubusercontent.com/mousu5426-dot/tvbox-videos/main/configs/zhixvideos.json
 * 功能:
 *  - 列表页: 最新视频 / 最受欢迎 / 热门分类
 *  - 详情页: 提取 HLS 视频直链 (xhcdn)
 *  - 支持分页
 *  - 中英文标题
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
let CAT_BASE = '';

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

// ---------- 列表页解析 ----------

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

    // 找到所有指向视频的 <a> 链接 (匹配 /videos/ 路径)
    var linkRe = /<a[^>]*href=["']([^"'\s]*\/videos\/[^"'\s]*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var hrefCount = 0;
    var m;
    while ((m = linkRe.exec(html)) !== null) {
        hrefCount++;
        var href = m[1];
        if (!href.startsWith('http')) href = base + href;
        if (seenHrefs[href]) continue;
        seenHrefs[href] = true;

        var linkContent = m[2];

        // 用 match 索引前+后区域找图 (data-src 或 src)
        var searchStart = Math.max(0, m.index - 600);
        var searchEnd = Math.min(html.length, m.index + 1200);
        var nearby = html.substring(searchStart, searchEnd);

        // ---- 缩略图 ----
        var pic = '';
        // 优先 data-src (懒加载)
        var dsM = nearby.match(/<img[^>]*data-src=["']([^"']*)["'][^>]*>/i);
        if (dsM && dsM[1].indexOf('blank') === -1 && dsM[1].indexOf('data:') !== 0) {
            pic = sanitizeUrl(dsM[1]);
        }
        if (!pic) {
            var srcM = nearby.match(/<img[^>]*src=["']([^"']*)["'][^>]*>/i);
            if (srcM && srcM[1].indexOf('blank') === -1 && srcM[1].indexOf('data:') !== 0) {
                pic = sanitizeUrl(srcM[1]);
            }
        }
        if (!pic) {
            var thumbM = nearby.match(/data-thumb\s*=\s*["']([^"']*)["']/i);
            if (thumbM) pic = sanitizeUrl(thumbM[1]);
        }

        // ---- 标题 ----
        var title = '';
        // 方式A: 链接内的 img[alt] 
        var altM = linkContent.match(/alt\s*=\s*"([^"]*)"/i);
        if (altM && altM[1].length > 2 && altM[1] !== 'Video') title = clean(altM[1]);
        // 方式B: data-title
        if (!title) {
            var dtM = nearby.match(/data-title\s*=\s*"([^"]*)"/i);
            if (dtM) title = clean(dtM[1]);
        }
        // 方式C: title 属性
        if (!title) {
            var taM = m[0].match(/title\s*=\s*"([^"]*)"/i);
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
        var durM = nearby.match(/<span[^>]*class="[^"]*(?:duration|time|badge)[^"]*"[^>]*>([^<]{1,20})<\/span>/i);
        if (durM) {
            var d = durM[1].trim();
            // 只保留纯时长格式
            if (/^\d/.test(d) && /[:分钟分秒\dhms]/.test(d)) duration = d;
        }

        results.push({
            vod_id: href,
            vod_name: title.substring(0, 80),
            vod_pic: pic || '',
            vod_remarks: duration || '',
        });

        if (results.length >= limit) break;
    }

    log('parseVideoList: href总匹配=' + hrefCount + ' 去重后=' + results.length + ' 条');
    if (results.length > 0) {
        log('  第一条vod_id=' + results[0].vod_id);
        log('  第一条vod_name=' + results[0].vod_name);
        log('  第一条vod_pic=' + results[0].vod_pic);
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

    // ---- 模式A: <link rel="preload" as="fetch" href="..."> (HLS Master, xHamster新版)
    var linkRe = /<link[^>]*rel="preload"[^>]*as="fetch"[^>]*href="([^"]*\.m3u8[^"]*)"/gi;
    var lm;
    while ((lm = linkRe.exec(html)) !== null) {
        var lu = lm[1];
        if (results.hlsUrls.indexOf(lu) === -1) results.hlsUrls.push(lu);
        if (lu.indexOf('_TPL_') !== -1 && !results.masterHls) results.masterHls = lu;
    }

    // ---- 模式B: <video src="..."> (MP4降级源)
    var videoRe = /<video[^>]*src="([^"]*\.mp4[^"]*)"/gi;
    var vm;
    while ((vm = videoRe.exec(html)) !== null) {
        var vu = vm[1];
        if (vu.indexOf('thumb-') === -1 && vu.indexOf('preview') === -1 && vu.indexOf('sprite') === -1) {
            if (results.mp4Urls.indexOf(vu) === -1) results.mp4Urls.push(vu);
        }
    }

    // ---- 模式C: <source src="..."> 
    var sourceRe = /<source[^>]*src="([^"]*\.(?:mp4|m3u8)[^"]*)"/gi;
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
        var rawRe = /(https?:\/\/[^"'\s<>]*xhcdn[^"'\s<>]*\.(?:mp4|m3u8)[^"'\s<>,\]]*)/gi;
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

    // ---- 模式E: HTML body 中裸 xhcdn URL (后备) ----
    if (results.hlsUrls.length === 0 && results.mp4Urls.length === 0) {
        var bodyRe = /(https?:\/\/[^"'\s<>]*xhcdn[^"'\s<>]*\.(?:mp4|m3u8)[^"'\s<>,\]]*)/gi;
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
        // 从最新和最受欢迎页取前几页的视频
        var pages = ['/newest/1', '/popular/1'];
        for (var pi = 0; pi < pages.length; pi++) {
            try {
                var url = base + pages[pi];
                var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 15000 });
                var html = resp.content || '';
                if (html.length < 500) continue;
                var list = parseVideoList(html, base, 40);
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
            url = tid + (pg > 1 ? sep + 'page=' + pg : '');
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

        log('category: tid=' + tid + ' pg=' + pg + ' url=' + url + ' html.length=' + html.length);
        if (html.length > 0) {
            log('  html前200=' + html.substring(0, 200).replace(/\n/g, ' '));
            if (html.indexOf('cloudflare') !== -1 || html.indexOf('Cloudflare') !== -1 || html.indexOf('challenge') !== -1) {
                log('  WARNING: Cloudflare challenge detected!');
            }
            if (html.indexOf('Just a moment') !== -1) {
                log('  WARNING: Cloudflare "Just a moment" detected!');
            }
        }

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

        var list = parseVideoList(html, catBase, 60);

        return JSON.stringify({ page: pg, pagecount: totalPages, limit: 30, total: totalPages * 30, list: list });
    } catch (e) {
        return JSON.stringify({ page: pg, pagecount: 0, limit: 30, total: 0, list: [] });
    }
}

async function detail(id) {
    try {
        var base = CAT_BASE || getBaseUrl();
        var url = id.indexOf('http') === 0 ? id : base + (id.indexOf('/') === 0 ? id : '/' + id);
        var resp = await req(url, { headers: makeHeaders(), method: 'get', timeout: 20000 });
        var html = resp.content || '';

        // ---- 提取元数据 ----
        var title = '';
        var pic = '';

        var t = html.match(/<title\s*>([\s\S]*?)<\/title>/i);
        if (t) title = clean(t[1]).replace(/ - xHamster\..*$/i, '').replace(/ - xHamster$/i, '').trim();

        var og = html.match(/<meta\s+property="og:image"[^>]*content="([^"]*)"/i);
        if (og) pic = sanitizeUrl(og[1]);
        if (!pic) {
            var poster = html.match(/poster\s*=\s*"([^"]*)"/i);
            if (poster) pic = sanitizeUrl(poster[1]);
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

        log('detail: title="' + title + '" html.length=' + html.length + ' hlsUrls=' + urls.hlsUrls.length + ' mp4Urls=' + urls.mp4Urls.length);
        if (urls.hlsUrls.length > 0) log('  hls[0]=' + urls.hlsUrls[0]);
        if (urls.mp4Urls.length > 0) log('  mp4[0]=' + urls.mp4Urls[0]);

        // HLS 优先 (TVBox 的播放器基于 ExoPlayer 支持 HLS)
        if (urls.hlsUrls.length > 0) {
            var playFrom = [];
            var playUrl = [];
            for (var hi = 0; hi < urls.hlsUrls.length; hi++) {
                var label = hi === 0 ? 'HLS' : '线路' + (hi + 1);
                playFrom.push(label);
                playUrl.push('HLS流$' + urls.hlsUrls[hi]);
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
        return JSON.stringify({ list: [] });
    }
}

async function play(flag, id) {
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
