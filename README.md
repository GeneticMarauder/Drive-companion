# Drive Companion

Two things for an 11-hour cross-country drive on Android + Android Auto:

1. **[Text adventure co-pilot](#text-adventure-co-pilot)**: talk, and an AI co-pilot plays a text adventure for you and reads it aloud.
2. **[Spotify and Audible by voice](#spotify-and-audible-by-voice)**: no app needed.

---

# Text adventure co-pilot

A web app on your phone. You talk; Claude Haiku turns what you say into game commands, plays them, and reads the story aloud through the car speakers. Ask it to repeat or explain anything. It runs real modern parser games (Glulx and Z-code: `.gblorb`, `.ulx`, `.zblorb`, `.z5`, `.z8`) and saves after every turn.

**App:** https://geneticmarauder.github.io/Drive-companion/ (after the one-time setup below)

## One-time setup

1. **Turn on GitHub Pages** (2 minutes, can be done from the phone): repo **Settings → Pages → Build and deployment → Deploy from a branch**, branch `ccr-d7be69ae-n9k8hi`, folder **`/docs`**, then **Save**. The site goes live a minute or two later at the address above.
2. **On the phone, open that address in Chrome**, then use the ⋮ menu and choose **Add to Home screen**. It now opens like an app, and it works offline once it has loaded.
3. **Paste your Anthropic API key** into the box and tap **Save key**. It's stored only in Chrome on that phone and is sent only to Anthropic. Also keep a copy in Google Password Manager or your password app.
4. In the [Anthropic Console](https://console.anthropic.com/), set a **monthly spend limit** (for example $10) as a safety net.

## Driveway test (10 minutes, do this before the trip)

With the phone plugged in and Android Auto connected:

1. Open the app, tap **Play** on **Lantern Hill** (the 5-minute test game), then tap the big circle.
2. Check you **hear the story through the car speakers**. If it plays from the phone instead, open the car's audio source / Android Auto media and pick the phone.
3. Say "let's walk up the hill" and check that **it hears you** (the circle turns green while listening, and your words appear under it).
4. Finish the 5-minute game. If that works, the real games will too.

## The games

All three are built in as **Featured games**. Tap **Download all three** once on Wi-Fi; after that they're stored on the phone and play with no signal.

- **Counterfeit Monkey** (Emily Short, 2012): #1 on IFDB's all-time ranking, and long enough for several driving days.
- **Dr Ludwig and the Devil** (SV Linwood, 2023): IFComp 2023 winner.
- **THE BAT** (Chandler Groover, 2024): IFComp 2024 winner.

Each game keeps its own save, so you can switch between them. The files come straight from the [IF Archive](https://ifarchive.org/). If a download ever fails, the app links to the game's IFDB page so you can grab the file and add it with **Add another game file**. That button also takes any other Glulx or Z-code game, zipped or not.

## Talking to it

Just talk naturally: "let's check out that door", "take everything", "go back to the office", "what am I carrying?", "you play for a while". It ignores chatter that isn't meant for it ("turn left here").

These work instantly, without using the AI:

| Say | What happens |
|---|---|
| "Repeat" / "say that again" | Re-reads the last thing it said |
| "Pause" / "hold on" | Stops responding until you say "resume" |
| "Resume" / "I'm back" | Picks back up |
| "Slower" / "faster" | Changes the reading speed |
| "How much have we spent?" | Says this session's AI cost |

Tap the circle to skip what it's reading, or to pause.

The story also scrolls on screen like a normal text adventure: game text, the commands the co-pilot typed (`> open door`), and its own remarks. It's saved with each game, so it's still there when you come back. **Aa** changes the text size.

## The narrator voice

By default the story is read by a **documentary-style narrator**: OpenAI's voice model, told to sound like a warm, hushed, unhurried British nature-documentary narrator. (It's a style, not an imitation of any real person.)

1. Create an OpenAI API key at https://platform.openai.com/api-keys (add a few dollars of credit and set a monthly limit).
2. In the app's **Voice** section, paste it into **OpenAI API key**, tap **Save OpenAI key**, and you'll hear a sample.
3. Choose a **Narrator voice**. Fable, the British one, is the default.

It costs about **1.5¢ per minute of narration**, roughly $2–4 for a long day of play, and the screen's cost counter includes it. With no signal, or if the key stops working, it switches to the phone's built-in voice automatically. Choose **Phone's built-in voice (free)** to turn it off.

## Cost and battery

- **Cost:** about **$0.0003 per turn**, which is roughly **50 cents for an 11-hour day** (measured in testing on Claude Haiku 5.5). It's billed to your API account, separately from any Claude subscription. The screen shows the running cost.
- **Battery:** the phone's screen must stay on with Chrome in front (the app keeps it awake), so **keep the phone on the charger**. Speech recognition and reading aloud use the phone's free built-in engines.
- **No signal:** the app still opens and the game still runs. Your words go straight to the game's parser instead of through the AI, and it says so once. Speech recognition itself may need a signal on some phones.

## Good to know

- Android may beep each time it starts listening. That's the phone's speech recognizer, and the app can't turn it off.
- Keep the app on the phone screen. If you switch apps or lock the phone, Chrome stops listening; come back and tap the circle.
- Everything is saved after each turn. **‹ Games → Play** later says "Tap to continue" and picks up where you left off.
- Keep it audio-only and say "pause" whenever the road needs your full attention.

## For developers

```bash
npm install
npm run build          # copy interpreters + bundle the SDK into docs/vendor, compile the test game
npm test               # engine + agent tests (live Claude test runs if ANTHROPIC_API_KEY is set)
node tests/browser.e2e.mjs   # headless Chromium end-to-end test of the real page
npm run serve          # local server at http://localhost:8080
```

`docs/engine.js` runs the game with the [Emglken](https://github.com/curiousdannii/emglken) WebAssembly interpreters (Git for Glulx, Bocfel for Z-code) behind a headless GlkOte. `docs/agent.js` is the Claude Haiku tool-use loop with a direct-mode fallback. `docs/voice.js` handles the Web Speech API in and out. No server: the API key stays on the phone.

---

# Spotify and Audible by voice

**Setup:** Android phone + Android Auto. The "assistant" is the voice assistant Android Auto already has (Gemini, which replaced Google Assistant; it still answers to "Hey Google"). It's free, it doesn't use any Claude quota, and you don't need a custom app or the MacBook.

## Why nothing custom is needed

- Android only lets one media app play at a time. When you start Audible, Spotify pauses, and the other way round.
- Audible saves your place when it's interrupted, so going back resumes the book where you left off.
- So "switching" is just "play X on [app]", and Gemini on Android Auto already does that by voice.

## Voice cheat sheet

Wake it with **"Hey Google"**, the mic button on the Android Auto screen, or a long press of the steering-wheel voice button.

**Always say the app name.** Gemini falls back to whichever music app you used last, so without the name it may pick the wrong one.

| Want | Say |
|---|---|
| Back to the book | "Play my audiobook on Audible" / "Resume Audible" |
| A specific book | "Play *Project Hail Mary* on Audible" |
| Music | "Play my Liked Songs on Spotify" / "Play Discover Weekly on Spotify" |
| An artist or genre | "Play Tom Petty on Spotify" / "Play road trip rock on Spotify" |
| Pause / resume | "Pause" / "Resume" |
| Skip around in the book | "Skip forward 30 seconds" / "Go back 30 seconds" |
| Next song | "Next song" / "Skip" |

**Fallback if a command doesn't work:** the media button on the Android Auto screen opens the app switcher, so Audible or Spotify is one tap away. The steering-wheel controls handle play, pause and skip for whichever app is active.

## Before you leave (test in the driveway)

1. **Update** Android Auto, Gemini, Spotify and Audible from the Play Store.
2. **Test each command above while parked and plugged in.** Audible voice support through Gemini is the piece most likely to be flaky. If "on Audible" fails, try "Play *[book title]* on Audible", or use the one-tap fallback.
3. **Download offline:**
   - Spotify (Premium): download a few big playlists.
   - Audible: download every book you might want.
   - Google Maps: download offline maps for your route.

   Rural stretches (West Texas, Nevada, Wyoming and the like) have long dead zones. Offline files keep playback going and stop the phone burning battery hunting for signal.

## Battery for 11-hour days

- **Use wired Android Auto if your car supports it.** It charges the phone while it runs.
- **If you use wireless Android Auto, plug the phone into a charger anyway.** Nav, streaming and the wireless link together can drain the battery faster than a weak port charges it. Use a **USB-C PD car charger (20 W or more)** and a good cable. Old car USB ports often only give about 0.5 to 1 A.
- **Keep the phone out of direct sun and off the dash.** A hot phone throttles its charging or stops charging altogether. A vent mount helps.
- **Use offline downloads** (see above). They're the single biggest battery saver after charging.
- **Avoid Gemini Live,** the open-ended conversation mode, for long stretches. Short commands are cheap; a live conversation keeps the mic and network busy.

## Where the MacBook fits

Leave it out of the driving loop. It adds a second device to charge and manage, and it can't do anything here that the phone and Android Auto don't already do natively. It's still useful the night before for downloading things over hotel Wi-Fi if you're short on mobile data.
