# Plouf

A portrait-first quiz room built with HTML, CSS, JavaScript, Phaser 3 and Supabase. Static output runs on GitHub Pages at **plouf.space**.

## Run locally

```sh
npm ci
npm run dev
```

Open the printed local URL. Rooms use the configured Supabase project; apply the migration and enable anonymous sign-ins before creating or joining a live room.

The supplied project URL and public key are in ignored `.env.local`. For another checkout, copy `.env.example` to `.env.local` and supply `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_PROJECT_REF`. Never put a service-role key in a `VITE_` variable.

## Supabase setup — not executed during implementation

The app needs **anonymous sign-ins enabled** in the project's Authentication settings. Both hosts and guests get a persistent anonymous Supabase identity; no email or login form is needed. Keep that browser identity to retain access to a room. Hosts can also regain access on another device with the room password. Configure the Auth site URL as `https://plouf.space`.

The migration under `supabase/migrations/` creates the private tables and the transactional RPC API. Do not add the `private` schema to exposed API schemas. It stores host passwords as plaintext in a private table, as requested; clients cannot read that table or the answer keys.

The sync script needs one **personal access token**, supplied through the process environment variable `PLOUF_SECRET_SUPABASE`. Create it at https://supabase.com/dashboard/account/tokens with access to this project's migrations (read/write) and Edge Functions (read/write). This is a deployment token, not the project's `sb_secret_` API key. No database password or CLI login is needed.

For zsh, add this line to your private `~/.zshrc`:

```sh
export PLOUF_SECRET_SUPABASE='your_personal_access_token'
```

Then open a new terminal or run `source ~/.zshrc`. From the project folder:

```sh
python3 sync_supabase.py
```

The token is read only from the process environment, never from `.env.local`, command arguments or source files. Keep it out of the repository. Public app settings and the project reference can remain in `.env.local`.

The script applies pending migrations through the Supabase Management API, then uses `npx --yes supabase@2 functions deploy --use-api` to deploy **all local Edge Functions**, without requiring Docker. It passes the same token to the CLI in memory as `SUPABASE_ACCESS_TOKEN`. It never invokes login, links the project, uses a database password, resets the database, or deletes remote functions. `--dry-run` shows the local plan without contacting Supabase or running commands. A failed migration stops function deployment. It does not push Auth configuration; enable anonymous sign-ins in the dashboard separately.

API-applied migrations are named after their full local filename stem; Supabase assigns the remote migration timestamp. Subsequent syncs skip those names and also recognize older CLI-applied migrations by version. Keep using this script for migrations; switching back to `db push` requires reconciling API-assigned versions first. Applied migration files should remain unchanged; add a new migration for later changes. If a request times out, check remote migration history before retrying.

The game uses database functions for transactional timing and scoring; `supabase/functions/health` is an additional deployable Edge Function. The supplied config enables anonymous auth for future local Supabase use. The new `202611050001_theme_characters.sql` migration adds Jungle, the character catalog, and the room-theme lookup RPC. Apply it with the sync script before publishing this UI; no migration was executed during development.

## Languages and podium

The persistent EN/FR control loads `public/lang.json` with exactly two top-level keys, `en` and `frr` (FR is the visible label). French strings retain their accents. The choice is saved locally. Switching languages preserves form entries, the selected file, room state and music. Uploaded question and answer text is never translated or changed.

The selected answer text animates into a green check or red cross after the database responds. Feedback remains visible for at least one second even if everyone has already answered; server deadlines are unchanged. The other choices and correct-answer key are not exposed early.

At the end, every participant appears as a slowly wandering icon within a bounded strip at the bottom of the screen. First place jumps twice per two-second cycle. Reduced-motion settings suppress roaming and jumps. Only on their own device, first place may drag second or third off the podium, and second may drag third. Each target is usable once per local game session (retained in sessionStorage). Only a pointer gesture starting on the character image can trigger it: a tap or a short drag is rejected; it takes at least 90 pixels or 1.3 image widths and must leave the original image. The player name follows the dragged character, but dragging a name never starts the interaction. A successful drop follows five random screen-edge contacts over 1.8 seconds. First and second place see a translated winner notice in a fixed, 10%-height, 30%-gray bottom panel. No drag data or results are sent to Supabase.

## Questions

Upload a JSON array. Order is preserved; each entry must contain five nonempty text fields and four distinct answers:

```json
[
  {"Q":"What is the capital of France?","C":"Paris","W1":"Rome","W2":"Madrid","W3":"Berlin"}
]
```

An example download is included in the host form. There is no application question-count minimum or maximum. An empty array is valid and Play moves straight to the final screen. Practical limits still include browser memory, HTTP request size, database integer capacity and the selected Supabase plan.

## Room rules

- IDs start at `PID-10020`, allocated by updating a single locked database counter row. Passwords require at least four characters and are masked in the UI.
- New rooms have `started=false`, `playing=false`. **Start room** clears members, answers and scores, generates a new session ID, and opens the waiting room. Questions, theme, ID, password and host access remain.
- **Play** atomically locks entry and starts a five-second countdown. It cannot run twice or before Start. New guests may join only while started and not playing. An existing member may reconnect without joining again.
- Question order follows the JSON. Four answers are shuffled once on the server using PostgreSQL `pgcrypto` random bytes. Every client sees the same order. Only the current question and its answer texts are sent to clients; correctness stays in the database.
- Every question has 15 seconds, ending early when every member has answered. Five seconds separate questions. The host sees disabled answers (correct green, others red) and does not participate. Only authenticated hosts receive the correct choice in snapshots; guests do not. Disconnected guests still count as members; unanswered questions therefore finish at the deadline.
- The first executable statement in `submit_answer` captures `clock_timestamp()` before validation or locks. This timestamp is retained for deadline validation and auditing, not response-time scoring. The browser anchors a monotonic `performance.now()` clock to the end of the five-second countdown, captures elapsed milliseconds as the first click-handler action, and sends `p_elapsed_ms` (0–15000). The server stores that value in seconds with a 1 ms floor. Client-reported timing is trusted and can be altered by a modified client. Duplicate submissions are idempotent; old-session and old-question requests are rejected.
- Correct-answer feedback positions are assigned under the room lock, in database acceptance order. Under exceptional concurrent scheduling this can differ from the order of timestamps captured before that lock. Final question points use the browser-supplied elapsed times, with the fastest correct answer as the baseline: `round(1000 × fastest_correct_elapsed / player_elapsed)`. Wrong and missing answers earn zero. Elapsed times have a 1 ms floor to avoid dividing by zero. Exact score ties are ordered by join time, then member ID.
- Waiting rooms poll every second. Active rooms poll every 500 ms; clocks display a shared server deadline with an estimated clock offset. Database transitions are advanced by authenticated snapshot requests, so no paid scheduler or always-running server is needed. Network conditions can cause visible transition delays; polling does not provide frame-perfect synchronization.
- Between questions, first and last players occupy the arrow endpoints; an intermediate current player is exactly centered. Hosts see only the endpoints. Names here are player names, never character names.
- At the end, both room flags become false. The top three get a gold, silver and bronze podium with points and confetti. Fewer than three players show only the occupied places.

## Artwork and mobile layout

All 40 transparent PNG portraits, both role PNG icons, all eight desktop/mobile theme backgrounds, all six music tracks, and the language/character JSON catalogs load before role selection. Images and music are decoded before entering the app. The original individual portrait designs are used, with backgrounds removed; the later composite atlas is not used. The original count N is 10. `public/characters.json` organizes the 40 characters into four collections of exactly 10. Guests look up their room first and see only the matching collection; the database validates the selected character against the room theme. Character names appear only in the selection UI. Portraits always preserve their square aspect ratio. Waiting-room slots fit approximately 36–40 icons on a typical portrait phone, then overlap if full.

The three original generated theme PNGs remain unchanged. The jungle uses separate natural tropical foliage artwork without people, animals or fantasy elements. Theme PNGs are copied unchanged into `public/assets/`. They are shown at 80% opacity over white and **stretched to the viewport, never cropped**. Portrait mobile screens select matching `*-mobile.png` compositions; desktop uses the untouched landscape originals. Phaser renders falling snow, drifting bubbles, forest glitter, answer rewards and final confetti above the UI without intercepting touches. Reduced-motion preferences suppress the animated effects.

Six original instrumental tracks are included under `public/audio/`: a low-beat lobby track, Christmas bells, underwater marimba, fairy-forest flute/harp, tropical jungle flute/percussion, and a more rhythmic celebratory podium track. The lobby track plays outside rooms, the room theme plays in the waiting room and throughout questions, and the podium track plays on the results screen. Songs have soft endings and repeat with exactly 1.75 seconds of added silence. Everything plays from decoded buffers without fetching again. The permanent top-right sound toggle starts enabled, and its muted state persists across screens during the visit. Browser autoplay restrictions mean playback starts after the first user interaction. `scripts/compose_music.py` is the optional reproducible composition source (NumPy and ffmpeg); it is not needed to build or run the website.

Artwork was made with the built-in image generation tool. Prompts and the exact asset mapping are recorded in `public/assets/artwork.json`. The logo uses a handwritten mint-and-pink wordmark; display fonts load from Google Fonts with local fallbacks.

## GitHub Pages deployment

Commit the project on **main**, add your GitHub repository as `origin`, and make sure your normal Git credentials can push. Then:

```sh
./deploy.sh
```

The script builds the **committed main branch** in a disposable folder, runs tests, then commits only the built site to `gh-pages`. It creates that branch when missing, preserves existing branch history, and pushes without force. It does not switch or alter your working branch. Uncommitted source changes are not published. Public Vite settings from your ignored `.env.local` are copied into the build; exported Vite environment variables also work.

In GitHub Settings → Pages, select **Deploy from a branch → gh-pages → / (root)** and set the custom domain to `plouf.space`. Configure your domain's DNS for GitHub Pages and enable HTTPS. `public/CNAME` is copied to the deployment root automatically. `./deploy.sh --dry-run` builds and checks main without pushing or changing branches.

## Checks

```sh
npm test
npm run build
bash -n deploy.sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

Browser checks cover the mobile layout. Supabase commands and migrations were deliberately not executed, so live multiplayer, database concurrency and remote deployment still require an integration check after setup.

The host form’s “Demo questions” link previews the currently uploaded JSON locally, one player at a time, without countdowns or timers. Answer feedback lasts 1.4 seconds before automatic advancement; completion closes the preview without changing the upload.

The supplied podium recording uses source 1:49–2:14 as a 25-second intro, then loops source 1:57.76–2:07.76. It has a 0.45-second opening fade and equal-power crossfades into and around the loop. The podium loop has no silence gap; other music keeps its 1.75-second repeat gap. Edit details are in `public/audio/podium-edit.json`.

After syncing migrations, publish the matching frontend and refresh any already-open game tabs. Cached old clients omit `p_elapsed_ms`; the compatibility RPC requests a refresh rather than fabricating response times.
