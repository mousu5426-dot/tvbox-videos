/**
 * 镜像站安全测试 - TVBox JS 爬虫
 * 目标服务器: https://www.xvideos.com
 * 适配 TVBox/FongMi JS0 接口规范
 * 
 * 参考: tvbox_attack_spider.py (老师提供的 Python 爬虫)
 * 接口对照:
 *   Python TVBoxSpider.home()       → JS home()
 *   Python TVBoxSpider.homeVod()    → JS homeVod()
 *   Python TVBoxSpider.category()   → JS category()
 *   Python TVBoxSpider.detail()     → JS detail()
 *   Python TVBoxSpider.search()     → JS search()
 *   Python TVBoxSpider.play()       → JS play()
 */

let host = 'https://www.xvideos.com';
let UA = 'Mozilla/5.0 (Linux; Android 9; V2196A Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36';

async function init(cfg) {}

async function home(filter) {
    let html = await req(host + '/', { headers: { 'User-Agent': UA, 'Referer': host } });
    let body = html.content;
    let classes = [];
    let catRegex = /<a\s+href="(\/[^"]*)"[^>]*>([^<]*)<\/a>/g;
    let match;
    let seen = new Set();
    while ((match = catRegex.exec(body)) !== null) {
        let name = match[2].trim();
        if (name && name.length < 20 && !seen.has(name)) {
            seen.add(name);
            classes.push({type_id: match[1], type_name: name});
        }
    }
    return JSON.stringify({class: classes.slice(0, 20)});
}

async function homeVod() {
    let html = await req(host + '/', { headers: { 'User-Agent': UA, 'Referer': host } });
    let body = html.content;
    let videos = [];
    let blockRegex = /<div\s+class="thumb[^"]*"[^>]*>(.*?)<\/div>\s*<div\s+class="thumb-under">/gs;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(body)) !== null) {
        let block = blockMatch[1];
        let linkMatch = block.match(/href="(\/video[^"]*)"/);
        let imgMatch = block.match(/src="([^"]*)"/);
        let titleMatch = block.match(/title="([^"]*)"/);
        let durMatch = block.match(/<span\s+class="duration">([^<]*)<\/span>/);
        if (linkMatch && titleMatch) {
            let pic = imgMatch ? imgMatch[1] : '';
            if (pic && !pic.startsWith('http')) pic = host + pic;
            videos.push({vod_id: linkMatch[1], vod_name: titleMatch[1].trim(), vod_pic: pic, vod_remarks: durMatch ? durMatch[1].trim() : ''});
        }
    }
    if (videos.length === 0) {
        let altRegex = /<a\s+href="(\/video[^"]*)"[^>]*>.*?<img[^>]*src="([^"]*)"[^>]*>.*?<\/a>.*?title="([^"]*)"[^>]*>.*?(?:<span\s+class="duration">([^<]*)<\/span>)?/gs;
        let altMatch;
        while ((altMatch = altRegex.exec(body)) !== null) {
            let pic = altMatch[2] || '';
            if (pic && !pic.startsWith('http')) pic = host + pic;
            videos.push({vod_id: altMatch[1], vod_name: altMatch[3].trim(), vod_pic: pic, vod_remarks: altMatch[4] ? altMatch[4].trim() : ''});
        }
    }
    return JSON.stringify({ list: videos.slice(0, 40) });
}

async function category(tid, pg, filter, extend) {
    let url;
    if (pg > 1) {
        url = host + '/new/' + pg;
    } else {
        url = host + (tid.startsWith('/') ? tid : '/' + tid);
    }
    let html = await req(url, { headers: { 'User-Agent': UA, 'Referer': host } });
    let body = html.content;
    let videos = [];
    let regex = /<a\s+href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
        videos.push({vod_id: match[1], vod_name: match[2].trim(), vod_pic: ''});
    }
    let imgRegex = /<a\s+href="(\/video[^"]*)"[^>]*>.*?<img[^>]*src="([^"]*)"[^>]*>/gs;
    let imgMatch;
    let imgMap = {};
    while ((imgMatch = imgRegex.exec(body)) !== null) {
        let pic = imgMatch[2];
        if (pic && !pic.startsWith('http')) pic = host + pic;
        imgMap[imgMatch[1]] = pic;
    }
    for (let v of videos) {
        if (imgMap[v.vod_id]) v.vod_pic = imgMap[v.vod_id];
    }
    return JSON.stringify({page: parseInt(pg), pagecount: 1000, list: videos});
}

async function detail(id) {
    let url = host + (id.startsWith('/') ? id : '/' + id);
    let html = await req(url, { headers: { 'User-Agent': UA, 'Referer': host + '/' } });
    let body = html.content;
    let vod = {vod_id: id, vod_name: '', vod_pic: '', vod_content: '', vod_play_from: '', vod_play_url: ''};
    let titleMatch = body.match(/<title>(.*?)<\/title>/is);
    if (titleMatch) vod.vod_name = titleMatch[1].trim();
    let imgMatch = body.match(/<meta\s+property="og:image"[^>]*content="([^"]*)"/i);
    if (imgMatch) vod.vod_pic = imgMatch[1];
    let descMatch = body.match(/<meta\s+name="description"[^>]*content="([^"]*)"/i);
    if (descMatch) vod.vod_content = descMatch[1].substring(0, 300);
    let tags = [];
    let tagRegex = /<a\s+href="\/(?:c|tags|kw)\/([^"]*)"[^>]*>([^<]*)<\/a>/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(body)) !== null) {
        let tagName = tagMatch[2].trim();
        if (tagName && tags.indexOf(tagName) === -1) tags.push(tagName);
    }
    if (tags.length > 0) vod.vod_actor = tags.slice(0, 10).join(' ');
    let playItems = [];
    let seenUrls = new Set();
    let highRegex = /setVideoUrlHigh\s*\(\s*'([^']+)'\s*\)/g;
    let highMatch;
    while ((highMatch = highRegex.exec(body)) !== null) {
        let u = highMatch[1];
        if (!seenUrls.has(u)) { seenUrls.add(u); playItems.push({name: '高清MP4', url: u}); }
    }
    let lowRegex = /setVideoUrlLow\s*\(\s*'([^']+)'\s*\)/g;
    let lowMatch;
    while ((lowMatch = lowRegex.exec(body)) !== null) {
        let u = lowMatch[1];
        if (!seenUrls.has(u)) { seenUrls.add(u); playItems.push({name: '标清MP4', url: u}); }
    }
    let m3u8Regex = /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/g;
    let m3u8Match;
    while ((m3u8Match = m3u8Regex.exec(body)) !== null) {
        let u = m3u8Match[0];
        if (!seenUrls.has(u)) { seenUrls.add(u); playItems.push({name: 'HLS流', url: u}); }
    }
    if (playItems.length > 0) {
        vod.vod_play_from = '直链';
        vod.vod_play_url = playItems.map(function(item) { return item.name + '$' + item.url; }).join('#');
    }
    return JSON.stringify({ list: [vod] });
}

async function search(wd, quick) {
    let url = host + '/?k=' + encodeURIComponent(wd);
    let html = await req(url, { headers: { 'User-Agent': UA, 'Referer': host } });
    let body = html.content;
    let videos = [];
    let regex = /<a\s+href="(\/video[^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
        videos.push({vod_id: match[1], vod_name: match[2].trim(), vod_pic: ''});
    }
    return JSON.stringify({list: videos.slice(0, 20)});
}

async function play(flag, id, flags) {
    return JSON.stringify({parse: 0, url: id});
}

export default {init: init, home: home, homeVod: homeVod, category: category, detail: detail, search: search, play: play};
