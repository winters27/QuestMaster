/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * When to give up on a quest Discord is supposed to be beating for.
 *
 * The plugin sends nothing once the spoof is installed: Discord drives these heartbeats and we only
 * read them off the dispatcher. Two things follow that the first version of this got wrong.
 *
 * It watched successes only. Discord also dispatches a failure, and it does not resend a failed
 * beat: the next attempt is the tick already scheduled. So a failure and silence looked identical,
 * and the watchdog reported "Discord stopped sending heartbeats" for a beat Discord had answered
 * with an error it was willing to name.
 *
 * And the deadline was set at 90 s on the belief that Discord beats every 30 s, a number with no
 * source behind it. The cadence appears to be a flat minute, which made 90 s one and a half beats
 * rather than three, so a single failed beat ended a quest half a minute before Discord's next
 * attempt.
 */

/**
 * Before anything has been credited, kept deliberately short: nothing arriving at all points at the
 * spoof rather than at Discord, and that answer is worth having quickly.
 */
export const FIRST_BEAT_GRACE_MS = 90_000;

/**
 * Once Discord has credited a beat it is driving the quest, so the deadline widens to survive one
 * lost or failed tick. Two and a half beats at the cadence above.
 */
export const HEARTBEAT_GRACE_MS = 150_000;

/** Consecutive failures that end a task rather than waiting out the deadline. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface Verdict {
    /** The console line. */
    message: string;
    /** The short reason for the panel row. */
    reason: string;
}

export interface WatchdogOptions {
    questName: string;
    onGiveUp(verdict: Verdict): void;
}

/**
 * Turns Discord's failure payload into something worth reading. It wraps the failure in its own
 * error type, so the useful parts sit at different depths depending on whether the request got a
 * response at all.
 */
export function describeHeartbeatError(payload: any): string {
    const error = payload?.error ?? payload;
    const parts: string[] = [];

    const status = error?.status ?? error?.httpStatus;
    if (status) parts.push(`HTTP ${status}`);

    const code = error?.body?.code ?? error?.code;
    if (code != null && code !== status) parts.push(`code ${code}`);

    const message = error?.body?.message ?? error?.message;
    if (message) parts.push(String(message));

    // Only worth stringifying something that exists. JSON.stringify(null) is the string "null",
    // which reads like a detail and is not one.
    if (parts.length === 0 && error != null) {
        try {
            parts.push(JSON.stringify(error).slice(0, 160));
        } catch {
            parts.push(String(error));
        }
    }

    return parts.join(", ") || "no detail";
}

export class HeartbeatWatchdog {
    private readonly options: WatchdogOptions;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private credited = 0;
    private failed = 0;
    private consecutiveFailures = 0;
    private lastFailure: string | null = null;
    private settled = false;

    constructor(options: WatchdogOptions) {
        this.options = options;
    }

    /** Beats Discord has credited so far. */
    get beats() {
        return this.credited;
    }

    start() {
        this.arm();
    }

    /** Discord credited a beat. */
    beat() {
        if (this.settled) return;
        this.credited++;
        this.consecutiveFailures = 0;
        this.arm();
    }

    /** Discord tried and failed. */
    fail(why: string) {
        if (this.settled) return;
        this.failed++;
        this.consecutiveFailures++;
        this.lastFailure = why;

        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            this.giveUp({
                message: `[QuestMaster] Discord's heartbeat for "${this.options.questName}" failed ${this.consecutiveFailures} times in a row: ${why}. Giving up rather than waiting out the deadline.`,
                reason: `Discord could not report progress (${why})`,
            });
            return;
        }

        console.warn(`[QuestMaster] Discord's heartbeat for "${this.options.questName}" failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${why}`);

        // With nothing credited yet the spoof itself is the suspect, so the first deadline stands
        // and the answer arrives quickly. After that, a failure is proof Discord is still driving
        // the quest and will try again on its next tick.
        if (this.credited > 0) this.arm();
    }

    /** Detach. No verdict can follow and no timer is left behind. */
    stop() {
        this.settled = true;
        this.disarm();
    }

    private arm() {
        this.disarm();
        const grace = this.credited > 0 ? HEARTBEAT_GRACE_MS : FIRST_BEAT_GRACE_MS;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.giveUp(this.silenceVerdict());
        }, grace);
    }

    private disarm() {
        if (this.timer != null) clearTimeout(this.timer);
        this.timer = undefined;
    }

    private giveUp(verdict: Verdict) {
        if (this.settled) return;
        this.settled = true;
        this.disarm();
        this.options.onGiveUp(verdict);
    }

    /** What to say when nothing arrived at all. A failed beat reads differently from silence. */
    private silenceVerdict(): Verdict {
        const { questName } = this.options;
        const reason = this.failed > 0
            ? `Discord stopped reporting (${this.failed} failed beat${this.failed === 1 ? "" : "s"})`
            : "Discord never started it";

        if (this.credited === 0) {
            return {
                message: this.failed > 0
                    ? `[QuestMaster] Discord never credited progress for "${questName}". All ${this.failed} beat(s) it tried failed, the last one: ${this.lastFailure}.`
                    : `[QuestMaster] Discord never sent a heartbeat for "${questName}". It is not accepting the spoof on this client, so there is nothing to wait for.`,
                reason,
            };
        }

        const tail = this.failed > 0
            ? `after ${this.credited} update(s) and ${this.failed} failed beat(s), the last one: ${this.lastFailure}.`
            : `after ${this.credited} update(s).`;

        return {
            message: `[QuestMaster] Discord stopped reporting progress for "${questName}" ${tail} Giving up instead of idling.`,
            reason,
        };
    }
}
