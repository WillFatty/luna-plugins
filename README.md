# @willfatty/api

A [TidaLuna](https://github.com/Inrixia/TidaLuna) plugin that exposes TIDAL playback control and state via HTTP and WebSocket.

Fork of [vMohammad's](https://github.com/vMohammad24) TidaLuna API plugin.

## Installation

1. Open TidaLuna → **Luna Settings > Plugin Store**
2. Install from URL:
   ```
   https://github.com/WillFatty/luna-plugins/releases/download/latest/store.json
   ```
3. The server starts automatically on port **24123** (configurable in plugin settings)

## HTTP API

### Get State

```
GET /
```

Returns the full playback state as JSON, including `playing`, `track`, `album`, `artist`, `coverUrl`, `volume`, `currentTime`, enriched `playQueue`, and more.

### Debug Snapshot

```
GET /debug
```

Returns a compact diagnostics payload: `apiBuild`, connected WebSocket clients, and the full queue under `queue.songs` (with titles, artists, and cover URLs when resolved).

### Playback Control

| Endpoint               | Body                     | Description                                   |
| ---------------------- | ------------------------ | --------------------------------------------- |
| `POST /pause`          | -                        | Pause playback                                |
| `POST /resume`         | -                        | Resume playback                               |
| `POST /toggle`         | -                        | Toggle play/pause                             |
| `POST /next`           | -                        | Skip to next track                            |
| `POST /previous`       | -                        | Go to previous track                          |
| `POST /seek`           | `{ "time": 120 }`        | Seek to a position in seconds                 |
| `POST /volume`         | `{ "volume": 50 }`       | Set volume (0-100, or `"+10"`/`"-10"` to adjust relatively) |
| `POST /setRepeatMode`  | `{ "mode": 0 }`          | Repeat mode: `0` = Off, `1` = All, `2` = One |
| `POST /setShuffleMode` | `{ "shuffle": true }`    | Enable or disable shuffle                     |

### Queue Management

| Endpoint                   | Body                      | Description                                        |
| -------------------------- | ------------------------- | -------------------------------------------------- |
| `POST /addToQueue`         | `{ "itemId": "..." }`     | Add a track to the end of the queue                |
| `POST /playNext`           | `{ "itemId": "..." }`     | Add a track to play next (after current)           |
| `POST /playNow`            | `{ "itemId": "..." }`     | Play a track immediately                           |
| `POST /playFromQueue`      | `{ "itemId": "..." }`     | Jump to a track already in the queue and play it   |
| `POST /addPlaylistToQueue` | `{ "playlistId": "..." }` | Add all tracks from a playlist to the queue        |
| `POST /removeFromQueue`    | `{ "itemId": "..." }`     | Remove a track from the queue                      |
| `POST /clearQueue`         | -                         | Clear all tracks from the queue                    |

`itemId` can be a track ID, album ID, or playlist ID (resolved to the first track when needed). Playlist UUID also works for `addPlaylistToQueue`.

## WebSocket API

Connect to `ws://127.0.0.1:24123` (or your configured port).

### Subscribing to Updates

```json
{ "action": "subscribe", "fields": ["playing", "track", "coverUrl", "playQueue"] }
{ "action": "subscribe", "all": true }
{ "action": "unsubscribe" }
```

On subscribe, the server immediately pushes the current snapshot, then streams changes as they happen.

**Realtime behavior**

- Playback / queue / volume / shuffle / repeat updates are driven by TIDAL Redux events (not a fixed poll interval).
- While playing, `currentTime` / `playTime` are pushed from the live player clock via `requestAnimationFrame`.
- Progress ticks are sent as small field updates even when subscribed with `all: true`, so the full queue is not reserialized every frame.

Update shapes:

```json
{ "type": "update", "all": false, "field": "currentTime", "value": 42.1 }
{ "type": "update", "all": true, "fields": { "playing": true, "track": {}, "playQueue": {}, "...": "..." } }
```

### Sending Commands

All HTTP POST actions are available as WebSocket messages:

```json
{ "action": "pause" }
{ "action": "seek", "time": 120 }
{ "action": "playNow", "itemId": "424735194" }
{ "action": "addPlaylistToQueue", "playlistId": "e33e0075-ed06-4231-8800-0fc8d0f05e19" }
```

Optional `msgId` is echoed back on the response so clients can correlate request/response.

## State Fields

| Field           | Description                                                                 |
| --------------- | --------------------------------------------------------------------------- |
| `playing`       | Whether playback is active                                                  |
| `currentTime`   | Live player position in seconds                                             |
| `playTime`      | Redux / reported play position in seconds                                   |
| `duration`      | Duration of the current track                                               |
| `track`         | Current track metadata                                                      |
| `album`         | Current album metadata                                                      |
| `artist`        | Current artist metadata                                                     |
| `coverUrl`      | Cover image URL for the current track                                       |
| `isrc`          | International Standard Recording Code                                       |
| `bestQuality`   | Best available audio quality                                                |
| `volume`        | Current volume (0–100)                                                      |
| `shuffle`       | Whether shuffle is enabled                                                  |
| `repeatMode`    | Repeat mode (`0` = Off, `1` = All, `2` = One)                               |
| `playQueue`     | Queue snapshot: `currentIndex` + enriched `elements` (see below)            |
| `lastPlayStart` | Timestamp when the current track started                                    |

### Enriched `playQueue.elements`

Each queue element includes the original TIDAL queue fields plus resolved metadata:

| Field         | Description                                      |
| ------------- | ------------------------------------------------ |
| `mediaItemId` | Track / media ID                                 |
| `uid`         | Queue element UID                                |
| `title`       | Track title (when resolved)                      |
| `artists`     | Artist name list (when resolved)                 |
| `coverUrl`     | Cover image URL (when resolved)                  |
| `duration`    | Track duration in seconds (when resolved)        |
| `context`     | Original queue context                           |
| `priority`    | Original queue priority                          |

Metadata is resolved in batches and cached. The queue is pushed immediately when it changes; covers/titles fill in as they resolve and trigger further `playQueue` updates.

Example element:

```json
{
  "mediaItemId": "57738084",
  "uid": "pq__…",
  "title": "Four Pink Walls",
  "artists": ["Alessia Cara"],
  "coverUrl": "https://resources.tidal.com/images/…/1280x1280.jpg",
  "duration": 211,
  "context": { "type": "MY_TRACKS", "id": "" },
  "priority": "priority_none"
}
```

## Building

```bash
pnpm install
pnpm build
```

Output lands in `dist/` (`willfatty.api.mjs` + `store.json`). Reload the plugin in TidaLuna after building. Check `GET /debug` → `apiBuild` to confirm the loaded build.

## License

MIT
