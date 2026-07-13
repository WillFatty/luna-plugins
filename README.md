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

Returns the full playback state as JSON, including `playing`, `track`, `album`, `artist`, `volume`, `currentTime`, `playQueue`, and more.

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

| Endpoint                  | Body                          | Description                                      |
| ------------------------- | ----------------------------- | ------------------------------------------------ |
| `POST /addToQueue`        | `{ "itemId": "..." }`         | Add a track to the end of the queue              |
| `POST /playNext`          | `{ "itemId": "..." }`         | Add a track to play next (after current)         |
| `POST /playNow`           | `{ "itemId": "..." }`         | Play a track immediately, clearing the queue     |
| `POST /playFromQueue`     | `{ "itemId": "..." }`         | Find a track in the queue, skip to it, and play it |
| `POST /addPlaylistToQueue`| `{ "playlistId": "..." }`     | Add all tracks from a playlist to the queue      |
| `POST /removeFromQueue`  | `{ "itemId": "..." }`         | Remove a track from the queue                    |
| `POST /clearQueue`       | -                             | Clear all tracks from the queue                  |

## WebSocket API

Connect to `ws://localhost:24123`

### Subscribing to Updates

```json
// Subscribe to specific fields
{ "action": "subscribe", "fields": ["playing", "track", "volume"] }

// Subscribe to all fields
{ "action": "subscribe", "all": true }

// Unsubscribe
{ "action": "unsubscribe" }
```

You'll receive real-time updates whenever a field changes:

```json
{ "type": "update", "all": false, "field": "playing", "value": true }
{ "type": "update", "all": true, "fields": { "playing": true, "track": {...}, ... } }
```

### Sending Commands

All HTTP POST actions are available as WebSocket messages. Send JSON:

```json
{ "action": "pause" }
{ "action": "seek", "time": 120 }
{ "action": "playNow", "itemId": "424735194" }
{ "action": "addPlaylistToQueue", "playlistId": "e33e0075-ed06-4231-8800-0fc8d0f05e19" }
```

## State Fields

These fields are tracked and broadcast via both HTTP and WebSocket:

| Field          | Description                                    |
| -------------- | ---------------------------------------------- |
| `playing`      | Whether playback is active                     |
| `currentTime`  | Current position in seconds                    |
| `playTime`     | How long the current track has been playing    |
| `duration`     | Duration of the current track                  |
| `track`        | Current track metadata                         |
| `album`        | Current album metadata                         |
| `artist`       | Current artist metadata                        |
| `coverUrl`     | URL to the album cover image                   |
| `isrc`         | International Standard Recording Code          |
| `bestQuality`  | Best available audio quality                   |
| `volume`       | Current volume (0-100)                         |
| `shuffle`      | Whether shuffle is enabled                     |
| `repeatMode`   | Repeat mode (0=Off, 1=All, 2=One)              |
| `playQueue`    | Full queue state including elements and index  |
| `lastPlayStart`| Timestamp when the current track started       |

## Building

```bash
pnpm install
pnpm build
```

## License

MIT
