# Ironclad Arena – online multiplayer

* `index.html` – the whole game (hosted on GitHub Pages, or served by the Render server)
* `server/server.js` – tiny WebSocket relay (no dependencies) that runs on Render
* `render.yaml` – tells Render how to run the server
* `.github/workflows/pages.yml` – publishes `index.html` to GitHub Pages on every push

## 1. Put it on GitHub
1. Create a new empty repository on github.com (public is fine).
2. Upload everything in this folder (keep the same layout), or:
   `git init && git add . && git commit -m "Ironclad Arena" && git branch -M main && git remote add origin <your repo url> && git push -u origin main`
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab, wait for "Deploy to GitHub Pages" to finish. Your game is at `https://<you>.github.io/<repo>/`.

## 2. Run the server on Render
1. Sign in at render.com with GitHub.
2. **New → Blueprint**, pick your repository. Render reads `render.yaml` and creates a free web service.
   (Or **New → Web Service**: Root Directory `server`, Build Command `cp ../index.html ./index.html || true`, Start Command `node server.js`.)
3. When it is live you get a URL like `https://ironclad-arena-server.onrender.com`. Opening it also serves the game itself.

## 3. Play
1. Open the game (GitHub Pages or the Render URL).
2. Press **ONLINE**. Server address: `wss://ironclad-arena-server.onrender.com` (same name as your Render URL, with `wss://`).
   Shortcut: open the game as `https://<you>.github.io/<repo>/?server=wss://ironclad-arena-server.onrender.com` to prefill it.
3. Enter a name and a room code (or press **NEW ROOM**) and send the code to friends. 3 v 3, first team to 15 kills. Esc leaves.

## Notes
* Free Render services sleep when idle; the first connection can take up to a minute.
* Each player simulates their own mech and sends hits to the victim, so it is friendly-play only (a modified client could cheat).
* Special-ability projectiles and goo pools are only visible to the player who fires them (their damage still counts).
* Test locally: `cd server && node server.js`, open `index.html` from `http://localhost:8080/`, server `ws://localhost:8080`.
