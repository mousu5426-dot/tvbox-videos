/**
 * TVBox JS0 爬虫 - xvideos.com
 * 独立文件，无外部依赖，使用 JS0/drpy2 标准接口
 */
const TVBOX_UA = [
    "okhttp/3.12",
    "okhttp/3.15",
    "Dalvik/2.1.0 (Linux; U; Android 11; MI 10 Pro Build/RKQ1.200826.002)",
    "Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)",
    "Mozilla/5.0 (Linux; Android 9; V2196A Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36;tvbox/1.0",
    "Mozilla/5.0 (Linux; Android 9; TV BOX Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36",
];

let HOST = 'https://www.xvideos.com';
let siteKey = '';
let siteType = 0;
let CAT_BASE = ''; // 当前分类的base URL (支持跨域)

function getExt() { try { return typeof ext !== 'undefined' ? ext : {}; } catch (e) { return {}; } }
function getBaseUrl() { const cfg = getExt(); return cfg.base_url || HOST; }
function randomUA() { return TVBOX_UA[Math.floor(Math.random() * TVBOX_UA.length)]; }

function clean(s) {
    if (!s) return '';
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

function sanitizeUrl(url) {
    if (!url) return url;
    url = url.replace('THUMBNUM', '0');
    url = url.replace(/\{catePg\}/g, '1');
    url = url.replace(/\{pg\}/g, '1');
    url = url.replace(/\{[^}]+\}/g, '0');
    return url;
}

function makeImgUrl(img, base) {
    if (!img) return '';
    img = sanitizeUrl(img);
    if (img.startsWith('//')) return 'https:' + img;
    if (!img.startsWith('http')) return base + (img.startsWith('/') ? img : '/' + img);
    return img;
}

function parseVideoList(html, base, limit) {
    limit = limit || 40;
    const q = '["\']'; // 匹配单引号或双引号

    // 第1步: 按顺序收集所有 video 链接的 href (兼容单/双引号)
    const hrefRe = new RegExp('<a\\s+href=' + q + '(\\/video[^"\'\\s]*)' + q + '[^>]*>', 'gi');
    const hrefs = [];
    let m;
    while ((m = hrefRe.exec(html)) !== null) {
        if (!hrefs.some(h => h === m[1])) hrefs.push(m[1]);
    }
    console.log('[parseVideoList] video链接数: ' + hrefs.length);
    if (hrefs.length === 0) {
        console.log('[parseVideoList] HTML片段(前1500字): ' + html.substring(0, 1500).replace(/\n/g, ' ').replace(/\s+/g, ' '));
    }

    // 第2步: 按顺序收集页面上所有有效图片URL
    const imgRe = new RegExp('<img[^>]*(?:data-src|src)\\s*=\\s*' + q + '([^"\'<]*)' + q + '[^>]*>', 'gi');
    const allImgs = [];
    while ((m = imgRe.exec(html)) !== null) {
        const url = m[1];
        if (url && !url.includes('blank.gif') && !url.includes('data:image') && !url.includes('/assets/')) {
            allImgs.push(url);
        }
    }
    console.log('[parseVideoList] 有效图片数: ' + allImgs.length);

    // 第3步: 收集标题 - 多种方式
    const titleMap = {};
    let titleCount = 0;
    // 方式A: a[href^="/video"][title]
    const titleReA = new RegExp('<a\\s+href=' + q + '(\\/video[^"\'\\s]*)' + q + '[^>]*title=' + q + '([^"\'<]*)' + q + '[^>]*>', 'gi');
    while ((m = titleReA.exec(html)) !== null) {
        const name = clean(m[2]);
        if (m[1] && name && !titleMap[m[1]]) { titleMap[m[1]] = name; titleCount++; }
    }
    // 方式B: <p class="title"> 内找 a[href^="/video"]
    const titleReB = /<p[^>]*class="title"[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = titleReB.exec(html)) !== null) {
        const pHtml = m[1];
        const aMatch = pHtml.match(new RegExp('<a\\s+href=' + q + '(\\/video[^"\'\\s]*)' + q + '[^>]*>([\\s\\S]*?)<\\/a>', 'i'));
        if (aMatch) {
            const href = aMatch[1];
            const name = clean(aMatch[2].replace(/<[^>]+>/g, ''));
            if (href && name && !titleMap[href]) { titleMap[href] = name; titleCount++; }
        }
    }
    // 方式C: 从 <a href="/video..."> 标签内的文本提取标题
    const titleReC = new RegExp('<a\\s+href=' + q + '(\\/video[^"\'\\s]*)' + q + '[^>]*>([\\s\\S]*?)<\\/a>', 'gi');
    while ((m = titleReC.exec(html)) !== null) {
        const href = m[1];
        if (titleMap[href]) continue;
        const text = m[2].replace(/<[^>]+>/g, '').trim();
        if (href && text) { titleMap[href] = clean(text); titleCount++; }
    }
    console.log('[parseVideoList] 标题数: ' + titleCount);

    // 第4步: 收集时长
    const durRe = /<span\s+class="duration"[^>]*>([^<]*)<\/span>/gi;
    const durations = [];
    while ((m = durRe.exec(html)) !== null) { durations.push(m[1].trim()); }
    console.log('[parseVideoList] 时长数: ' + durations.length);

    // 第5步: 合并 - 按顺序配对
    const list = [];
    for (let i = 0; i < hrefs.length && list.length < limit; i++) {
        const href = hrefs[i];
        const pic = i < allImgs.length ? makeImgUrl(allImgs[i], base) : '';
        list.push({
            vod_id: href,
            vod_name: titleMap[href] || '',
            vod_pic: pic,
            vod_remarks: durations[i] || '',
        });
    }
    console.log('[parseVideoList] 最终列表: ' + list.length + ' 个 (限制: ' + limit + ')');
    if (list.length > 0) {
        console.log('[parseVideoList] 首个: ' + list[0].vod_name + ' | ' + list[0].vod_pic);
    }
    return list;
}

async function init(cfg) {
    siteKey = cfg.skey;
    siteType = cfg.stype;
    if (cfg.ext && cfg.ext.base_url) HOST = cfg.ext.base_url;
    console.log('[init] HOST=' + HOST + ' siteKey=' + siteKey);
}

async function home() {
    console.log('[home] 被调用');
    return JSON.stringify({
        class: [
            { type_id: '/new/1', type_name: '最新视频' },
            { type_id: '/best/1', type_name: '最受欢迎' },
            { type_id: 'https://www.xvideos.red/red/videos?sxcaf=4353LFJE75&xsc=mct', type_name: 'VIP视频(ren)' },
        ],
        filters: {},
    });
}

async function homeVod() {
    console.log('[homeVod] 开始执行');
    CAT_BASE = '';
    try {
        const base = getBaseUrl();
        const url = base + '/new/1';
        console.log('[homeVod] 请求URL: ' + url);
        const resp = await req(url, { headers: { 'User-Agent': randomUA() }, method: 'get' });
        const html = resp.content || '';
        console.log('[homeVod] 响应长度: ' + html.length + ' 字符');
        if (html.length < 500) {
            console.log('[homeVod] 警告: 响应太短, 可能被拦截');
        }
        const list = parseVideoList(html, base, 40);
        console.log('[homeVod] 返回列表: ' + list.length + ' 个视频');
        return JSON.stringify({ list });
    } catch (e) {
        console.log('[homeVod] 错误: ' + (e.message || e));
        return JSON.stringify({ list: [] });
    }
}

async function category(tid, pg, filter, extend) {
    pg = pg || 1;
    if (pg <= 0) pg = 1;
    console.log('[category] tid=' + tid + ' pg=' + pg);
    try {
        let url, catBase;
        if (tid.startsWith('http')) {
            // 绝对URL: 直接使用, 用 &p= 分页
            const sep = tid.includes('?') ? '&' : '?';
            url = tid + (pg > 1 ? sep + 'p=' + pg : '');
            const m = tid.match(/^https?:\/\/[^\/]+/);
            catBase = m ? m[0] : getBaseUrl();
            CAT_BASE = catBase;
        } else {
            const base = getBaseUrl();
            const path = tid.replace(/\/\d+$/, '');
            url = base + path + '/' + pg;
            catBase = base;
            CAT_BASE = '';
        }
        console.log('[category] 请求URL: ' + url + ' catBase=' + catBase);
        const resp = await req(url, { headers: { 'User-Agent': randomUA() }, method: 'get' });
        const html = resp.content || '';
        console.log('[category] 响应长度: ' + html.length + ' 字符');
        const list = parseVideoList(html, catBase, 60);
        console.log('[category] 返回列表: ' + list.length + ' 个视频');
        return JSON.stringify({ page: pg, pagecount: 100, limit: 30, total: 3000, list });
    } catch (e) {
        console.log('[category] 错误: ' + (e.message || e));
        return JSON.stringify({ page: pg, pagecount: 0, limit: 30, total: 0, list: [] });
    }
}

async function detail(id) {
    console.log('[detail] id=' + id);
    try {
        const base = CAT_BASE || getBaseUrl();
        const url = base + (id.startsWith('/') ? id : '/' + id);
        console.log('[detail] 请求URL: ' + url);
        const resp = await req(url, { headers: { 'User-Agent': randomUA() } });
        const html = resp.content || '';
        console.log('[detail] 响应长度: ' + html.length + ' 字符');

        let title = '', pic = '', desc = '';

        const t = html.match(/<title>([\s\S]*?)<\/title>/i);
        if (t) title = clean(t[1]).replace(/ - (xvideos|xvideos\.red)\..*$/i, '');
        console.log('[detail] 标题: ' + title);

        const og = html.match(/<meta\s+property="og:image"[^>]*content="([^"]*)"/i);
        if (og) { pic = sanitizeUrl(og[1]); console.log('[detail] og:image: ' + pic); }

        const d = html.match(/<meta\s+name="description"[^>]*content="([^"]*)"/i);
        if (d) desc = d[1].slice(0, 300);

        const vod = { vod_id: id, vod_name: title || '视频', vod_pic: pic || '', vod_content: desc || '' };

        // 提取 setVideoUrlHigh/Low
        let highUrl = '', lowUrl = '';
        const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let m;
        while ((m = scriptRe.exec(html)) !== null) {
            const text = m[1];
            const h = text.match(/setVideoUrlHigh\s*\(\s*'([^']+)'\s*\)/);
            if (h) highUrl = h[1];
            const l = text.match(/setVideoUrlLow\s*\(\s*'([^']+)'\s*\)/);
            if (l) lowUrl = l[1];
        }
        console.log('[detail] highUrl=' + (highUrl ? '找到' : '未找到') + ' lowUrl=' + (lowUrl ? '找到' : '未找到'));

        if (highUrl) {
            vod.vod_play_from = '高清';
            vod.vod_play_url = '高清MP4$' + highUrl;
            if (lowUrl) {
                vod.vod_play_from += '$$$标清';
                vod.vod_play_url += '#' + '标清MP4$' + lowUrl;
            }
        } else {
            const hls = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>,]*/);
            const mp4 = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>,]*(?![^<]*preview)/);
            if (hls) { vod.vod_play_from = '线路1'; vod.vod_play_url = 'HLS流$' + hls[0]; console.log('[detail] 用m3u8后备'); }
            else if (mp4) { vod.vod_play_from = '线路1'; vod.vod_play_url = 'MP4直链$' + mp4[0]; console.log('[detail] 用mp4后备'); }
            else { vod.vod_play_from = '源'; vod.vod_play_url = '直接播放$' + url; console.log('[detail] 无直链,用原始URL'); }
        }

        return JSON.stringify({ list: [vod] });
    } catch (e) {
        console.log('[detail] 错误: ' + (e.message || e));
        return JSON.stringify({ list: [] });
    }
}

async function play(flag, id) {
    console.log('[play] flag=' + flag + ' id=' + id);
    return JSON.stringify({ parse: 0, url: id });
}

async function search(wd, pg) {
    pg = pg || 1;
    console.log('[search] wd=' + wd + ' pg=' + pg);
    try {
        const base = getBaseUrl();
        const url = base + '/?k=' + encodeURIComponent(wd);
        console.log('[search] 请求URL: ' + url);
        const resp = await req(url, { headers: { 'User-Agent': randomUA() } });
        const html = resp.content || '';
        console.log('[search] 响应长度: ' + html.length + ' 字符');
        const list = parseVideoList(html, base, 20);
        console.log('[search] 结果: ' + list.length + ' 个');
        return JSON.stringify({ list, page: pg });
    } catch (e) {
        console.log('[search] 错误: ' + (e.message || e));
        return JSON.stringify({ list: [], page: pg });
    }
}

export function __jsEvalReturn() {
    return { init, home, homeVod, category, detail, play, search };
}
