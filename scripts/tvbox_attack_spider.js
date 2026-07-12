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

// 从URL slug提取标题 (针对"最受欢迎"页面无title属性的情况)
function urlToTitle(vodId) {
    try {
        if (!vodId) return '';
        const parts = vodId.split('/');
        if (parts.length < 3) return '';
        const slug = decodeURIComponent(parts.slice(2).join('/'));
        let t = slug.replace(/[_-]/g, ' ');
        t = t.replace(/\s+/g, ' ').trim();
        if (/^\d{3,4}p$|^4K$|^HD$/i.test(t)) return '';
        if (t.length < 3) return '';
        // 首字母大写
        return t.charAt(0).toUpperCase() + t.slice(1);
    } catch (e) { return ''; }
}

// 从文本中提取时长 (如 "12分钟", "10min", "1h 30min")
function extractDuration(text) {
    if (!text) return '';
    const m = text.match(/(\d+)\s*(?:分钟|min|分)\s*(?:\d+\s*秒)?/i);
    if (m) return m[1] + '分钟';
    const m2 = text.match(/(\d+):(\d{2})/);
    if (m2) return m2[1] + ':' + m2[2];
    return '';
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
    const q = '["\']';

    // ---- 第1部分: 按容器块提取 href + img (保证封面统一) ----
    const blockRe = /<div[^>]*class="[^"]*thumb-block[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>)?/gi;
    const blocks = [];
    let m;
    while ((m = blockRe.exec(html)) !== null) {
        const inner = m[1].trim();
        // 只保留有 video 链接的块
        if (inner && inner.match(new RegExp('/video[^"\'\\s]*', 'i'))) {
            blocks.push(inner);
        }
    }
    console.log('[parseVideoList] thumb-block数: ' + blocks.length);

    // 后备容器
    if (blocks.length === 0) {
        const fallbacks = [
            { re: /<article[^>]*>([\s\S]*?)<\/article>/gi, name: 'article' },
            { re: /<div[^>]*class="[^"]*video-[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, name: 'video-' },
        ];
        for (const fb of fallbacks) {
            while ((m = fb.re.exec(html)) !== null) {
                if (m[1].match(new RegExp('/video[^"\'\\s]*', 'i')) && m[1].includes('<img')) {
                    blocks.push(m[1]);
                }
            }
            if (blocks.length > 0) {
                console.log('[parseVideoList] 用' + fb.name + '后备: ' + blocks.length + ' 块');
                break;
            }
        }
    }
    if (blocks.length === 0) {
        console.log('[parseVideoList] 无容器! HTML(0-1500): ' + html.substring(0, 1500).replace(/\n/g, ' ').replace(/\s+/g, ' '));
    }

    // 从块中提取 href 和 img (一一对应)
    const hrefList = [];
    const imgList = [];
    for (const block of blocks) {
        const hrefM = block.match(new RegExp('href=' + q + '(\\/video[^"\'\\s]*)' + q, 'i'));
        if (!hrefM) continue;
        const href = hrefM[1];
        // 去重
        if (hrefList.some(h => h === href)) continue;

        // 提取图片 (data-src优先)
        let imgUrl = '';
        const ds = block.match(new RegExp('<img[^>]*data-src=' + q + '([^"\'<]*)' + q, 'i'));
        if (ds && !ds[1].includes('blank.gif') && !ds[1].includes('data:image')) {
            imgUrl = ds[1];
        } else {
            const s = block.match(new RegExp('<img[^>]*src=' + q + '([^"\'<]*)' + q, 'i'));
            if (s && !s[1].includes('blank.gif') && !s[1].includes('data:image') && !s[1].includes('/assets/')) {
                imgUrl = s[1];
            }
        }

        hrefList.push(href);
        imgList.push(imgUrl);
    }
    console.log('[parseVideoList] 块提取: ' + hrefList.length + ' href, ' + imgList.filter(i => i).length + ' img');

    // ---- 第2部分: 全局提取标题和时长 ----
    // 标题: 按 href 建立映射
    const titleByHref = {};
    let tc = 0;
    // 清晰度标签过滤
    const qualRe = /^\d{3,4}p$|^4K$|^HD$/i;
    // 方式A: <a href="/video.xxx" title="标题">
    const tA = new RegExp('<a\\s+href=' + q + '(\\/video[^"\'\\s]*)' + q + '[^>]*title=' + q + '([^"\'<]*)' + q, 'gi');
    while ((m = tA.exec(html)) !== null) {
        if (!titleByHref[m[1]]) { titleByHref[m[1]] = clean(m[2]); tc++; }
    }
    // 方式B: <a href="/video.xxx">文本</a> (跳过img和清晰度标签)
    const tB = /<a[^>]*href=["'](\/video[^"\'\s]*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = tB.exec(html)) !== null) {
        if (!titleByHref[m[1]]) {
            const txt = m[2].replace(/<[^>]+>/g, '').trim();
            if (txt && !qualRe.test(txt)) { titleByHref[m[1]] = clean(txt); tc++; }
        }
    }
    // 方式C: URL slug后备 (针对best页面无标题文本)
    for (const href of hrefList) {
        if (!titleByHref[href]) {
            const slugT = urlToTitle(href);
            if (slugT) { titleByHref[href] = slugT; tc++; }
        }
    }
    console.log('[parseVideoList] 全局标题: ' + tc + ' 个');

    // 时长: 按出现顺序收集
    const durations = [];
    // 方式A: <span class="duration">10min</span>
    const durRe = /<span[^>]*class="duration"[^>]*>([^<]*)<\/span>/gi;
    while ((m = durRe.exec(html)) !== null) {
        const d = m[1].trim();
        durations.push(d);
    }
    console.log('[parseVideoList] span时长: ' + durations.length + ' 个');
    // 方式B: 页面上找文本时长 (格式: "10分钟", "12min") 作为后备
    if (durations.length === 0) {
        const textDurRe = /(\d{1,3})\s*(?:分钟|min|分)/gi;
        const textDurs = [];
        while ((m = textDurRe.exec(html)) !== null) {
            textDurs.push(m[1] + '分钟');
        }
        console.log('[parseVideoList] 文本时长: ' + textDurs.length + ' 个');
        // 按顺序填充
        for (let i = 0; i < textDurs.length && durations.length < hrefList.length; i++) {
            durations.push(textDurs[i]);
        }
    }

    // ---- 第3部分: 合并结果 ----
    const list = [];
    for (let i = 0; i < hrefList.length && list.length < limit; i++) {
        const href = hrefList[i];
        const pic = imgList[i] ? makeImgUrl(imgList[i], base) : '';
        list.push({
            vod_id: href,
            vod_name: titleByHref[href] || '',
            vod_pic: pic,
            vod_remarks: durations[i] || '',
        });
        if (list.length <= 3) {
            console.log('[parseVideoList] 视频' + i + ': ' + (titleByHref[href] || '无标题') + ' | ' + (durations[i] || ''));
        }
    }
    console.log('[parseVideoList] 最终列表: ' + list.length + ' 个 (限制: ' + limit + ')');
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
    CAT_BASE = '';
    try {
        const base = getBaseUrl();
        const allList = [];
        // 获取最新视频前2页和新/旧混合
        const pages = ['/new/1', '/new/2', '/best/1'];
        for (const p of pages) {
            try {
                const url = base + p;
                console.log('[homeVod] 请求: ' + url);
                const resp = await req(url, { headers: { 'User-Agent': randomUA() }, method: 'get' });
                const html = resp.content || '';
                if (html.length < 500) continue;
                const list = parseVideoList(html, base, 30);
                allList.push.apply(allList, list);
                console.log('[homeVod] ' + p + ' 获取 ' + list.length + ' 个');
            } catch (e) {
                console.log('[homeVod] ' + p + ' 失败: ' + (e.message || e));
            }
        }
        console.log('[homeVod] 总计: ' + allList.length + ' 个视频');
        return JSON.stringify({ list: allList });
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
