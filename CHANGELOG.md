# Changelog

Newest first. The panel shows this file under What's new, so keep every entry a short plain
sentence: one `## <version> - <YYYY-MM-DD>` heading per release with `-` bullets under it, and no
nested lists. Links and emphasis are stripped when the panel renders it.

## 1.4.0 - 2026-09-09

- Activity quests now give up when Discord accepts heartbeats without crediting any time. They used to send those forever without saying anything.
- Per-quest controls in the panel: pause, resume and stop a running quest, run a queued one now, skip one you never want, and retry one that failed.
- Pause everything from the panel header. The pause is remembered across restarts, on purpose.
- The panel button now finds its place in the title bar when Discord is running in a language other than English.
- Each quest shows what it pays in orbs, the claim section shows how many are waiting, and the stats strip totals the ones already claimed.
- Switches for each quest type, so you can leave stream quests alone and still run everything else. A type you switch off is neither accepted nor started.
- A toast when a reward becomes claimable. One per quest, and it can be switched off.
- What's new: this file, in the panel, marked until you have read it.
- Testing hook: set window.__questMasterDev before the plugin starts to run it against your own quests and your own request layer, so nothing reaches Discord.

## 1.3.0 - 2026-07-29

- The update notice makes Run Update.bat a link that opens Explorer with the file selected.

## 1.2.1 - 2026-07-29

- Stopped the captcha retry loop on claiming. A challenged claim now waits two minutes instead of asking for another captcha straight away.
- With no solver key configured, the captcha is handed to you once a minute instead of being retried and advertised at on every attempt.
- Fixed a configured solver key being ignored on claims.

## 1.2.0 - 2026-07-29

- Live quest panel: quests grouped into ready to claim, running, play these yourself, skipped and queued, with a progress bar and a reason on every skipped row.
- Update notice that tells you a new version exists. It deliberately cannot install one.
- The panel and its button are drawn by the plugin rather than borrowed from Discord, so a Discord update cannot take them away. Ctrl+Shift+Q opens the panel.
- Followed Discord moving the quest application into taskConfigV2, which had stopped every quest from completing or claiming.
- Fixed concurrent game quests clobbering each other, so only one could ever finish.
- Added a heartbeat watchdog, so a quest Discord never starts says so instead of sitting at 0 per cent.
