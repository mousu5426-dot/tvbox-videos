/**
 * TVBox JS0 爬虫 - xHamster.com (zh.xhamster.com)
 * 
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

function parseVideoList(html, base, limit) {
    limit = limit || 40;
    var q = '["\']';

    // 以 video-thumb 容器为单位提取
    var blockRe = /<div[^>]*class="[^"]*video-thumb[^"]*"[^>]*data-video-id="([^"]*)"[^>]*>([\s\S]*?)<\/div>\s*(?:<!--|<\/div>)?/gi;
    var blocks = [];
    var m;
    while ((m = blockRe.exec(html)) !== null) {
        var vid = m[1];
        var inner = m[2];
        if (vid && inner) {
            blocks.push({ vid: vid, html: inner });
        }
    }

    // 后备: 直接找包含 href 的卡片
    if (blocks.length === 0) {
        var fallbackRe = /<(?:div|article)[^>]*>([\s\S]{100,800}?)<\/(?:div|article)>/gi;
        while ((m = fallbackRe.exec(html)) !== null) {
            if (m[1].match(/\/videos\/[^"'\s]+/) && m[1].indexOf('<img') !== -1) {
                blocks.push({ vid: '', html: m[1] });
            }
        }
    }

    var list = [];
    var seenHrefs = {};

    for (var bi = 0; bi < blocks.length && list.length < limit; bi++) {
        var block = blocks[bi];

        // ---- href ----
        var hrefM = block.html.match(new RegExp('href=' + q + '([^"'\\s]*\\/videos\\/[^"'\\s]+)' + q, 'i'));
        if (!hrefM) continue;
        var href = hrefM[1];
        if (!href.startsWith('http')) href = base + href;

        // 去重
        if (seenHrefs[href]) continue;
        seenHrefs[href] = true;

        // ---- 缩略图 ----
        var pic = '';
        var imgM = block.html.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
        if (imgM && imgM[1] && imgM[1].indexOf('blank') === -1) {
            pic = sanitizeUrl(imgM[1]);
        }
        if (!pic) {
            var dsM = block.html.match(/data-src="([^"]*)"/i);
            if (dsM) pic = sanitizeUrl(dsM[1]);
        }

        // ---- 标题 ----
        var title = '';
        // 方式A: img[alt]
        var altM = block.html.match(/<img[^>]*alt\s*=\s*"([^"]*)"[^>]*>/i);
        if (altM && altM[1] && altM[1].length >= 2 && altM[1] !== 'Video') title = clean(altM[1]);
        // 方式B: data-title / title 属性
        if (!title) {
            var dataT = block.html.match(/data-title\s*=\s*"([^"]*)"/i);
            if (dataT) title = clean(dataT[1]);
        }
        if (!title) {
            var titleAttr = block.html.match(/title\s*=\s*"([^"]*)"/i);
            if (titleAttr) title = clean(titleAttr[1]);
        }
        // 方式C: URL slug
        if (!title) {
            var slug = href.split('/').pop() || '';
            title = slug.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
            if (title.length < 2) title = '';
        }
        // 最终后备
        if (!title) title = '视频 ' + (list.length + 1);

        // ---- 时长 ----
        var duration = '';
        var durM = block.html.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]*)<\/span>/i);
        if (durM) duration = durM[1].trim();
        if (!duration) {
            var badgeM = block.html.match(/<span[^>]*class="[^"]*badge[^"]*"[^>]*>([^<]*)<\/span>/i);
            if (badgeM && /^\d/.test(badgeM[1].trim())) duration = badgeM[1].trim();
        }

        list.push({
            vod_id: href,
            vod_name: title.substring(0, 80),
            vod_pic: pic || '',
            vod_remarks: duration || '',
        });
    }

    return list;
}

// ---------- 从详情页提取视频直链 ----------

function extractVideoUrls(html) {
    var results = {
        mp4Urls: [],
        hlsUrls: [],
        masterHls: '',
    };

    // 要检查的 script 块
    var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = scriptRe.exec(html)) !== null) {
        var text = m[1];

        // 1. setVideoUrl series
        var sh = text.match(/setVideoUrl(?:High|Low)?\s*[=:]\s*["']([^"']+)["']/);
        if (sh && results.mp4Urls.indexOf(sh[1]) === -1) results.mp4Urls.push(sh[1]);

        // 2. 对象属性 src/url/file
        var srcRe = /(?:src|url|file)\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
        var sm;
        while ((sm = srcRe.exec(text)) !== null) {
            var u = sm[1];
            if (u.indexOf('.m3u8') !== -1) {
                if (results.hlsUrls.indexOf(u) === -1) results.hlsUrls.push(u);
                // Master playlist (含 _TPL_)
                if (u.indexOf('_TPL_') !== -1 && !results.masterHls) results.masterHls = u;
            } else if (u.indexOf('.mp4') !== -1) {
                if (results.mp4Urls.indexOf(u) === -1) results.mp4Urls.push(u);
            }
        }

        // 3. 全局 JS 变量 (xhVideoData / playerData / videoSources)
        var varNames = ['xhVideoData', 'playerData', 'videoConfig', 'videoSources',
                        'sources', 'hlsSources', 'mp4Sources'];
        for (var vi = 0; vi < varNames.length; vi++) {
            var vn = varNames[vi];
            // 尝试 JSON.parse 或对象字面量
            var vRe = new RegExp(vn + '\\s*[=:]\\s*(\\{[\\s\\S]{10,2000}\\})\\s*[;,]', 'i');
            var vM = vRe.exec(text);
            if (vM) {
                // 从JSON中提取URL字符串
                var urlRe = /["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/g;
                var um;
                while ((um = urlRe.exec(vM[1])) !== null) {
                    var vu = um[1];
                    if (vu.indexOf('.m3u8') !== -1) {
                        if (results.hlsUrls.indexOf(vu) === -1) results.hlsUrls.push(vu);
                        if (vu.indexOf('_TPL_') !== -1 && !results.masterHls) results.masterHls = vu;
                    } else if (vu.indexOf('.mp4') !== -1) {
                        if (results.mp4Urls.indexOf(vu) === -1) results.mp4Urls.push(vu);
                    }
                }
            }
        }

        // 4. 直接裸 URL (CDN 链接)
        var rawRe = /(https?:\/\/[^"'\s<>]*xhcdn[^"'\s<>]*\.(?:mp4|m3u8)[^"'\s<>,\]]*)/gi;
        var rm;
        while ((rm = rawRe.exec(text)) !== null) {
            var ru = rm[1];
            // 排除 thumb- / static- / ic-
            if (ru.indexOf('thumb-') !== -1 || ru.indexOf('static-') !== -1 || ru.indexOf('ic-') !== -1) continue;
            if (ru.indexOf('.m3u8') !== -1) {
                if (results.hlsUrls.indexOf(ru) === -1) results.hlsUrls.push(ru);
            } else if (ru.indexOf('.mp4') !== -1) {
                if (results.mp4Urls.indexOf(ru) === -1) results.mp4Urls.push(ru);
            }
        }
    }

    // 5. 后备: HTML body 中的裸 URL
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
            { type_id: '/categories', type_name: '所有分类' },
        ],
        filters: {},
    });
}

async function homeVod() {
    try {
        var base = getBaseUrl();
        var allList = [];
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

        var title = '';
        var pic = '';

        var t = html.match(/<title>([\s\S]*?)<\/title>/i);
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

        var urls = extractVideoUrls(html);

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
