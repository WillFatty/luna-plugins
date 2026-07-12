# @willfatty/api

Fork of [vMohammad's](https://github.com/vMohammad24) TidaLuna API plugin.

Exposes TIDAL playback and queue state via HTTP and WebSocket for external control and monitoring.

## Installation

In TidaLuna, go to **Luna Settings > Plugin Store** and install from URL:

```
https://willfatty.github.io/luna-plugins/willfatty.api.mjs
```

## Features

- HTTP server returns current playback state as JSON
- WebSocket server supports:
  - Subscribing to all or specific fields
  - Receiving real-time updates on playback, queue, and controls
  - Sending playback control commands

## Usage

### Start/Stop Server

- Server starts automatically on port `24123` (configurable in plugin settings)

### HTTP API

#### GET /

Returns current playback state as JSON.

#### POST Actions

| Endpoint               | Body                  | Description                                     |
| ---------------------- | --------------------- | ----------------------------------------------- |
| `POST /pause`          | -                     | Pause playback                                  |
| `POST /resume`         | -                     | Resume playback                                 |
| `POST /toggle`         | -                     | Toggle play/pause                               |
| `POST /next`           | -                     | Skip to next track                              |
| `POST /previous`       | -                     | Go to previous track                            |
| `POST /seek`           | `{ "time": 120 }`     | Seek to position (seconds)                      |
| `POST /volume`         | `{ "volume": 50 }`    | Set volume (0-100, or "+10"/"-10" for relative) |
| `POST /setRepeatMode`  | `{ "mode": 0 }`       | Set repeat mode (0=Off, 1=All, 2=One)           |
| `POST /setShuffleMode` | `{ "shuffle": true }` | Enable/disable shuffle                          |
| `POST /playNext`       | `{ "itemId": "..." }` | Add item to play next                           |
| `POST /addToQueue`     | `{ "itemId": "..." }` | Add item to queue                               |

### WebSocket API

Connect to `ws://localhost:24123`

#### Subscribe

- `{ "action": "subscribe", "fields": ["playing", "track"] }` - specific fields
- `{ "action": "subscribe", "all": true }` - all fields
- `{ "action": "unsubscribe" }` - unsubscribe

#### Control Actions

- `"pause"`, `"resume"`, `"toggle"`, `"next"`, `"previous"`
- `{ "action": "seek", "time": 120 }`
- `{ "action": "volume", "volume": 50 }`
- `{ "action": "setRepeatMode", "mode": 0 }`
- `{ "action": "setShuffleMode", "shuffle": true }`
- `{ "action": "playNext", "itemId": "..." }`
- `{ "action": "addToQueue", "itemId": "..." }`

### State Fields

`playing`, `playTime`, `repeatMode`, `lastPlayStart`, `playQueue`, `shuffle`, `volume`, `currentTime`, `album`, `artist`, `track`, `coverUrl`, `isrc`, `duration`, `bestQuality`

## Building

```bash
pnpm install
pnpm build
```

## License

MIT
