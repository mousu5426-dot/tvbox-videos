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
    // 替换 THUMBNUM 占位符为有效数字（参考 Python 版 _sanitize_url）
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

function extractImgUrl(html) {
    const ds = html.match(/data-src\s*=\s*"([^"]*)"/);
    if (ds && ds[1] && !ds[1].includes('blank.gif') && !ds[1].includes('data:image') && ds[1] !== '') return ds[1];
    const src = html.match(/src\s*=\s*"([^"]*)"/);
    if (src && src[1] && !src[1].includes('blank.gif') && !src[1].includes('data:image') && src[1] !== '') return src[1];
    return '';
}

function parseVideoList(html, base, limit) {
    limit = limit || 40;
    const entries = [];

    // 第1轮: 缩略图
    const thumbRe = /<a\s+href="(\/video[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = thumbRe.exec(html)) !== null) {
        const href = m[1];
        const inner = m[2];
        const img = extractImgUrl(inner);
        if (!img) continue;
        if (entries.some(e => e.vid === href)) continue;
        entries.push({ vid: href, pic: makeImgUrl(img, base) });
    }
    console.log('[parseVideoList] 缩略图匹配: ' + entries.length + ' 个');

    // 第2轮: 标题
    const titleRe = /<p[^>]*class="title"[^>]*>[\s\S]*?<a\s+href="(\/video[^"]*)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/gi;
    const titleMap = {};
    let titleCount = 0;
    while ((m = titleRe.exec(html)) !== null) {
        const name = clean(m[2] || (m[3] || '').replace(/<[^>]+>/g, ''));
        if (m[1] && name) { titleMap[m[1]] = name; titleCount++; }
    }
    console.log('[parseVideoList] 标题匹配: ' + titleCount + ' 个');

    // 第3轮: 时长
    const durRe = /<span\s+class="duration"[^>]*>([^<]*)<\/span>/gi;
    const durations = [];
    while ((m = durRe.exec(html)) !== null) { durations.push(m[1].trim()); }
    console.log('[parseVideoList] 时长匹配: ' + durations.length + ' 个');

    // 合并
    const list = [];
    for (let i = 0; i < entries.length && list.length < limit; i++) {
        const e = entries[i];
        list.push({
            vod_id: e.vid,
            vod_name: titleMap[e.vid] || '',
            vod_pic: e.pic,
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
        ],
        filters: {},
    });
}

async function homeVod() {
    console.log('[homeVod] 开始执行');
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
        const base = getBaseUrl();
        const path = tid.replace(/\/\d+$/, '');
        const url = base + path + '/' + pg;
        console.log('[category] 请求URL: ' + url);
        const resp = await req(url, { headers: { 'User-Agent': randomUA() }, method: 'get' });
        const html = resp.content || '';
        console.log('[category] 响应长度: ' + html.length + ' 字符');
        const list = parseVideoList(html, base, 60);
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
        const base = getBaseUrl();
        const url = base + (id.startsWith('/') ? id : '/' + id);
        console.log('[detail] 请求URL: ' + url);
        const resp = await req(url, { headers: { 'User-Agent': randomUA() } });
        const html = resp.content || '';
        console.log('[detail] 响应长度: ' + html.length + ' 字符');

        let title = '', pic = '', desc = '';

        const t = html.match(/<title>([\s\S]*?)<\/title>/i);
        if (t) title = clean(t[1]).replace(/ - xvideos\.com.*$/i, '');
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
