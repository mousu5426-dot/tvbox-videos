/**
 * TVBox JS0 爬虫 - xvideos.com
 * 独立文件，无外部依赖，使用 JS0/drpy2 标准接口
 * GitHub: https://github.com/mousu5426-dot/tvbox-videos
 */

// ========================================================
// TVBox 客户端 UA 池
// ========================================================
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

function getExt() {
    try { return typeof ext !== 'undefined' ? ext : {}; } catch (e) { return {}; }
}

function getBaseUrl() {
    const cfg = getExt();
    return cfg.base_url || HOST;
}

function randomUA() {
    return TVBOX_UA[Math.floor(Math.random() * TVBOX_UA.length)];
}

function clean(s) {
    if (!s) return '';
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

async function init(cfg) {
    siteKey = cfg.skey;
    siteType = cfg.stype;
    if (cfg.ext && cfg.ext.base_url) HOST = cfg.ext.base_url;
}

async function home() {
    return JSON.stringify({
        class: [
            { type_id: '/new/1', type_name: '最新视频' },
            { type_id: '/best/1', type_name: '最受欢迎' },
            { type_id: '/rated/1', type_name: '最高评分' },
        ],
        filters: {},
    });
}

// 从 img 标签提取图片 URL（优先 data-src，后备 src）
function getImgUrl(el) {
    return el.attribs['data-src'] || el.attribs['data-thumb'] || el.attribs['src'] || '';
}
function makeImgUrl(img, base) {
    if (!img) return '';
    if (img.startsWith('//')) return 'https:' + img;
    if (!img.startsWith('http')) return base + (img.startsWith('/') ? img : '/' + img);
    return img;
}

async function homeVod() {
    try {
        const base = getBaseUrl();
        const resp = await req(base + '/', { headers: { 'User-Agent': randomUA() }, method: 'get' });
        const html = resp.content || '';
        const list = [];

        // 匹配 thumb-block 块
        const blockRe = /<div\s+class="thumb-block[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
        let m;
        while ((m = blockRe.exec(html)) !== null) {
            const block = m[1];
            const a = block.match(/<a\s+href="(\/video[^"]*)"/);
            if (!a) continue;
            const img = block.match(/<img[^>]*?(?:data-src|data-thumb|src)="([^"]*)"/);
            const titleMatch = block.match(/title="([^"]*)"/);
            const durMatch = block.match(/class="duration">([^<]*)</);
            const path = a[1];
            let imgUrl = img ? img[1] : '';
            const title = titleMatch ? clean(titleMatch[1]) : '';
            const dur = durMatch ? durMatch[1].trim() : '';
            imgUrl = makeImgUrl(imgUrl, base);
            if (path && title) list.push({ vod_id: path, vod_name: title, vod_pic: imgUrl, vod_remarks: dur });
            if (list.length >= 40) break;
        }

        // 后备：通用匹配
        if (list.length === 0) {
            const re2 = /<a\s+href="(\/video[^"]*)"[^>]*>[\s\S]*?<img[^>]*?(?:data-src|src)="([^"]*)"[^>]*>[\s\S]*?title="([^"]*)"[^>]*>/g;
            while ((m = re2.exec(html)) !== null) {
                const path = m[1];
                const imgUrl = makeImgUrl(m[2] || '', base);
                const title = clean(m[3]);
                if (path && title) list.push({ vod_id: path, vod_name: title, vod_pic: imgUrl, vod_remarks: '' });
                if (list.length >= 40) break;
            }
        }

        return JSON.stringify({ list });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

async function category(tid, pg, filter, extend) {
    pg = pg || 1;
    if (pg <= 0) pg = 1;
    try {
        const base = getBaseUrl();
        let url;
        if (tid === '/new/1' || tid === '/best/1' || tid === '/rated/1') {
            const path = tid.replace(/\/\d+$/, '');
            url = base + path + '/' + pg;
        } else {
            url = base + (tid.startsWith('/') ? tid : '/' + tid);
        }
        const resp = await req(url, { headers: { 'User-Agent': randomUA() }, method: 'get' });
        const html = resp.content || '';
        const list = [];

        // 用 thumb-block 块提取（和首页结构一致）
        const blockRe = /<div\s+class="thumb-block[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
        let m;
        while ((m = blockRe.exec(html)) !== null) {
            const block = m[1];
            const a = block.match(/<a\s+href="(\/video[^"]*)"/);
            if (!a) continue;
            const img = block.match(/<img[^>]*?(?:data-src|data-thumb|src)="([^"]*)"/);
            const titleMatch = block.match(/title="([^"]*)"/);
            const path = a[1];
            const imgUrl = makeImgUrl(img ? img[1] : '', base);
            const title = titleMatch ? clean(titleMatch[1]) : '';
            if (path && title) list.push({ vod_id: path, vod_name: title, vod_pic: imgUrl });
            if (list.length >= 60) break;
        }

        // 后备
        if (list.length === 0) {
            const re2 = /<a\s+href="(\/video[^"]*)"[^>]*>[\s\S]*?<img[^>]*?(?:data-src|src)="([^"]*)"[^>]*>[\s\S]*?title="([^"]*)"[^>]*>/g;
            while ((m = re2.exec(html)) !== null) {
                const imgUrl = makeImgUrl(m[2] || '', base);
                const title = clean(m[3]);
                if (m[1] && title) list.push({ vod_id: m[1], vod_name: title, vod_pic: imgUrl });
                if (list.length >= 60) break;
            }
        }

        return JSON.stringify({ page: pg, pagecount: 100, limit: 30, total: 3000, list });
    } catch (e) {
        return JSON.stringify({ page: pg, pagecount: 0, limit: 30, total: 0, list: [] });
    }
}

async function detail(id) {
    try {
        const base = getBaseUrl();
        const url = base + (id.startsWith('/') ? id : '/' + id);
        const resp = await req(url, { headers: { 'User-Agent': randomUA() } });
        const html = resp.content || '';

        let title = '';
        const t = html.match(/<title>([\s\S]*?)<\/title>/i);
        if (t) title = clean(t[1]).replace(/ - xvideos\.com.*$/i, '');

        let pic = '';
        const og = html.match(/<meta\s+property="og:image"[^>]*content="([^"]*)"/i);
        if (og) pic = og[1];

        let desc = '';
        const d = html.match(/<meta\s+name="description"[^>]*content="([^"]*)"/i);
        if (d) desc = d[1].slice(0, 300);

        const vod = { vod_id: id, vod_name: title || '视频', vod_pic: pic || '', vod_content: desc || '' };

        let videoUrl = '', videoUrlLow = '';
        const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g;
        let m;
        while ((m = scriptRe.exec(html)) !== null) {
            const text = m[1];
            const high = text.match(/setVideoUrlHigh\s*\(\s*'([^']+)'\s*\)/);
            if (high) videoUrl = high[1];
            const low = text.match(/setVideoUrlLow\s*\(\s*'([^']+)'\s*\)/);
            if (low) videoUrlLow = low[1];
        }

        if (videoUrl) {
            vod.vod_play_from = '高清';
            vod.vod_play_url = '高清MP4$' + videoUrl;
            if (videoUrlLow) {
                vod.vod_play_from += '$$$标清';
                vod.vod_play_url += '#' + '标清MP4$' + videoUrlLow;
            }
        } else {
            const hls = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>,]*/);
            const mp4 = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>,]*(?![^<]*preview)/);
            if (hls) {
                vod.vod_play_from = '线路1';
                vod.vod_play_url = 'HLS流$' + hls[0];
            } else if (mp4) {
                vod.vod_play_from = '线路1';
                vod.vod_play_url = 'MP4直链$' + mp4[0];
            } else {
                vod.vod_play_from = '源';
                vod.vod_play_url = '直接播放$' + url;
            }
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
        const base = getBaseUrl();
        const resp = await req(base + '/?k=' + encodeURIComponent(wd), { headers: { 'User-Agent': randomUA() } });
        const html = resp.content || '';
        const list = [];
        const re = /<a\s+href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const name = clean(m[2]);
            if (m[1] && name) { list.push({ vod_id: m[1], vod_name: name }); if (list.length >= 20) break; }
        }
        return JSON.stringify({ list, page: pg });
    } catch (e) {
        return JSON.stringify({ list: [], page: pg });
    }
}

export function __jsEvalReturn() {
    return {
        init: init,
        home: home,
        homeVod: homeVod,
        category: category,
        detail: detail,
        play: play,
        search: search,
    };
}