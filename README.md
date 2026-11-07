# Drive Companion

Voice switching between Spotify and Audible on an 11-hour cross-country drive.

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
