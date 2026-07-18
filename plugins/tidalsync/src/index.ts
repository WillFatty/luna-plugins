import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem, PlayState, redux } from "@luna/lib";
import React from "react";
import { createRoot } from "react-dom/client";
import { settings, Settings } from "./Settings";
import type { ClientMessage, ServerMessage, SyncCommand, PlaybackState } from "./types";

export const { trace } = Tracer("[TidalSync]");
export const unloads = new Set<LunaUnload>();
export { Settings };

const log = (msg: string) => {
    if (settings.showNotifications) trace.msg.log(msg);
};

// ── State ──

let ws: WebSocket | null = null;
let connectTimeout: ReturnType<typeof setTimeout> | null = null;
let currentRole: "host" | "guest" | null = null;
let currentRoomId: string | null = null;
let suppressOutgoing = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let guestCount = 0;
let guestNames: string[] = [];
let hostDisplayName: string | null = null;
let lastTrackId: string | null = null;
let currentTrackTitle: string | null = null;
let currentTrackArtists: string[] | null = null;
let currentCoverUrl: string | null = null;
let roomVisible = true;

// ── Helpers ──

const send = (msg: ClientMessage) => {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
};

const getPlaybackState = async (): Promise<Partial<PlaybackState>> => {
    const { playing, currentTime, repeatMode, shuffle } = PlayState;
    const { playbackControls } = redux.store.getState();

    let trackId: string | null = null;
    let trackTitle: string | null = null;
    let trackArtists: string[] | null = null;
    let coverUrl: string | null = null;
    let duration: number | null = null;

    try {
        const item = await MediaItem.fromPlaybackContext();
        if (item) {
            trackId = String(item.id);
            trackTitle = item.tidalItem.title ?? null;
            trackArtists =
                item.tidalItem.artists
                    ?.map((a: any) => a.name)
                    .filter((name): name is string => Boolean(name?.trim())) ?? null;
            if (!trackArtists?.length && item.tidalItem.artist?.name) {
                trackArtists = [item.tidalItem.artist.name];
            }
            coverUrl = (await item.coverUrl()) ?? null;
            duration = item.duration ?? null;
        }
    } catch {}

    if (trackId) {
        currentTrackTitle = trackTitle;
        currentTrackArtists = trackArtists;
        currentCoverUrl = coverUrl;
    }

    return {
        playing,
        currentTime: Number.isNaN(currentTime) ? 0 : currentTime,
        trackId,
        trackTitle,
        trackArtists,
        coverUrl,
        duration,
        shuffle,
        repeatMode,
    };
};

// ── Apply remote commands to TIDAL ──

const applyCommand = (command: SyncCommand) => {
    suppressOutgoing = true;

    switch (command.type) {
        case "play":
            if (command.trackId && command.trackId !== lastTrackId) {
                PlayState.pause();
            } else {
                PlayState.play();
            }
            break;
        case "pause":
            PlayState.pause();
            break;
        case "next":
            PlayState.next();
            break;
        case "previous":
            PlayState.previous();
            break;
        case "seek": {
            const compensatedTime = command.time + 0.1;
            PlayState.seek(compensatedTime);
            break;
        }
        case "shuffle":
            command.shuffle
                ? PlayState.setShuffle(true, true)
                : PlayState.setShuffle(false, true);
            break;
        case "repeat":
            PlayState.setRepeatMode(command.mode);
            break;
        case "playNow": {
            redux.actions["playQueue/ADD_NOW"]({
                context: { type: "UNKNOWN", id: command.trackId },
                mediaItemIds: [command.trackId],
            });
            redux.actions["playbackControls/PLAY"]();
            break;
        }
        case "addToQueue": {
            redux.actions["playQueue/ADD_LAST"]({
                context: { type: "UNKNOWN", id: command.trackId },
                mediaItemIds: [command.trackId],
            });
            break;
        }
        case "playFromQueue": {
            const { elements, currentIndex } = PlayState.playQueue;
            if (command.index >= 0 && command.index < elements.length && command.index !== currentIndex) {
                redux.actions["playQueue/MOVE_TO"](command.index);
                redux.actions["playbackControls/PLAY"]();
            }
            break;
        }
        case "clearQueue":
            redux.actions["playQueue/CLEAR_QUEUE"]();
            break;
    }

    setTimeout(() => {
        suppressOutgoing = false;
    }, 200);
};

// ── Apply full state from host (for guest) ──

const applyHostState = async (state: Partial<PlaybackState>) => {
    suppressOutgoing = true;

    if (state.trackId && state.trackId !== lastTrackId) {
        lastTrackId = state.trackId;
        currentTrackTitle = state.trackTitle;
        currentTrackArtists = state.trackArtists;
        currentCoverUrl = state.coverUrl;
        log(`Track changed: ${state.trackTitle} (${state.trackId})`);

        PlayState.pause();
        await MediaItem.fromId(state.trackId, "track");
        redux.actions["playQueue/ADD_NOW"]({
            context: { type: "UNKNOWN", id: state.trackId },
            mediaItemIds: [state.trackId],
        });
        if (typeof state.currentTime === "number" && state.currentTime > 0.5) {
            PlayState.seek(state.currentTime + 0.1);
        }
        setTimeout(() => PlayState.play(), 2000);
    } else {
        if (typeof state.playing === "boolean") {
            state.playing ? PlayState.play() : PlayState.pause();
        }
        if (typeof state.currentTime === "number") {
            const drift = Math.abs(state.currentTime - PlayState.currentTime);
            if (drift > 2) {
                PlayState.seek(state.currentTime + 0.1);
            }
        }
    }
    if (typeof state.shuffle === "boolean") {
        state.shuffle
            ? PlayState.setShuffle(true, true)
            : PlayState.setShuffle(false, true);
    }
    if (typeof state.repeatMode === "number") {
        PlayState.setRepeatMode(state.repeatMode);
    }

    setTimeout(() => {
        suppressOutgoing = false;
    }, 500);
};

// ── Push state/commands to server ──

const pushState = async () => {
    if (suppressOutgoing || currentRole !== "host") return;
    const state = await getPlaybackState();
    send({ type: "state", state });
};

const pushCommand = (command: SyncCommand) => {
    if (suppressOutgoing || currentRole !== "host") return;
    send({ type: "command", command });
};

// ── Server message handler ──

const handleServerMessage = (msg: ServerMessage) => {
    switch (msg.type) {
        case "created":
            currentRoomId = msg.roomId;
            currentRole = "host";
            guestCount = 0;
            guestNames = [];
            log(`Room created: ${msg.roomId}`);
            pushState();
            break;

        case "joined":
            currentRoomId = msg.roomId;
            currentRole = msg.role;
            hostDisplayName = msg.hostDisplayName ?? null;
            guestCount = 0;
            guestNames = [];
            log(`Joined room ${msg.roomId} as ${msg.role}`);
            break;

        case "error":
            trace.msg.err(`Server error: ${msg.error}`);
            break;

        case "state":
            if (currentRole === "guest") {
                applyHostState(msg.state);
            }
            break;

        case "command":
            if (currentRole === "guest") {
                applyCommand(msg.command);
            }
            break;

        case "guest_joined":
            guestCount = msg.guestCount;
            guestNames.push(msg.displayName);
            log(`${msg.displayName} joined (${guestCount} guests)`);
            pushState();
            break;

        case "guest_left":
            guestCount = msg.guestCount;
            guestNames = guestNames.filter((n) => n !== msg.displayName);
            log(`${msg.displayName} left (${guestCount} guests)`);
            break;

        case "host_sync":
            if (currentRole === "guest") {
                applyHostState(msg.state);
            }
            break;

        case "pong":
            break;
    }
};

// ── WebSocket connection ──

const connect = () => {
    if (ws) {
        ws.close();
        ws = null;
    }
    if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
    }

    const url = settings.serverUrl;
    if (!url) {
        trace.msg.err("No server URL configured");
        return;
    }

    log(`Connecting to ${url}...`);

    try {
        ws = new WebSocket(url);
    } catch (e) {
        trace.msg.err(`Connection failed: ${e}`);
        scheduleReconnect();
        return;
    }

    connectTimeout = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            trace.msg.err("Connection timed out");
            ws.close();
            ws = null;
            connectTimeout = null;
            scheduleReconnect();
        }
    }, 10_000);

    ws.onopen = () => {
        if (connectTimeout) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
        }
        log("Connected to server");
        reconnectDelay = 1000;
        startHeartbeat();

        if (pendingAction) {
            const action = pendingAction;
            pendingAction = null;
            action();
        } else if (settings.autoConnect && settings.lastRoomId && settings.lastRole) {
            if (settings.lastRole === "host") {
                send({ type: "create", displayName: settings.displayName || "Host" });
            } else {
                send({
                    type: "join",
                    roomId: settings.lastRoomId,
                    displayName: settings.displayName || "Guest",
                });
            }
        }
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data) as ServerMessage;
            handleServerMessage(msg);
        } catch (e) {
            trace.msg.err(`Failed to parse message: ${e}`);
        }
    };

    ws.onclose = (event) => {
        if (connectTimeout) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
        }
        log(`Disconnected (code: ${event.code})`);
        stopHeartbeat();
        currentRole = null;
        currentRoomId = null;
        guestCount = 0;
        guestNames = [];
        hostDisplayName = null;

        if (event.code !== 1000) {
            scheduleReconnect();
        }
    };

    ws.onerror = () => {};
};

const disconnect = () => {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
    }
    reconnectDelay = 1000;
    pendingAction = null;
    stopHeartbeat();
    send({ type: "leave" });
    ws?.close(1000);
    ws = null;
    currentRole = null;
    currentRoomId = null;
    guestCount = 0;
    guestNames = [];
    hostDisplayName = null;
    lastTrackId = null;
    currentTrackTitle = null;
    currentTrackArtists = null;
    currentCoverUrl = null;
    roomVisible = true;
};

const scheduleReconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30_000);
        log(`Reconnecting in ${reconnectDelay}ms...`);
        connect();
    }, reconnectDelay);
};

// ── Heartbeat ──

const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN && currentRole === "host") {
            send({
                type: "heartbeat",
                currentTime: PlayState.currentTime,
                playing: PlayState.playing,
            });
        }
    }, 5_000);
};

const stopHeartbeat = () => {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
};

// ── Public API ──

let pendingAction: (() => void) | null = null;

export const createRoom = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        pendingAction = () => send({ type: "create", displayName: settings.displayName || "Host" });
        if (!ws || ws.readyState === WebSocket.CLOSED) connect();
        return;
    }
    send({ type: "create", displayName: settings.displayName || "Host" });
};

export const joinRoom = (roomId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        pendingAction = () => send({
            type: "join",
            roomId,
            displayName: settings.displayName || "Guest",
        });
        if (!ws || ws.readyState === WebSocket.CLOSED) connect();
        return;
    }
    send({
        type: "join",
        roomId,
        displayName: settings.displayName || "Guest",
    });
};

export const leaveRoom = () => {
    send({ type: "leave" });
    currentRole = null;
    currentRoomId = null;
    guestCount = 0;
    guestNames = [];
    hostDisplayName = null;
};

export const getRoomInfo = () => ({
    roomId: currentRoomId,
    role: currentRole,
    guestCount,
    guestNames: [...guestNames],
    hostDisplayName,
    connected: ws?.readyState === WebSocket.OPEN,
    trackTitle: currentTrackTitle,
    trackArtists: currentTrackArtists,
    coverUrl: currentCoverUrl,
    visible: roomVisible,
});

export const setVisible = (visible: boolean) => {
    roomVisible = visible;
    send({ type: "hideId", hide: !visible });
};

// ── Intercept TIDAL Redux changes (host sends targeted commands) ──

// Playback controls — send specific commands
redux.intercept("playbackControls/PLAY", unloads, async () => {
    if (suppressOutgoing || currentRole !== "host") return;
    try {
        const item = await MediaItem.fromPlaybackContext();
        pushCommand({ type: "play", trackId: item ? String(item.id) : undefined });
    } catch {
        pushCommand({ type: "play" });
    }
});

redux.intercept("playbackControls/PAUSE", unloads, () => {
    pushCommand({ type: "pause" });
});

redux.intercept(
    ["playbackControls/SEEK", "playbackControls/SEEK_BACKWARDS", "playbackControls/SEEK_FORWARDS"] as const,
    unloads,
    () => {
        if (suppressOutgoing || currentRole !== "host") return;
        pushCommand({ type: "seek", time: PlayState.currentTime });
    },
);

redux.intercept("playbackControls/TOGGLE_MUTE", unloads, () => {
    // Volume not synced
});

redux.intercept(
    ["playQueue/SET_REPEAT_MODE", "playQueue/TOGGLE_REPEAT_MODE"] as const,
    unloads,
    () => {
        if (suppressOutgoing || currentRole !== "host") return;
        pushCommand({ type: "repeat", mode: PlayState.repeatMode });
    },
);

redux.intercept(
    ["playQueue/TOGGLE_SHUFFLE", "playQueue/ENABLE_SHUFFLE_MODE",
     "playQueue/DISABLE_SHUFFLE_MODE", "playQueue/ENABLE_SHUFFLE_MODE_AND_SHUFFLE_ITEMS",
     "playQueue/DISABLE_SHUFFLE_MODE_AND_UNSHUFFLE_ITEMS"] as const,
    unloads,
    () => {
        if (suppressOutgoing || currentRole !== "host") return;
        pushCommand({ type: "shuffle", shuffle: PlayState.shuffle });
    },
);

// Queue changes — push full state
redux.intercept(
    [
        "playQueue/ADD_LAST", "playQueue/ADD_NEXT", "playQueue/ADD_NOW",
        "playQueue/ADD_AT_INDEX", "playQueue/ADD_MEDIA_ITEMS_TO_QUEUE",
        "playQueue/ADD_ALREADY_LOADED_ITEMS_TO_QUEUE", "playQueue/ADD_TRACK_LIST_TO_PLAY_QUEUE",
        "playQueue/REMOVE_AT_INDEX", "playQueue/REMOVE_ELEMENT",
        "playQueue/CLEAR_QUEUE", "playQueue/CLEAR_ACTIVE_ITEMS",
        "playQueue/MOVE_TO", "playQueue/MOVE_NEXT", "playQueue/MOVE_PREVIOUS",
        "playQueue/MOVE_TRACK", "playQueue/SET_CURRENT_INDEX",
        "playQueue/RESET", "playQueue/CLONE_TRACK",
        "playQueue/LOAD_PLAY_QUEUE_FROM_LOCAL_STORAGE_SUCCESS",
    ] as const,
    unloads,
    () => {
        if (suppressOutgoing || currentRole !== "host") return;
        pushState();
    },
);

// Track transitions and state changes
PlayState.onState(unloads, () => {
    if (suppressOutgoing || currentRole !== "host") return;
    pushState();
});

MediaItem.onMediaTransition(unloads, () => {
    if (suppressOutgoing || currentRole !== "host") return;
    pushState();
});

// Polling fallback — catch any track changes the interceptors miss
let lastPollTrackId: string | null = null;
const pollInterval = setInterval(async () => {
    if (currentRole !== "host" || suppressOutgoing) return;
    try {
        const item = await MediaItem.fromPlaybackContext();
        const trackId = item ? String(item.id) : null;
        if (trackId && trackId !== lastPollTrackId) {
            lastPollTrackId = trackId;
            pushState();
        }
    } catch {}
}, 1000);
unloads.add(() => clearInterval(pollInterval));

// ── Connect on load ──

connect();
unloads.add(disconnect);

// ── Playbar injection ──

let playbarRoot: ReturnType<typeof createRoot> | null = null;

const injectPlaybar = () => {
    const repeatBtn = document.querySelector('[data-test="repeat"]');
    if (!repeatBtn?.parentElement) return;
    const parent = repeatBtn.parentElement;
    if (parent.querySelector("[data-tidal-sync-playbar]")) return;

    const container = document.createElement("div");
    container.setAttribute("data-tidal-sync-playbar", "");
    container.style.cssText = "display:flex;align-items:center;position:relative;";
    parent.insertBefore(container, repeatBtn.nextSibling);

    import("./PlaybarButton").then(({ PlaybarButton }) => {
        if (!playbarRoot) {
            playbarRoot = createRoot(container);
        }
        playbarRoot.render(React.createElement(PlaybarButton));
    });
};

const playbarObserver = new MutationObserver(() => {
    if (document.querySelector('[data-test="repeat"]')) {
        injectPlaybar();
    }
});
playbarObserver.observe(document.body, { childList: true, subtree: true });
unloads.add(() => playbarObserver.disconnect());
unloads.add(() => {
    document.querySelector("[data-tidal-sync-playbar]")?.remove();
    playbarRoot?.unmount();
    playbarRoot = null;
});

log("TidalSync loaded");
