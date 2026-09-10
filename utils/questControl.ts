/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * One controller per running quest, so a quest can be paused, resumed or stopped from the panel
 * without every handler needing to know how it was driven.
 *
 * Handlers that drive their own loop await `gate()` between steps. Handlers that only listen for
 * Discord's heartbeats cannot be stopped mid-step, so they register `onPause` / `onResume` and
 * drop their spoof instead: Discord stops seeing the game, stops sending heartbeats, and the quest
 * genuinely halts rather than only looking halted.
 */

export class Cancelled extends Error {
    reason: string;

    constructor(reason: string) {
        super(`cancelled: ${reason}`);
        this.name = "Cancelled";
        this.reason = reason;
    }
}

/** Why a quest is paused. Two sources, tracked separately. */
export type Hold = "user" | "all";

export interface QuestController {
    questId: string;
    paused: boolean;
    cancelled: boolean;
    reason: string | null;
    hold(why: Hold): void;
    release(why: Hold): void;
    heldBy(why: Hold): boolean;
    cancel(reason: string): void;
    /** Waits while paused, throws once cancelled. Call between steps. */
    gate(): Promise<void>;
    /** Sleep that wakes early on cancel and does not count time spent paused. */
    sleep(ms: number): Promise<void>;
    onPause: (() => void) | null;
    onResume: (() => void) | null;
    onCancel: (() => void) | null;
}

const controllers = new Map<string, QuestController>();

let globallyPaused = false;

function makeController(questId: string): QuestController {
    // A set rather than a boolean, because pausing one quest by hand and pausing everything are
    // two different holds. Lifting one must not lift the other.
    const holds = new Set<Hold>();
    let waiters: Array<() => void> = [];

    const wake = () => {
        const pending = waiters;
        waiters = [];
        for (const resolve of pending) resolve();
    };

    const ctl: QuestController = {
        questId,
        paused: false,
        cancelled: false,
        reason: null,
        onPause: null,
        onResume: null,
        onCancel: null,

        hold(why) {
            holds.add(why);
            sync();
        },

        release(why) {
            holds.delete(why);
            sync();
        },

        heldBy(why) {
            return holds.has(why);
        },

        cancel(reason) {
            if (ctl.cancelled) return;
            ctl.cancelled = true;
            ctl.reason = reason;
            try {
                ctl.onCancel?.();
            } catch (err) {
                console.error("[QuestMaster] Cancel hook failed:", err);
            }
            wake();
        },

        async gate() {
            while (true) {
                if (ctl.cancelled) throw new Cancelled(ctl.reason ?? "stopped");
                if (!ctl.paused) return;
                await new Promise<void>(resolve => waiters.push(resolve));
            }
        },

        async sleep(ms) {
            let left = ms;

            while (true) {
                await ctl.gate();
                if (left <= 0) return;

                const startedAt = Date.now();
                await new Promise<void>(resolve => {
                    const timer = setTimeout(() => {
                        waiters = waiters.filter(w => w !== bump);
                        resolve();
                    }, left);
                    const bump = () => {
                        clearTimeout(timer);
                        resolve();
                    };
                    waiters.push(bump);
                });
                left -= Date.now() - startedAt;
            }
        },
    };

    function sync() {
        const shouldPause = holds.size > 0;
        if (ctl.cancelled || ctl.paused === shouldPause) return;

        ctl.paused = shouldPause;
        try {
            (shouldPause ? ctl.onPause : ctl.onResume)?.();
        } catch (err) {
            console.error("[QuestMaster] Pause hook failed:", err);
        }
        wake();
    }

    return ctl;
}

export function createController(questId: string): QuestController {
    // A quest starting while everything is paused must start paused, or the global pause leaks.
    const existing = controllers.get(questId);
    if (existing && !existing.cancelled) return existing;

    const ctl = makeController(questId);
    if (globallyPaused) ctl.hold("all");
    controllers.set(questId, ctl);
    return ctl;
}

export function getController(questId: string) {
    return controllers.get(questId);
}

export function removeController(questId: string) {
    controllers.delete(questId);
}

export function isGloballyPaused() {
    return globallyPaused;
}

export function setGlobalPause(paused: boolean) {
    if (globallyPaused === paused) return;
    globallyPaused = paused;

    for (const ctl of controllers.values()) {
        if (paused) ctl.hold("all");
        else ctl.release("all");
    }
}

/** Stops everything and forgets it. Used when the plugin shuts down. */
export function cancelAllControllers(reason: string) {
    for (const ctl of controllers.values()) ctl.cancel(reason);
    controllers.clear();
    globallyPaused = false;
}
