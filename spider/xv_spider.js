/**
 * XVideos JS0 接口爬虫
 * 适配 FongMi TVBox 规范
 * 参考 clun_jianpian.js 格式
 */

let BASE = 'https://www.xvideos.com';
let UA = 'Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.023; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/96.0.4664.104 Mobile Safari/537.36';

async function init(cfg) {}

async function home(filter) {
    let classes = [
        {type_id: 'new/1', type_name: '最新视频'},
        {type_id: 'best/1', type_name: '最热视频'},
        {type_id: 'c/Amateur-65', type_name: 'Amateur'},
        {type_id: 'c/Anal-12', type_name: 'Anal'},
        {type_id: 'c/Asian_Woman-32', type_name: 'Asian'},
        {type_id: 'c/Blowjob-8', type_name: 'Blowjob'},
        {type_id: 'c/Japanese-161', type_name: 'Japanese'},
        {type_id: 'c/MILF-40', type_name: 'MILF'},
        {type_id: 'c/Teen-73', type_name: 'Teen'},
        {type_id: 'c/Lesbian-9', type_name: 'Lesbian'}
    ];
    return JSON.stringify({class: classes, filters: {}});
}

async function homeVod() {
    let res = await req(BASE, {headers: {'User-Agent': UA}});
    let html = res.content;
    let videos = [];
    let pattern = /<div class="thumb[^"]*"[^>]*>[\s\S]*?<a href="(\/video[^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<\/a>[\s\S]*?title="([^"]*)"[^>]*>[\s\S]*?<span class="duration">([^<]*)<\/span>/g;
    let m;
    while ((m = pattern.exec(html)) !== null) {
        videos.push({
            vod_id: m[1],
            vod_name: m[3].replace(/&[^;]+;/g, ' ').trim().substring(0, 50),
            vod_pic: m[2].startsWith('http') ? m[2] : BASE + m[2],
            vod_remarks: m[4].trim()
        });
    }
    return JSON.stringify({list: videos});
}

async function category(tid, pg, filter, extend) {
    let url = BASE + '/' + tid.replace(/\/\d+$/, '/' + pg);
    let res = await req(url, {headers: {'User-Agent': UA}});
    let html = res.content;
    let videos = [];
    let pattern = /<a href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
    let m;
    let seen = {};
    while ((m = pattern.exec(html)) !== null) {
        if (!seen[m[1]]) {
            seen[m[1]] = 1;
            videos.push({
                vod_id: m[1],
                vod_name: m[2].replace(/&[^;]+;/g, ' ').trim().substring(0, 50)
            });
        }
    }
    return JSON.stringify({page: parseInt(pg), list: videos, pagecount: 1000});
}

async function detail(id) {
    let url = id.startsWith('http') ? id : BASE + id;
    let res = await req(url, {headers: {'User-Agent': UA, 'Referer': BASE + '/'}});
    let html = res.content;

    let titleMatch = html.match(/<title>([^<]*)<\/title>/);
    let title = titleMatch ? titleMatch[1].replace(/&[^;]+;/g, ' ').replace(/- XVIDEOS\.COM/i, '').trim() : '';

    let imgMatch = html.match(/<meta property="og:image"[^>]*content="([^"]*)"/);
    let pic = imgMatch ? imgMatch[1] : '';

    let tagSet = new Set();
    let tagPattern = /<a href="\/(?:c|tags|kw)\/[^"]*"[^>]*>([^<]*)<\/a>/g;
    let t;
    while ((t = tagPattern.exec(html)) !== null) {
        let tag = t[1].trim();
        if (tag) tagSet.add(tag);
    }
    let tags = Array.from(tagSet).slice(0, 20).join(',');

    let descMatch = html.match(/<meta name="description"[^>]*content="([^"]*)"/);
    let desc = descMatch ? descMatch[1].substring(0, 300) : '';

    let sources = [];
    let high = html.match(/setVideoUrlHigh\('([^']+)'\)/);
    if (high) sources.push({name: '高清MP4', url: high[1]});
    let low = html.match(/setVideoUrlLow\('([^']+)'\)/);
    if (low) sources.push({name: '标清MP4', url: low[1]});
    let hls = html.match(/https?:\/\/[^"']+\.m3u8[^"',\s]*/);
    if (hls) sources.push({name: 'HLS流', url: hls[0]});

    let seenUrls = {};
    let unique = [];
    for (let i = 0; i < sources.length; i++) {
        if (!seenUrls[sources[i].url]) {
            seenUrls[sources[i].url] = 1;
            unique.push(sources[i]);
        }
    }

    let play_from = '';
    let play_url = '';
    if (unique.length > 0) {
        let lines = unique.map(s => s.name + '$' + s.url);
        play_from = '直链';
        play_url = lines.join('#');
    }

    let vod = {
        vod_id: id,
        vod_name: title,
        vod_pic: pic,
        vod_content: desc,
        vod_tag: tags,
        vod_play_from: play_from,
        vod_play_url: play_url
    };
    return JSON.stringify({list: [vod]});
}

async function search(wd, quick) {
    let url = BASE + '/?k=' + encodeURIComponent(wd);
    let res = await req(url, {headers: {'User-Agent': UA}});
    let html = res.content;
    let videos = [];
    let pattern = /<a href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
    let m;
    let seen = {};
    while ((m = pattern.exec(html)) !== null) {
        if (!seen[m[1]]) {
            seen[m[1]] = 1;
            videos.push({
                vod_id: m[1],
                vod_name: m[2].replace(/&[^;]+;/g, ' ').trim().substring(0, 50)
            });
        }
    }
    return JSON.stringify({list: videos});
}

async function play(flag, id, flags) {
    return JSON.stringify({parse: 0, url: id});
}

export default {init, home, homeVod, category, detail, search, play};
