// TVBox CatVod 爬虫 - xvideos.com
import { load, _ } from './lib/cat.js';

let key = '安全测试';
let HOST = 'https://www.xvideos.com';
let siteKey = '';
let siteType = 0;

// TVBox 真实 UA 池
const TVBOX_UA = [
    "okhttp/3.12",
    "okhttp/3.15",
    "Dalvik/2.1.0 (Linux; U; Android 11; MI 10 Pro Build/RKQ1.200826.002)",
    "Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)",
    "Mozilla/5.0 (Linux; Android 9; V2196A Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36;tvbox/1.0",
    "Mozilla/5.0 (Linux; Android 9; TV BOX Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36",
];

async function request(url, opt) {
    const ua = TVBOX_UA[Math.floor(Math.random() * TVBOX_UA.length)];
    let res = await req(url, {
        method: 'get',
        headers: Object.assign({ 'User-Agent': ua }, opt || {}),
    });
    return res.content;
}

async function init(cfg) {
    siteKey = cfg.skey;
    siteType = cfg.stype;
    if (cfg.ext && cfg.ext.base_url) HOST = cfg.ext.base_url;
}

async function home(filter) {
    const classes = [
        { type_id: '/new/1', type_name: '最新视频' },
        { type_id: '/best/1', type_name: '最受欢迎' },
        { type_id: '/rated/1', type_name: '最高评分' },
        { type_id: '/popular-search', type_name: '热门搜索' },
    ];
    return JSON.stringify({
        class: _.map(classes, cls => { cls.land = 1; cls.ratio = 1.78; return cls; }),
        filters: {},
    });
}

async function homeVod() {
    try {
        const html = await request(HOST + '/');
        const $ = load(html);
        const items = $('div.thumb-block');
        let videos = _.map(items, it => {
            const a = $(it).find('a:first')[0];
            const img = $(it).find('img:first')[0];
            const title = $(it).find('p.title a, p.title')[0];
            const duration = $(it).find('span.duration')[0];
            let vod_id = a ? a.attribs.href : '';
            let vod_pic = img ? (img.attribs.src || img.attribs['data-src'] || '') : '';
            let vod_name = title ? (title.attribs.title || title.children?.[0]?.data || '') : '';
            let vod_remarks = duration ? (duration.children?.[0]?.data || '').trim() : '';
            return { vod_id, vod_name: vod_name.trim(), vod_pic, vod_remarks };
        });
        videos = videos.filter(v => v.vod_id && v.vod_name);
        return JSON.stringify({ list: videos });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

async function category(tid, pg, filter, extend) {
    if (pg <= 0 || typeof pg == 'undefined') pg = 1;
    try {
        let url;
        if (tid === '/new/1' || tid === '/best/1' || tid === '/rated/1') {
            url = HOST + tid.replace(/\/\d+$/, '') + '/' + pg;
        } else {
            url = HOST + (tid.startsWith('/') ? tid : '/' + tid);
        }
        const html = await request(url);
        const $ = load(html);
        const items = $('div.thumb-block, div.thumb-inside');
        let videos = _.map(items, it => {
            const a = $(it).find('a:first')[0];
            const img = $(it).find('img:first')[0];
            const title = $(it).find('p.title a, p.title')[0];
            let vod_id = a ? a.attribs.href : '';
            let vod_pic = img ? (img.attribs.src || img.attribs['data-src'] || '') : '';
            let vod_name = title ? (title.attribs.title || title.children?.[0]?.data || '') : '';
            return { vod_id, vod_name: vod_name.trim(), vod_pic };
        });
        videos = _.filter(videos, v => v.vod_id && v.vod_name);
        return JSON.stringify({
            page: parseInt(pg),
            pagecount: 100,
            limit: 30,
            total: 3000,
            list: videos,
        });
    } catch (e) {
        return JSON.stringify({ page: parseInt(pg), pagecount: 0, limit: 30, total: 0, list: [] });
    }
}

async function detail(id) {
    try {
        const url = HOST + (id.startsWith('/') ? id : '/' + id);
        const html = await request(url);
        const $ = load(html);

        let title = $('title')[0]?.children?.[0]?.data || '';
        title = title.replace(/ - xvideos\.com.*$/i, '').trim();

        let pic = '';
        const og = $('meta[property="og:image"]')[0];
        if (og) pic = og.attribs.content;

        let desc = '';
        const d = $('meta[name="description"]')[0];
        if (d) desc = d.attribs.content?.slice(0, 300) || '';

        // 提取视频直链
        const vod = {
            vod_id: id,
            vod_name: title || '视频',
            vod_pic: pic || '',
            vod_content: desc || '',
        };

        // 从页面中提取 setVideoUrlHigh/Low
        const scripts = $('script');
        let videoUrl = '';
        let videoUrlLow = '';
        _.each(scripts, s => {
            const text = s.children?.[0]?.data || '';
            const high = text.match(/setVideoUrlHigh\s*\(\s*'([^']+)'\s*\)/);
            if (high) videoUrl = high[1];
            const low = text.match(/setVideoUrlLow\s*\(\s*'([^']+)'\s*\)/);
            if (low) videoUrlLow = low[1];
        });

        if (videoUrl) {
            vod.vod_play_from = '高清';
            vod.vod_play_url = '高清MP4$' + videoUrl;
            if (videoUrlLow) {
                vod.vod_play_from += '$$$标清';
                vod.vod_play_url += '#' + '标清MP4$' + videoUrlLow;
            }
        } else {
            // 从 HTML 中直接搜索 m3u8/mp4
            const hls = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>,]*/);
            const mp4 = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>,]*(?![^<]*preview)/);
            if (hls) {
                vod.vod_play_from = '线路1';
                vod.vod_play_url = 'HLS流$' + hls[0];
            } else if (mp4) {
                vod.vod_play_from = '线路1';
                vod.vod_play_url = 'MP4直链$' + mp4[0];
            } else {
                vod.vod_play_from = key;
                vod.vod_play_url = '直接播放$' + url;
            }
        }

        return JSON.stringify({ list: [vod] });
    } catch (e) {
        return JSON.stringify({
            list: [{ vod_id: id, vod_name: '加载失败', vod_pic: '', vod_play_from: key, vod_play_url: '播放$' + (HOST + (id.startsWith('/') ? id : '/' + id)) }],
        });
    }
}

async function play(flag, id, flags) {
    return JSON.stringify({ parse: 0, url: id });
}

async function search(wd, quick, pg) {
    pg = pg || 1;
    try {
        const html = await request(HOST + '/?k=' + encodeURIComponent(wd));
        const $ = load(html);
        const items = $('div.thumb-block');
        let videos = _.map(items, it => {
            const a = $(it).find('a:first')[0];
            const title = $(it).find('p.title a, p.title')[0];
            return {
                vod_id: a ? a.attribs.href : '',
                vod_name: title ? (title.attribs.title || title.children?.[0]?.data || '').trim() : '',
            };
        });
        videos = _.filter(videos, v => v.vod_id && v.vod_name);
        return JSON.stringify({ list: videos, page: parseInt(pg) });
    } catch (e) {
        return JSON.stringify({ list: [], page: parseInt(pg) });
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