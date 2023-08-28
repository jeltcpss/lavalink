"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bandCampSearch = void 0;
const undici_1 = require("undici");
const http_1 = require("http");
const bandCampSearch = async (player, query, requestUser) => {
    let error = null;
    let tracks = [];
    try {
        const data = await (0, undici_1.fetch)(`https://bandcamp.com/api/nusearch/2/autocomplete?q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'android-async-http/1.4.1 (http://loopj.com/android-async-http)',
                'Cookie': '$Version=1'
            }
        });
        const json = await data.json();
        tracks = json?.results?.filter(x => !!x && typeof x === "object" && "type" in x && x.type === "t").map?.(item => player.LavalinkManager.utils.buildUnresolvedTrack({
            uri: item.url || item.uri,
            artworkUrl: item.img,
            author: item.band_name,
            title: item.name,
            identifier: item.id ? `${item.id}` : item.url?.split("/").reverse()[0],
        }, http_1.request));
    }
    catch (e) {
        error = e;
    }
    return {
        loadType: "search",
        exception: error,
        pluginInfo: {},
        playlist: null,
        tracks: tracks
    };
};
exports.bandCampSearch = bandCampSearch;
