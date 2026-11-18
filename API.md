# IFL Gamecast API (v1)

A public, read-only JSON API for the league. It runs inside the normal server, so there is nothing extra to install or start. Open `http://<your-server>:3000/api/v1` to see it.

- **Read-only.** Only `GET` (and `HEAD` / `OPTIONS`). Nothing here can change the league. The admin tools are separate and still need the admin password.
- **No key needed.** CORS is open (`Access-Control-Allow-Origin: *`), so websites and apps can call it directly from a browser.
- **No spoilers.** The API never shows more than a viewer of the broadcast knows. A game that has not aired has no score and no plays. A game on air only shows the plays that have *finished airing*, with the score as of that moment.
- **Times** are ISO-8601 UTC strings (`startsAt`) with an epoch-milliseconds twin (`startsAtMs`).
- **Seasons.** Most endpoints take `?season=N` for an archived season. Leave it out for the current one.
- **Rate limit.** 120 requests per minute per IP by default (HTTP 429 with `Retry-After` beyond that). Change it with the `IFL_API_RATE` environment variable; `0` turns it off. Opening a stream counts as one request. Behind a reverse proxy every visitor shares the proxy's IP, so raise or disable it there.
- **Errors** are `{ "error": "message" }` with a normal status code: `400` bad parameter, `404` not found, `405` wrong method, `429` too many requests.

## Endpoints

| Endpoint | What it returns |
|---|---|
| `GET /api/v1/status` | Server time, season progress, the game on air, the next game, whether the schedule is paused. **Start here.** |
| `GET /api/v1/teams` | Every team in the season with division, record and overall/offence/defence rating. |
| `GET /api/v1/teams/{id}` | One team (`MIS`, `LAI`, ...): record, full roster with injuries and season stats, stadium, full schedule. |
| `GET /api/v1/standings` | Division standings, overall standings, playoff seeds and the champion. |
| `GET /api/v1/games` | Games, soonest first. Filters below. |
| `GET /api/v1/games/live` | The game on air right now, with situation, score, win probability, box score and recent plays. `{ "live": false }` when nothing is on. |
| `GET /api/v1/games/{id}` | One game (`W1G1`, `P-SF1`, `P-SF2`, `P-F` for the IFL Bowl). Content depends on its status, see below. |
| `GET /api/v1/games/{id}/plays` | Play-by-play, oldest first. Supports polling with `?since=`. |
| `GET /api/v1/games/live/stream`, `GET /api/v1/games/{id}/stream` | Live push stream (Server-Sent Events) of plays, scores and the final. See [Live streams](#live-streams-server-sent-events). |
| `GET /api/v1/players/{id}` | One player (`MIS-QB1`): team, rating, age, injury, season stats. |
| `GET /api/v1/leaders` | Season stat leaders. |
| `GET /api/v1/seasons` | Every season with its champion and runner-up. |
| `GET /api/v1/seasons/{n}` | One season: teams, standings, playoffs, the IFL Bowl. |

### `/games` filters

| Parameter | Meaning |
|---|---|
| `season` | Season number. Default: current. |
| `week` | A week number (`1`), or `P` for the playoffs. |
| `team` | Team id, for example `MIS`. Matches home or away. |
| `status` | `scheduled`, `live` or `final`. |
| `playoff` | `true` or `false`. |
| `limit`, `offset` | Paging. `limit` defaults to 50, maximum 200. |

### `/games/{id}` by status

| Status | You get |
|---|---|
| `scheduled` | Teams, start time, venue, who is inactive (injured), pregame home win probability. |
| `live` | Everything above plus score, quarter, clock, down and distance, possession, timeouts, line score, live win probability and the box score as it stands (add `?plays=N` on `/games/live` for the last N plays). |
| `final` | Final score, line score, full box score with team and player stats, and every scoring play. |

### `/games/{id}/plays`

`?since=N` returns plays after number `N`, `?limit=N` caps the batch. The reply includes `total` (plays aired so far) and `next`. To follow a live game, call it repeatedly with `since` set to the previous `next`:

```
GET /api/v1/games/W1G1/plays?since=0      ->  { total: 17, next: 17, plays: [...] }
GET /api/v1/games/W1G1/plays?since=17     ->  { total: 21, next: 21, plays: [4 new plays] }
```

Each play has `n`, `quarter`, `clock` (before the snap), `situation` (for example `4th & 2 at MIS 22`), `text`, `kind`, `possession`, `tags`, `banner`, `scoringTeam` and the `score` after the play.

### Live streams (Server-Sent Events)

Instead of polling, open a stream and the server pushes each play the moment it finishes airing. No library is needed in a browser:

```js
const es = new EventSource('/api/v1/games/live/stream');
es.addEventListener('play',  e => console.log(JSON.parse(e.data).text));
es.addEventListener('score', e => console.log('score', JSON.parse(e.data)));
es.addEventListener('final', e => console.log('final', JSON.parse(e.data)));
```

| Endpoint | Behaviour |
|---|---|
| `GET /api/v1/games/live/stream` | Follows whichever game is on air. Between games it sits idle, and the next game is picked up from its first play. Never closes by itself. |
| `GET /api/v1/games/{id}/stream` | Follows one game. Waits if it hasn't started, closes after `final`. A game that is already over sends `state` and `final` and closes. |

Streams always follow the current season. The same no-spoiler rule applies as everywhere else.

| Event | When | Data |
|---|---|---|
| `state` | On connect, and when a new game is picked up | The same fields as `/games/{id}` without the box score: game, situation, line score, win probability. `progress.playsAired` says which play the stream continues from. |
| `play` | Each play that finishes airing | A play, exactly as in `/plays`. |
| `score` | After a play that changed the score | `{ play, home, away, scoringTeam }` |
| `idle` | Live stream only: nothing on air | `{ now, next }` where `next` is the next scheduled game. |
| `final` | The game ended | Final score, `winner`, `overtime`, line score, number of plays. |
| `end` | The server is closing the stream | `{ reason }`, for example when a new season starts. |

**Resuming.** Every `play` has an id like `W1G1:17` (game and play number). A browser's `EventSource` reconnects by itself and sends it back as `Last-Event-ID`, so any plays missed during the drop are replayed. Other clients can pass `?since=W1G1:17`, or a bare `?since=17` on a per-game stream. A fresh connection with neither starts from right now.

**Limits.** At most 5 open streams per IP and 1000 in total, with `429` beyond that (`IFL_API_STREAMS` changes the per-IP number, `0` for no limit). The server sends a `: ping` comment every 15 seconds to keep the connection alive through proxies. It sets `X-Accel-Buffering: no` so nginx streams it without extra configuration.

### `/leaders`

`?category=` one of `passingYards`, `passingTD`, `rushingYards`, `receivingYards`, `receptions`, `totalTD`, `sacks`, `interceptions`, `tackles`, `fieldGoals`. Leave it out for all of them. `?limit=` (default 5, maximum 50).

## Example

```
GET /api/v1/games/live
```

```json
{
  "live": true,
  "game": {
    "id": "W1G1", "season": 1, "week": 1, "stage": "reg", "status": "live",
    "startsAt": "2026-11-19T00:00:00.000Z",
    "home": { "id": "KYL", "abbr": "KYL", "name": "Kyleton Polar Bears", "score": 0 },
    "away": { "id": "BRV", "abbr": "BRV", "name": "Bradyville Beavers", "score": 3 }
  },
  "situation": { "quarter": 1, "clock": "7:18", "down": 1, "toGo": 10, "possession": "KYL" },
  "winProbability": { "home": 0.801, "basis": "live" },
  "recentPlays": [ { "n": 17, "text": "G. McCrae up the middle to BRV 35 for 10 yards", "score": { "home": 0, "away": 3 } } ]
}
```

(Trimmed. Real responses also carry team colours and logos, inactive players, the line score and the box score.)

## Stat abbreviations

Player and team stat lines use short keys:

| Key | Meaning | Key | Meaning |
|---|---|---|---|
| `pa` / `pc` / `py` | pass attempts / completions / yards | `ptd` / `pint` | passing TD / interceptions thrown |
| `ra` / `ry` / `rlng` / `rtd` | rushes / yards / longest / TD | `tgt` | targets |
| `rec` / `recy` / `reclng` / `rectd` | catches / yards / longest / TD | `fum` | fumbles |
| `tk` | tackles | `sacks` | sacks made |
| `ints` / `intyds` / `deftd` | interceptions / return yards / defensive TD | `pd` / `ff` / `fr` | pass deflections / forced / recovered fumbles |
| `kr` / `kry` / `pr` / `pry` | kick and punt returns and their yards | `fga` / `fgm` / `fglng` | field goals attempted / made / longest |
| `xpa` / `xpm` | extra points attempted / made | `pn` / `pny` | punts / punt yards |

Team stat lines (`box.home.stats`, `box.away.stats`): `fd` first downs, `plays`, `yds` total yards, `py` passing yards, `ry` rushing yards, `pen` / `peny` penalties and yards, `to` turnovers, `top` time of possession in seconds, `d3a` / `d3c` third-down attempts / conversions, `d4a` / `d4c` fourth down, `sk` / `sky` sacks taken and yards lost.

## Notes for developers

- The API code is in `api.js`; `server.js` only mounts it at `/api/v1`. It never writes to the league data.
- Games are deterministic from their seed, so box scores and play-by-play are rebuilt on demand and the last 24 are kept in memory. A cold request for one game costs a few milliseconds.
- All open streams share one 500 ms timer, which only runs while someone is connected.
- `/api/state`, `/api/history` and `/api/admin/*` are what the website itself uses. They are not stable. Build on `/api/v1`.
