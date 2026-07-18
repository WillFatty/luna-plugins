import { LunaUnload, reduxStore, Tracer } from "@luna/core";
import { ipcRenderer, MediaItem, PlayState, redux, safeInterval, TidalApi } from "@luna/lib";
import { startServer, stopServer, updateFields } from "./index.native";
import { settings } from "./Settings";
import type { ActionData, ActionHandler } from "./types";

declare global {
    interface Window {
        __apiInvokeAction?: (data: ActionData & { action: string }) => Promise<unknown>;
    }
}

const portCheckInt = 5000;

export const { trace } = Tracer("[API]");
export const unloads = new Set<LunaUnload>();
export { Settings } from "./Settings";

type QueueTrackMeta = {
    coverUrl: string | null;
    title: string | null;
    artists: string[] | null;
    duration: number | null;
};

const QUEUE_META_BATCH = 25;

const queueMetaCache = new Map<string, QueueTrackMeta>();
let lastQueueFingerprint = "";
let queueUpdateGeneration = 0;

const emptyQueueMeta = (): QueueTrackMeta => ({
    coverUrl: null,
    title: null,
    artists: null,
    duration: null,
});

const resolveQueueTrackMeta = async (mediaItemId: string | number): Promise<QueueTrackMeta> => {
    const id = String(mediaItemId);
    const cached = queueMetaCache.get(id);
    if (cached) return cached;

    try {
        const item = await MediaItem.fromId(mediaItemId);
        if (!item) {
            const empty = emptyQueueMeta();
            queueMetaCache.set(id, empty);
            return empty;
        }

        const coverUrl = (await item.coverUrl()) ?? null;
        const artists =
            item.tidalItem.artists
                ?.map((a) => a.name)
                .filter((name): name is string => Boolean(name?.trim())) ?? null;

        const meta: QueueTrackMeta = {
            coverUrl,
            title: item.tidalItem.title ?? null,
            artists: artists?.length ? artists : item.tidalItem.artist?.name ? [item.tidalItem.artist.name] : null,
            duration: item.duration ?? null,
        };
        queueMetaCache.set(id, meta);
        return meta;
    } catch (e) {
        trace.msg.err.withContext("resolveQueueTrackMeta", mediaItemId)(e);
        const empty = emptyQueueMeta();
        queueMetaCache.set(id, empty);
        return empty;
    }
};

/** Enrich playQueue elements with track metadata + coverUrl for WS/HTTP clients. */
const updateQueueFields = async () => {
    const gen = ++queueUpdateGeneration;
    const { playQueue } = PlayState;
    const elements = playQueue.elements ?? [];
    const fingerprint = `${playQueue.currentIndex}|${elements.map((el) => `${el.mediaItemId}:${el.uid}`).join(",")}`;

    const missingIds = [
        ...new Set(
            elements
                .map((el) => String(el.mediaItemId))
                .filter((id) => id && !queueMetaCache.has(id))
        ),
    ];

    if (fingerprint === lastQueueFingerprint && missingIds.length === 0) return;

    const pushEnrichedQueue = (queue: typeof playQueue) => {
        const queueElements = queue.elements ?? [];
        const activeIds = new Set(queueElements.map((el) => String(el.mediaItemId)));
        for (const id of queueMetaCache.keys()) {
            if (!activeIds.has(id)) queueMetaCache.delete(id);
        }

        const enrichedElements = queueElements.map((el) => {
            const id = String(el.mediaItemId);
            const meta = queueMetaCache.get(id);
            return {
                context: el.context,
                mediaItemId: id,
                priority: el.priority,
                uid: el.uid,
                coverUrl: meta?.coverUrl ?? null,
                title: meta?.title ?? null,
                artists: meta?.artists ?? null,
                duration: meta?.duration ?? null,
            };
        });

        updateFields({
            playQueue: {
                currentIndex: queue.currentIndex,
                elements: enrichedElements,
            },
        });
    };

    // Push structure immediately so clients see the full queue even before covers resolve.
    if (fingerprint !== lastQueueFingerprint) {
        lastQueueFingerprint = fingerprint;
        pushEnrichedQueue(playQueue);
    }

    if (missingIds.length === 0) return;

    // Resolve in batches — full library queues can be hundreds of tracks.
    for (let i = 0; i < missingIds.length; i += QUEUE_META_BATCH) {
        if (gen !== queueUpdateGeneration) return;
        const batch = missingIds.slice(i, i + QUEUE_META_BATCH);
        await Promise.all(batch.map((id) => resolveQueueTrackMeta(id)));
        if (gen !== queueUpdateGeneration) return;

        const latest = PlayState.playQueue;
        const latestElements = latest.elements ?? [];
        const latestFingerprint = `${latest.currentIndex}|${latestElements.map((el) => `${el.mediaItemId}:${el.uid}`).join(",")}`;
        if (latestFingerprint !== fingerprint) return;

        pushEnrichedQueue(latest);
    }
};

const updateMediaFields = async (item: MediaItem | undefined) => {
    if (!item) return;

    const [album, artist, coverUrl, isrc] = await Promise.all([
        item.album(),
        item.artist(),
        item.coverUrl(),
        item.isrc()
    ]);

    updateFields({
        album: album?.tidalAlbum,
        artist: artist?.tidalArtist,
        track: item.tidalItem,
        coverUrl,
        isrc,
        duration: item.duration,
        bestQuality: item.bestQuality
    });
    void updateQueueFields();
};

const updateStateFields = () => {
    const { playing, playTime, repeatMode, lastPlayStart, shuffle, currentTime } = PlayState;
    const { playbackControls } = redux.store.getState();

    const state: Record<string, unknown> = { playing, playTime, repeatMode, shuffle };

    if (!Number.isNaN(currentTime)) state.currentTime = currentTime;
    if (lastPlayStart && !Number.isNaN(lastPlayStart)) state.lastPlayStart = lastPlayStart;
    if (playbackControls.volume) state.volume = playbackControls.volume;
    if (typeof playbackControls.muted === "boolean") state.muted = playbackControls.muted;

    updateFields(state);
    void updateQueueFields();
};

/** Live progress from the player clock — not Redux's slower TIME_UPDATE cadence. */
const updateProgressFields = () => {
    const currentTime = PlayState.currentTime;
    const playTime = PlayState.playTime;
    const progress: Record<string, unknown> = {};
    if (!Number.isNaN(currentTime)) progress.currentTime = currentTime;
    if (!Number.isNaN(playTime)) progress.playTime = playTime;
    if (Object.keys(progress).length) updateFields(progress);
};

let progressRaf = 0;
const stopProgressLoop = () => {
    if (progressRaf) {
        cancelAnimationFrame(progressRaf);
        progressRaf = 0;
    }
};
const tickProgress = () => {
    updateProgressFields();
    if (PlayState.playing) {
        progressRaf = requestAnimationFrame(tickProgress);
    } else {
        progressRaf = 0;
    }
};
const startProgressLoop = () => {
    if (progressRaf || !PlayState.playing) return;
    progressRaf = requestAnimationFrame(tickProgress);
};
unloads.add(stopProgressLoop);

const setVolume = (volume: number) => {
    redux.actions["playbackControls/SET_VOLUME"]({ volume });
};

const handleVolumeChange = (volume: string | number) => {
    if (typeof volume === "string" && /^[-+]\d+$/.test(volume)) {
        const currentVol = reduxStore.getState().playbackControls.volume || 0;
        const newVol = Math.max(0, Math.min(100, currentVol + Number.parseInt(volume, 10)));
        setVolume(newVol);
    } else if (typeof volume === "number" && volume >= 0 && volume <= 100) {
        setVolume(volume);
    }
};

const resolveTrackId = async (itemId: string): Promise<string> => {
    const track = await MediaItem.fromId(itemId, "track");
    if (track) return String(track.id);

    const albumItems = await TidalApi.albumItems(itemId);
    const firstTrack = albumItems?.find((i) => i.type === "track");
    if (firstTrack) return String(firstTrack.id);

    const playlistItems = await TidalApi.playlistItems(itemId);
    const firstPlaylistTrack = playlistItems?.items?.find((i) => i.type === "track");
    if (firstPlaylistTrack) return String(firstPlaylistTrack.id);

    return itemId;
};

const addToQueue = async (itemId: string) => {
    const trackId = await resolveTrackId(itemId);
    redux.actions["playQueue/ADD_LAST"]({
        context: { type: "UNKNOWN", id: trackId },
        mediaItemIds: [trackId],
    });
};

const rendererActions: Record<string, (data: ActionData) => unknown> = {
    pause: PlayState.pause,
    resume: () => PlayState.play(),
    toggle: () => (PlayState.playing ? PlayState.pause() : PlayState.play()),
    next: PlayState.next,
    previous: PlayState.previous,
    setRepeatMode: (data) => typeof data.mode === "number" && PlayState.setRepeatMode(data.mode),
    setShuffleMode: (data) => {
        if (typeof data.shuffle === "boolean") {
            data.shuffle ? PlayState.setShuffle(true, true) : PlayState.setShuffle(false, true);
        }
    },
    seek: (data) => typeof data.time === "number" && PlayState.seek(data.time),
    volume: (data) => handleVolumeChange(data.volume as string | number),
    toggleMute: () => {
        redux.actions["playbackControls/TOGGLE_MUTE"]();
    },
    playNext: async (data) => {
        if (data.itemId) {
            const trackId = await resolveTrackId(data.itemId as string);
            PlayState.playNext(trackId);
        }
    },
    addToQueue: async (data) => data.itemId && addToQueue(data.itemId as string),
    playNow: async (data) => {
        if (data.itemId) {
            const trackId = await resolveTrackId(data.itemId as string);
            PlayState.play(trackId);
        }
    },
    playFromQueue: (data) => {
        if (data.itemId) {
            const itemId = data.itemId as string;
            const { elements, currentIndex } = PlayState.playQueue;
            const index = elements.findIndex((el: any) => String(el.mediaItemId) === itemId);
            if (index !== -1 && index !== currentIndex) {
                redux.actions["playQueue/MOVE_TO"](index);
                redux.actions["playbackControls/PLAY"]();
            }
        }
    },
    addPlaylistToQueue: async (data) => {
        if (!data.playlistId) return;
        const playlistId = data.playlistId as string;
        const playlistItems = await TidalApi.playlistItems(playlistId);
        if (!playlistItems?.items?.length) return;

        const trackIds = playlistItems.items
            .filter((item) => item.type === "track")
            .map((item) => String(item.item.id));
        if (trackIds.length === 0) return;

        // Add immediately — do not block the WS response on per-track MediaItem preloads.
        redux.actions["playQueue/ADD_LAST"]({
            context: { type: "PLAYLIST", id: playlistId },
            mediaItemIds: trackIds,
        });

        // Warm cache in the background so covers/titles resolve sooner.
        void Promise.all(trackIds.map((id) => MediaItem.fromId(id).catch(() => undefined)));
    },
    removeFromQueue: (data) => {
        if (data.itemId) {
            const itemId = data.itemId as string;
            const { elements } = PlayState.playQueue;
            const index = elements.findIndex((el: any) => String(el.mediaItemId) === itemId);
            if (index !== -1) {
                redux.actions["playQueue/REMOVE_AT_INDEX"]({ index });
            }
        }
    },
    clearQueue: () => {
        redux.actions["playQueue/CLEAR_QUEUE"]();
    },
};

startServer(settings.port);
unloads.add(stopServer.bind(null));

let lastPort = settings.port;
safeInterval(unloads, () => {
    if (settings.port !== lastPort) {
        lastPort = settings.port;
        stopServer().then(() => {
            startServer(settings.port);
            trace.msg.log("Restarted server on port", settings.port);
        });
    }
}, portCheckInt);

MediaItem.fromPlaybackContext().then(updateMediaFields);
MediaItem.onMediaTransition(unloads, updateMediaFields);
PlayState.onState(unloads, () => {
    updateStateFields();
    if (PlayState.playing) startProgressLoop();
    else {
        stopProgressLoop();
        updateProgressFields();
    }
});

// Event-driven state — no 250ms poll.
redux.intercept("playbackControls/TIME_UPDATE", unloads, () => {
    updateProgressFields();
});
redux.intercept(
    [
        "playbackControls/SET_VOLUME",
        "playbackControls/SET_VOLUME_UNMUTE",
        "playbackControls/INCREASE_VOLUME",
        "playbackControls/DECREASE_VOLUME",
        "playbackControls/TOGGLE_MUTE",
        "playbackControls/SEEK",
        "playbackControls/SEEK_BACKWARDS",
        "playbackControls/SEEK_FORWARDS",
        "playQueue/SET_REPEAT_MODE",
        "playQueue/TOGGLE_REPEAT_MODE",
        "playQueue/TOGGLE_SHUFFLE",
        "playQueue/ENABLE_SHUFFLE_MODE",
        "playQueue/DISABLE_SHUFFLE_MODE",
        "playQueue/ENABLE_SHUFFLE_MODE_AND_SHUFFLE_ITEMS",
        "playQueue/DISABLE_SHUFFLE_MODE_AND_UNSHUFFLE_ITEMS",
    ] as const,
    unloads,
    () => updateStateFields(),
);
redux.intercept(
    [
        "playQueue/ADD_LAST",
        "playQueue/ADD_NEXT",
        "playQueue/ADD_NOW",
        "playQueue/ADD_AT_INDEX",
        "playQueue/ADD_MEDIA_ITEMS_TO_QUEUE",
        "playQueue/ADD_ALREADY_LOADED_ITEMS_TO_QUEUE",
        "playQueue/ADD_TRACK_LIST_TO_PLAY_QUEUE",
        "playQueue/REMOVE_AT_INDEX",
        "playQueue/REMOVE_ELEMENT",
        "playQueue/CLEAR_QUEUE",
        "playQueue/CLEAR_ACTIVE_ITEMS",
        "playQueue/MOVE_TO",
        "playQueue/MOVE_NEXT",
        "playQueue/MOVE_PREVIOUS",
        "playQueue/MOVE_TRACK",
        "playQueue/SET_CURRENT_INDEX",
        "playQueue/RESET",
        "playQueue/CLONE_TRACK",
        "playQueue/LOAD_PLAY_QUEUE_FROM_LOCAL_STORAGE_SUCCESS",
    ] as const,
    unloads,
    () => updateStateFields(),
);

// Kick progress if already playing when the plugin loads.
if (PlayState.playing) startProgressLoop();
updateStateFields();

window.__apiInvokeAction = async (data: ActionData & { action: string }) => {
    const handler = rendererActions[data.action];
    if (handler) {
        trace.msg.log(`Action: ${data.action}`, data);
        const result = await handler(data);
        updateStateFields();
        if (PlayState.playing) startProgressLoop();
        else stopProgressLoop();
        return result;
    }
    return undefined;
};
unloads.add(() => {
    delete window.__apiInvokeAction;
});

ipcRenderer.on(unloads, "api.playback.control", async (data) => {
    trace.msg.log(`Action: ${data.action}`, data);
    rendererActions[data.action]?.(data);
    updateStateFields();
    if (PlayState.playing) startProgressLoop();
    else stopProgressLoop();
});




/**
 * Register a new action handler for the API.
 * @param unloadsFn - Your plugin unloads set
 * @param name - The action name (used in HTTP/WebSocket requests)
 * @param handler - The function to execute when the action is triggered
 * @returns A function to unregister the action (same one is added to unloadsFn so do NOT call it manually unless you want to remove it early)
 */
export const registerAction = (
    unloadsFn: Set<LunaUnload>,
    name: string,
    handler: ActionHandler
) => {
    if (rendererActions[name]) {
        trace.msg.warn(`Action "${name}" already exists, overwriting`);
    }
    let registered = true;
    rendererActions[name] = handler;
    const unregister = () => {
        if (registered) {
            registered = false;
            delete rendererActions[name];
        }
    };
    unloadsFn.add(unregister);
    unloads.add(unregister);
    return unregister;
};


export type { ActionData, ActionHandler } from "./types";
export { updateFields as updateAPIFields };

