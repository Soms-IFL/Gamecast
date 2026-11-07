# IFL Gamecast — International Football League

A broadcast-style American football simulator for the IFL. The server runs the season on its own schedule, and everyone who opens the site watches the same game, play by play, at the same moment. Each game takes about 7 minutes (about 8 with overtime).

## Quick start (for the host)

Copy this whole folder to the computer or server that will host the league, then run the setup script for that system. It installs Node.js if it's missing, asks for a port and an admin password, and gets everything running.

### Windows

1. Double-click **`setup.bat`**.
2. Answer the questions. Pressing Enter accepts the suggested answer.
   - **Node.js:** if it's missing, the script offers to install it with winget.
   - **Port:** 3000 unless you pick another.
   - **Admin password:** type one, or leave it empty to get a generated one.
   - **Firewall rule:** lets other devices on your network connect. Windows asks for admin approval.
   - **Start automatically when you log in:** optional.
3. To start the league later, double-click **`start-ifl.bat`** and keep that window open.

### Linux (VPS, home server, Minecraft box)

```
cd /path/to/ifl
bash setup.sh
```

The script:
- installs Node.js LTS if needed (it may ask for your sudo password)
- asks for the port and admin password
- offers to run the league as a **background service** that starts on boot and restarts if it crashes
- offers to open the port in `ufw` or `firewalld`

Useful commands afterwards:
- Status: `sudo systemctl status ifl`
- Live log: `sudo journalctl -u ifl -f`
- Restart: `sudo systemctl restart ifl`

Without the service, run `./start.sh`, inside `screen` or `tmux` so it keeps running after you log out.

### After setup

- Open `http://localhost:3000` (or the port you chose). The setup script and the server both print the addresses friends on the same network can use.
- **Friends over the internet:**
  - Home PC: forward the port on your router to the host computer.
  - VPS: allow the port in the provider's firewall or security group.
- Sign in on the **Admin** tab with the password from setup. It's saved in `data/config.json`.
- You can run the setup script again at any time to change the port or password. Restart the league afterwards (`sudo systemctl restart ifl`, or close and reopen `start-ifl.bat`).

## What's in the folder

| Path | What it is |
|---|---|
| `setup.bat` / `setup-windows.ps1` | Windows setup. Double-click `setup.bat`. |
| `setup.sh` | Linux setup: `bash setup.sh`. |
| `server.js` | The league server: schedule, broadcasts, saving, admin API. No extra packages needed. |
| `public/` | The website: `index.html`, `app.js` (interface) and `engine.js` (game simulation). |
| `data/` | Created on first run. `league.json` holds the current season and all history; `config.json` holds the port and admin password. **Back this folder up.** |

## Running it by hand

If you'd rather not use the setup scripts:

1. Install **Node.js 18 or newer** from https://nodejs.org (any LTS version).
2. Open a terminal in this folder and run:

   ```
   node server.js
   ```

3. The first time it starts, it prints a generated **admin password** and saves it to `data/config.json`. To change the port or password, edit `port` / `adminPassword` in that file and restart.

### Settings

`data/config.json` holds `port`, `host` and `adminPassword`. Environment variables override the file:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the site runs on. |
| `HOST` | `0.0.0.0` | Network interface. Use `127.0.0.1` if you only serve it through a reverse proxy. |
| `IFL_ADMIN_PASSWORD` | from `data/config.json` | Admin password. |
| `IFL_DATA_DIR` | `./data` | Where the league is saved. |

### Letting friends in

- **Same network:** share `http://<host's local IP>:3000`.
- **Over the internet:** forward the port on the router (TCP 3000 by default), or put it behind a reverse proxy (nginx, Caddy) with a domain. If it's on a VPS or the Minecraft box, open the port in its firewall (for example `sudo ufw allow 3000/tcp`).
- If you expose it publicly, use HTTPS through a reverse proxy so the admin password isn't sent in plain text.

### Keeping it running

The server must stay running for the season to advance. If it's off, games that should have aired are recorded as soon as it comes back.

- **Linux:** `setup.sh` can install it as the `ifl` systemd service, which starts on boot and restarts after crashes.
- **Windows:** `setup.bat` can add it to your Startup folder so it starts when you log in. Otherwise keep `start-ifl.bat` open.

### Updating to a new version

Stop the league, copy the new files over the old ones, and leave the `data/` folder alone. That folder holds your league and settings. Then start it again.

## Running the season (admin)

Open the **Admin** tab and sign in with the admin password.

- **League format:** four teams make the playoffs. Every division winner gets in, seeded by record, and the best remaining teams fill the rest as wild cards. Semifinals are 1 vs 4 and 2 vs 3, then the IFL Bowl.
  - **Season 1:** 8 teams in two divisions. **IFL West** (Miskauga, Laiyford, Ashford, Argiroupolis) and **IFL East** (Greene Hill, Dennison, Parikia, Kyleton). Each team plays 10 games: division rivals home and away, and every team in the other division once.
  - **From Season 2:** 12 teams in three divisions of four. **IFL West:** Miskauga, New Southington, Laiyford, Ashford. **IFL Central:** Bradyville, Argiroupolis, Kyleton, Parikia. **IFL East:** Dennison, Greene Hill, Montford, Newtown. Each team plays 14 games (division rivals twice, everyone else once), 6 games per IFL week, and has 7 home games. Playoffs: the three division winners plus one wild card.
  - **When they join:** the four expansion teams (Skylines, Knights, Monarchs, Beavers) get newly generated rosters, slightly boosted so they are competitive, when Season 2 is created. Season 1 is not affected and always shows with its original West/East divisions.
  - **Season length:** when the league grows, a season shorter than 6 days moves to 6 days once (84 regular-season games). The admin can change it back.
- **Stadiums (Admin → Stadiums):**
  - **Teams with a stadium:** each has a stadium name and town, and plays its home games there.
  - **Teams without one:** their home games are played at a neutral stadium the admin picks, with no home advantage unless that stadium's team is playing.
  - **The IFL Bowl:** Season 1 is hosted by Miskauga, the founding team. After that, the previous champion hosts, falling back to Miskauga if the champion has no stadium.
  - **No stadiums entered:** every team hosts in its own city.
  - **When changes take effect:** they only affect games that haven't started.
- **Season length (days):** how many real days a season takes from the first kickoff to the IFL Bowl. The regular season is spread over every day except the last, and the last day is finals day. The default is 4 days:

  | Day | What airs |
  |---|---|
  | 1 | IFL Weeks 1–4 (16 games, about 19:00–21:37) |
  | 2 | IFL Weeks 5–7 (12 games, about 19:00–20:57) |
  | 3 | IFL Weeks 8–10 (12 games, about 19:00–20:57) |
  | 4 | Finals day: both semifinals, then the IFL Bowl (about 19:00–19:27) |
  | 5 | Next season's Week 1 |

  The admin panel previews the day-by-day plan for whatever you enter.
- **First game each day / Minutes between game starts:** when each day's games begin and how far apart they are. Times use the **server's** time zone. Viewers see times converted to their own clock.
- **Break between seasons (days)** and **Start the next season automatically:** with the defaults, the next season starts the day after the IFL Bowl.
- **Pause / Resume schedule:** stops new games from airing. A game already on air finishes.
- **Start next game now:** airs the next scheduled game right away, then the rest follow the schedule.
- **Sim next game instantly / Finish season instantly:** records results without broadcasting them. Useful for catching up or testing.
- **Start new season:** archives the current season in History (even if it's unfinished) and creates a new schedule. You can choose the date and time of the first game.
- **Reset league to Season 1:** erases every season, all history and records, injuries and roster changes, and starts over with the original Season 1 rosters. Schedule settings and the admin password are kept. You have to type `RESET` to confirm. Before wiping anything, the server saves the old league to `data/backup-<date>.json`. To undo a reset, stop the server, rename that backup to `league.json` (replacing the current one), and start the server again.

## Team logos

Put logo images in **`public/logos/`**, named after the team: for example `boulders.png`, `miskauga.png`, `Miskauga Boulders.png` or `MIS.png`. Capitals, spaces and dashes don't matter. They show up the next time a page is opened or refreshed, with no restart needed, in these places:
- the scoreboard
- the scores ticker
- standings and the schedule
- team pages
- the end zones, and midfield for the home team

Transparent PNGs look best. `.webp`, `.svg` and `.jpg` also work. Teams without a logo keep their coloured badge. See `public/logos/README.txt` for every accepted name.

## Players, injuries and the offseason

Rosters change over time on their own. Each team carries 38 fictional players: starters plus backups.

- **Injuries:** about 1–2 per game, at NFL rates. An injured player leaves the game, the best healthy backup takes over, and he then misses his team's next few games. Most injuries last 1–2 games, some 3–8, and about 1 in 14 ends his season. Live games list each team's inactive players, and every team page has an injury report.
- **Aging and development:** every offseason players get a year older. Young players usually improve, players in their prime hold steady, and veterans decline. QBs and kickers last longer and running backs fade earliest. There's some randomness, so expect breakouts and busts.
- **Retirements:** older and declining players retire, usually 15–30 a year across the league.
- **Draft:** every opening is filled with a made-up rookie. The worst team picks first and the IFL Bowl champion picks last. The **Offseason report** on the Season tab (and in History) lists every pick, every retirement, and the biggest rating jumps and drops.
- **Rating history:** each team page shows the team's overall rating for every season.

Over a long run the league average stays about the same, but individual teams rise and fall.

## Broadcast length

- **Regular-season games:** about 7 minutes.
- **Semifinals:** about 9 minutes.
- **IFL Bowl:** about 14 minutes, with slower pacing, longer celebrations and a longer halftime.

The Bowl also gets a short pregame break after the semifinals on finals day. While a playoff game or the Bowl is on (or starting within 90 minutes), every page shows a banner linking to it.

## Everyone else

- **Home:** the front page, with the featured game (live, next up or latest final), auto-written headlines (results, upsets, injuries, streaks, clinches), this week's scoreboard, standings, leaders and the playoff bracket.
- **Live:** the game on air, ESPN Gamecast style.
  - **Joining:** viewers who join late land on the current play. When nothing is on air, a pregame card counts down to kickoff.
  - **Tabs:** Gamecast (field, drive tracker, win probability, scoring summary, game leaders, line score), Box Score, Play-by-Play grouped by drive, and Team Stats.
  - **Fullscreen:** the ⛶ button on the field, or press F, shows just the scoreboard and field across the whole screen.
  - **Kickoff intro:** every game opens with a team-versus-team intro.
- **Season:** IFL West and IFL East standings, the playoff picture, the schedule with air times, results and league leaders. Any finished game can be **replayed** at your own pace (1×–10×).
- **History:** champions, all-time standings, league records, and every past season's standings, leaders and results, all replayable.
- **Exhibition** (top of the Live tab): play any matchup on your own screen. It's not saved and doesn't affect the league.

## Notes

- Games are generated from a seed, so a game always replays exactly the same way. Don't change `engine.js` in the middle of a season, or replays of that season's games won't match their recorded results.
- To move the league to another machine, copy the `data/` folder along with everything else.
- Opening `public/index.html` directly (without the server) still works, but only for exhibition games.
