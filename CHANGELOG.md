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
- Every quest row shows the game art Discord ships with it, or an icon for the task type when it ships none.
- The header says what the plugin is doing in words, not just as a coloured dot.
- The panel button carries a count: green for rewards waiting, amber for quests outstanding, a pause mark while everything is held.
- Settings live in the panel now, behind the gear: what to accept and claim, a switch for each quest type, retrying everything that failed, emptying the skip list, and About with the changelog and the update check. The header keeps three buttons so it has room to say what the plugin is doing.
- Drag the panel by its header and it stays where you put it. Esc closes it.
- What's new: this file, in the panel, marked until you have read it.
- Stream quests say what they are waiting for: going live, or someone joining the call. They used to sit at nothing with no explanation, because this is the one quest type with no time limit and so no watchdog to notice.
- Quests that need an achievement earned in the game itself no longer say to launch them from the quest. That advice is right for activity achievements and wrong for these, and the two were being told apart by a shared word in the name.
- Two stream quests at once no longer leave the client spoofing after both have finished. Only one of them can hold the stream, and the other now says so instead of sitting at zero.
- Game quests no longer hide the game you are really playing. The spoof used to stand in for what was running instead of adding to it, so for as long as a quest ran, Discord could not see your actual game.
- A heartbeat Discord tried and failed no longer looks like Discord going quiet. Those are read now, the reason is named, and a quest survives a failed beat instead of being abandoned half a minute before Discord tries again.
- Quests wait longer before giving up. The old window was set on the belief that Discord reports every 30 seconds; it appears to be every minute, which made the window shorter than intended rather than longer.
- Quests keep working if Discord changes how it sends a quest task list. One of the two shapes it can arrive in would have made every quest read as unsupported.
- Activity achievement quests can now be completed without playing them, behind a switch that is off until you turn it on. It is the only thing here that acts on your account rather than on your client: it authorizes the quest app on your account, reports progress to that activity, then revokes the authorization. Read the note above the switch before turning it on. Age-gated activities still refuse, and quests needing an achievement in a real game cannot be done at all.
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
