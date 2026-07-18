// ── Playback state (sent between host and guests) ──

export interface PlaybackState {
    playing: boolean;
    currentTime: number;
    trackId: string | null;
    trackTitle: string | null;
    trackArtists: string[] | null;
    coverUrl: string | null;
    duration: number | null;
    shuffle: boolean;
    repeatMode: number;
}

// ── Sync commands ──

export type SyncCommand =
    | { type: "play"; trackId?: string }
    | { type: "pause" }
    | { type: "next" }
    | { type: "previous" }
    | { type: "seek"; time: number }
    | { type: "shuffle"; shuffle: boolean }
    | { type: "repeat"; mode: number }
    | { type: "playNow"; trackId: string }
    | { type: "addToQueue"; trackId: string }
    | { type: "playFromQueue"; index: number }
    | { type: "clearQueue" };

// ── Client → Server messages ──

export type ClientMessage =
    | { type: "create"; displayName: string }
    | { type: "join"; roomId: string; displayName: string }
    | { type: "leave" }
    | { type: "state"; state: Partial<PlaybackState> }
    | { type: "command"; command: SyncCommand }
    | { type: "hideId"; hide: boolean }
    | { type: "heartbeat"; currentTime: number; playing: boolean };

// ── Server → Client messages ──

export type ServerMessage =
    | { type: "created"; roomId: string }
    | { type: "joined"; roomId: string; role: "host" | "guest"; hostDisplayName: string }
    | { type: "error"; error: string }
    | { type: "state"; state: Partial<PlaybackState> }
    | { type: "command"; command: SyncCommand }
    | { type: "guest_joined"; displayName: string; guestCount: number }
    | { type: "guest_left"; displayName: string; guestCount: number }
    | { type: "host_sync"; state: PlaybackState }
    | { type: "pong"; currentTime: number };
