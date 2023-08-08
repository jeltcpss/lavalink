import { FilterManager, LavalinkFilterData } from "./Filters";
import { LavalinkManager } from "./LavalinkManager";
import { DEFAULT_SOURCES } from "./LavalinkManagerStatics";
import { LavalinkNode } from "./Node";
import { Queue, QueueSaver } from "./Queue";
import { PluginDataInfo, Track } from "./Track";
import { LavalinkPlayerVoiceOptions, SearchPlatform, SearchResult, LoadTypes } from "./Utils";

export type RepeatMode = "queue" | "track" | "off";
export interface PlayerOptions {
    guildId: string;
    voiceChannelId: string;
    
    volume?: number;
    vcRegion?: string;
    selfDeaf?: boolean;
    selfMute?: boolean;
    textChannelId?: string;
    node?: LavalinkNode|string;
    instaUpdateFiltersFix?:boolean;
    applyVolumeAsFilter?:boolean;
}

export interface PlayOptions {
    /** Which Track to play | don't provide, if it should pick from the Queue */
    track?: Track;
    /** Encoded Track to use, instead of the queue system... */
    encodedTrack?: string | null;
    /** Encoded Track to use&search, instead of the queue system (yt only)... */
    identifier?: string;
    /** The position to start the track. */
    position?: number;
    /** The position to end the track. */
    endTime?: number;
    /** Whether to not replace the track if a play payload is sent. */
    noReplace?: boolean;
    /** If to start "paused" */
    paused?: boolean;
    /** The Volume to start with */
    volume?: number;
    /** The Lavalink Filters to use | only with the new REST API */
    filters?: Partial<LavalinkFilterData>;
    voice?: LavalinkPlayerVoiceOptions;
}


export interface Player {
    filterManager: FilterManager;
    LavalinkManager: LavalinkManager;
    options: PlayerOptions;
    node: LavalinkNode;
    queue: Queue,
}

export class Player {

    // All properties
    public guildId: string;
    public voiceChannelId: string | null = null;
    public textChannelId: string | null = null;

    public playing: boolean = false;
    public paused: boolean = false;
    public repeatMode: RepeatMode = "off";
    public ping: number = 0;
    public wsPing: number = 0;

    public volume: number = 100;
    public lavalinkVolume: number = 100;

    public position: number = 0;

    /** When the player was created [Timestamp] (from lavalink) */
    public createdTimeStamp: number;
    /** If lavalink says it's connected or not */
    public connected: boolean|undefined = false;
    
    public voice: LavalinkPlayerVoiceOptions = {
        endpoint: null,
        sessionId: null,
        token: null
    };

    private readonly data: Record<string, unknown> = {};
    /**
     * Set custom data.
     * @param key
     * @param value
     */
    public set(key: string, value: unknown): void { 
        this.data[key] = value; 
        return;
    }
    /**
     * Get custom data.
     * @param key
     */
    public get<T>(key: string): T { return this.data[key] as T; }

    public clearData(): void {
        const toKeep = Object.keys(this.data).filter(v => v.startsWith("internal_"));
        for(const key in this.data) {
            if(toKeep.includes(key)) continue;
            delete this.data[key];
        }
        return;
    }

    public getAllData(): Record<string, unknown> { return Object.fromEntries(Object.entries(this.data).filter(v => !v[0].startsWith("internal_"))); }

    // constructor
    constructor(options: PlayerOptions, LavalinkManager:LavalinkManager) {
        this.options = options;
        this.filterManager = new FilterManager(this);
        this.LavalinkManager = LavalinkManager;
        
        this.guildId = this.options.guildId;
        this.voiceChannelId = this.options.voiceChannelId;
        this.textChannelId = this.options.textChannelId || null;

        this.node = this.LavalinkManager.nodeManager.leastUsedNodes.filter(v => options.vcRegion ? v.options?.regions?.includes(options.vcRegion) : true)[0] || this.LavalinkManager.nodeManager.leastUsedNodes[0] || null;
       
        if(!this.node) throw new Error("No available Node was found, please add a LavalinkNode to the Manager via Manager.NodeManager#createNode")
       
        if(this.LavalinkManager.options.playerOptions.volumeDecrementer) this.volume *= this.LavalinkManager.options.playerOptions.volumeDecrementer;
        
        this.LavalinkManager.emit("playerCreate", this);
        if(typeof options.volume === "number" && !isNaN(options.volume)) this.setVolume(options.volume);

        this.queue = new Queue({}, this.guildId, new QueueSaver(this.LavalinkManager.options.queueStore, this.LavalinkManager.options.queueOptions))
    }
    // all functions
    async play(options?: Partial<PlayOptions>) {
        if(options?.track && this.queue.isTrack(options?.track)) this.queue.setCurrent(options.track);
        if(!this.queue.currentTrack && this.queue.size) await this.queue._trackEnd(this.repeatMode === "queue")
        const track = this.queue.currentTrack;
        if(!track) throw new Error(`There is no Track in the Queue, nor provided in the PlayOptions`);
        
        if (typeof options?.volume === "number" && !isNaN(options?.volume)) {
            this.volume = Math.max(Math.min(options?.volume, 500), 0);
            let vol = Number(this.volume);
            if (this.LavalinkManager.options.playerOptions.volumeDecrementer) vol *= this.LavalinkManager.options.playerOptions.volumeDecrementer;
            this.lavalinkVolume = Math.floor(vol * 100) / 100;
            options.volume = vol;
        }
        this.set("lastposition", this.position);

        const finalOptions = {
            encodedTrack: track.encodedTrack,
            volume: this.lavalinkVolume,
            position: 0,
            ...options,
        };

        if("track" in finalOptions) delete finalOptions.track;
       
        if((typeof finalOptions.position !== "undefined" && isNaN(finalOptions.position)) || (typeof finalOptions.position === "number" && (finalOptions.position < 0 || finalOptions.position >= track.info.duration))) throw new Error("PlayerOption#position must be a positive number, less than track's duration");
        if((typeof finalOptions.volume !== "undefined" && isNaN(finalOptions.volume) || (typeof finalOptions.volume === "number" && finalOptions.volume < 0))) throw new Error("PlayerOption#volume must be a positive number");
        if((typeof finalOptions.endTime !== "undefined" && isNaN(finalOptions.endTime)) || (typeof finalOptions.endTime === "number" && (finalOptions.endTime < 0 || finalOptions.endTime >= track.info.duration))) throw new Error("PlayerOption#endTime must be a positive number, less than track's duration");
        if(typeof finalOptions.position === "number" && typeof finalOptions.endTime === "number" && finalOptions.endTime < finalOptions.position) throw new Error("PlayerOption#endTime must be bigger than PlayerOption#position")
        if("noReplace" in finalOptions) delete finalOptions.noReplace
        
        const now = performance.now();
        await this.node.updatePlayer({
            guildId: this.guildId,
            noReplace: options?.noReplace ?? false,
            playerOptions: finalOptions,
        });
        this.ping = Math.round((performance.now() - now) / 10) / 100;
    }

    async setVolume(volume:number, ignoreVolumeDecrementer:boolean = false) {
        volume = Number(volume);

        if (isNaN(volume)) throw new TypeError("Volume must be a number.");
        this.volume = Math.max(Math.min(volume, 500), 0);
        
        volume = Number(this.volume);
        if(this.LavalinkManager.options.playerOptions.volumeDecrementer && !ignoreVolumeDecrementer) volume *= this.LavalinkManager.options.playerOptions.volumeDecrementer;
        this.lavalinkVolume = Math.floor(volume * 100) / 100;

        const now = performance.now();
        if(this.LavalinkManager.options.playerOptions.applyVolumeAsFilter) {
            await this.node.updatePlayer({ guildId: this.guildId, playerOptions: { filters: { volume: volume / 100 } } });
        } else {
            await this.node.updatePlayer({ guildId: this.guildId, playerOptions: { volume } });
        }
        this.ping = Math.round((performance.now() - now) / 10) / 100;
        return;
    }

    async search(query:{ query: string, source?: SearchPlatform }, requestUser: unknown) {
        const _query = typeof query === "string" ? query : query.query;
        const _source = DEFAULT_SOURCES[query.source ?? this.LavalinkManager.options.playerOptions.defaultSearchPlatform] ?? query.source ?? this.LavalinkManager.options.playerOptions.defaultSearchPlatform;
        const srcSearch = !/^https?:\/\//.test(_query) ? `${_source}:` : "";
        const res = await this.node.makeRequest(`/loadtracks?identifier=${srcSearch}${encodeURIComponent(_query)}`) as {
            loadType: LoadTypes,
            data: any,
            pluginInfo: PluginDataInfo,
        };

        const resTracks = res.loadType === "playlist" ? res.data?.tracks : res.loadType === "track" ? [res.data] : res.loadType === "search" ? Array.isArray(res.data) ? res.data : [res.data] : [];

        const response = {
            loadType: res.loadType,
            exception: res.loadType === "error" ? res.data : null,
            pluginInfo: res.pluginInfo || {},
            playlist: res.loadType === "playlist" ? {
                name: res.data.info?.name || res.data.pluginInfo?.name || null,
                author: res.data.info?.author || res.data.pluginInfo?.author || null,
                thumbnail: (res.data.info?.artworkUrl) || (res.data.pluginInfo?.artworkUrl) || ((typeof res.data?.info?.selectedTrack !== "number" || res.data?.info?.selectedTrack === -1) ? null : resTracks[res.data?.info?.selectedTrack] ? (resTracks[res.data?.info?.selectedTrack]?.info?.artworkUrl || resTracks[res.data?.info?.selectedTrack]?.info?.pluginInfo?.artworkUrl) : null) || null,
                uri: res.data.info?.url || res.data.info?.uri || res.data.info?.link || res.data.pluginInfo?.url || res.data.pluginInfo?.uri || res.data.pluginInfo?.link || null,
                selectedTrack: typeof res.data?.info?.selectedTrack !== "number" || res.data?.info?.selectedTrack === -1 ? null : resTracks[res.data?.info?.selectedTrack] ? this.LavalinkManager.utilManager.buildTrack(resTracks[res.data?.info?.selectedTrack], requestUser) : null,
                duration: resTracks.length ? resTracks.reduce((acc, cur) => acc + (cur?.info?.duration || 0), 0) : 0,
            } : null,
            tracks: resTracks.length ? resTracks.map(t => this.LavalinkManager.utilManager.buildTrack(t, requestUser)) : []
        } as SearchResult;
        return response;
    }
    async pause() {
        if(this.paused && !this.playing) throw new Error("Player is already paused - not able to pause.");
        this.paused = true;
        const now = performance.now();
        await this.node.updatePlayer({ guildId: this.guildId, playerOptions: { paused: true } });
        this.ping = Math.round((performance.now() - now) / 10) / 100;
        return;
    }
    async resume() {
        if(!this.paused) throw new Error("Player isn't paused - not able to resume.");
        this.paused = false;
        const now = performance.now();
        await this.node.updatePlayer({ guildId: this.guildId, playerOptions: { paused: false } });
        this.ping = Math.round((performance.now() - now) / 10) / 100;
        return;
    }

    async seek(position:number) {
        if(!this.queue.currentTrack) return undefined;
        position = Number(position);
        if(isNaN(position)) throw new RangeError("Position must be a number.");
        if(!this.queue.currentTrack.info.isSeekable || this.queue.currentTrack.info.isStream) throw new RangeError("Current Track is not seekable / a stream");
        if(position < 0 || position > this.queue.currentTrack.info.duration) position = Math.max(Math.min(position, this.queue.currentTrack.info.duration), 0);
        this.position = position;
        this.set("internal_lastposition", this.position);
        const now = performance.now();
        await this.node.updatePlayer({ guildId:this.guildId, playerOptions: { position }});
        this.ping = Math.round((performance.now() - now) / 10) / 100;
        return;
    }

    async setRepeatMode(repeatMode:RepeatMode) {
        if(!["off", "track", "queue"].includes(repeatMode)) throw new RangeError("Repeatmode must be either 'off', 'track', or 'queue'");
        this.repeatMode = repeatMode;
        return;
    }


    /**
     * Skip a Song (on Lavalink it's called "STOP")
     * @param amount provide the index of the next track to skip to
     */
    async skip(skipTo:number = 0) {
        if(!this.queue.size) throw new RangeError("Can't skip more than the queue size")

        if(typeof skipTo === "number" && skipTo > 1) {
            if(skipTo > this.queue.size) throw new RangeError("Can't skip more than the queue size");
            this.queue.splice(0, skipTo - 1);
        }
        const now = performance.now();
        await this.node.updatePlayer({ guildId:this.guildId, playerOptions: { encodedTrack: null }});
        this.ping = Math.round((performance.now() - now) / 10) / 100;
        return true;
    }

    public async connect() {
        if(!this.options.voiceChannelId) throw new RangeError("No Voice Channel id has been set.");

        await this.LavalinkManager.options.sendToShard(this.guildId, {
            op: 4,
            d: {
                guild_id: this.guildId,
                channel_id: this.options.voiceChannelId,
                self_mute: this.options.selfMute ?? false,
                self_deaf: this.options.selfDeaf ?? true,
            }
        });

        return;
    }

    public async disconnect() {
        if(!this.options.voiceChannelId) throw new RangeError("No Voice Channel id has been set.");

        await this.LavalinkManager.options.sendToShard(this.guildId, {
            op: 4,
            d: {
                guild_id: this.guildId,
                channel_id: null,
                self_mute: false,
                self_deaf: false,
            }
        });

        this.voiceChannelId = null;

        return;
    }
    
    /**
     * Destroy the player
     */
    public async destroy(disconnect = true) {
        if(disconnect) await this.disconnect();
        
        await this.node.destroyPlayer(this.guildId);

        this.LavalinkManager.emit("playerDestroy", this);
        this.LavalinkManager.deletePlayer(this.guildId);
    }
}