/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * What the panel's buttons do. Kept apart from the plugin entry point so the panel can call these
 * without the two importing each other.
 *
 * The plugin registers how to start a quest at startup; everything else here only needs the
 * controllers and the settings.
 */

import { clearQuestRuntime, getQuestRuntime, setQuestRuntime } from "./questState";
import settings from "./settings";
import { cancelAllControllers, getController, isGloballyPaused, setGlobalPause } from "./utils/questControl";

type StartQuest = (questId: string) => void | Promise<void>;

let startQuest: StartQuest | null = null;

export function registerQuestRunner(fn: StartQuest | null) {
    startQuest = fn;
}

// ---- Skip list ---------------------------------------------------------

/** Quests you told the plugin to leave alone. */
export function getSkippedIds(): Set<string> {
    const raw = settings.store.skippedQuestIds ?? "";
    return new Set(raw.split("\n").map(line => line.trim()).filter(Boolean));
}

export function isSkipped(questId: string) {
    return getSkippedIds().has(questId);
}

function writeSkipped(ids: Set<string>) {
    settings.store.skippedQuestIds = [...ids].join("\n");
}

// ---- Per-quest actions -------------------------------------------------

export function pauseQuest(questId: string) {
    const ctl = getController(questId);
    if (!ctl) return false;

    ctl.hold("user");
    setQuestRuntime(questId, { status: "paused" });
    return true;
}

export function resumeQuest(questId: string) {
    const ctl = getController(questId);
    if (!ctl) return false;

    ctl.release("user");
    // Resuming one quest lifts a global pause too, since leaving it on would make the button
    // look like it did nothing.
    if (isGloballyPaused()) setPaused(false);
    setQuestRuntime(questId, { status: "running" });
    return true;
}

/** Stop this quest and do not start it again until told otherwise. */
export function stopQuest(questId: string) {
    getController(questId)?.cancel("stopped by you");

    const ids = getSkippedIds();
    ids.add(questId);
    writeSkipped(ids);

    setQuestRuntime(questId, { status: "stopped", why: "stopped by you", failed: false });
    return true;
}

/** Same list as stop, for a quest that was never started. */
export function skipQuest(questId: string) {
    return stopQuest(questId);
}

export function unskipQuest(questId: string) {
    const ids = getSkippedIds();
    if (!ids.delete(questId)) return false;

    writeSkipped(ids);
    clearQuestRuntime(questId);
    void startQuest?.(questId);
    return true;
}

/** Clear whatever went wrong and run it again from the top. */
export function retryQuest(questId: string) {
    const ids = getSkippedIds();
    if (ids.delete(questId)) writeSkipped(ids);

    clearQuestRuntime(questId);
    void startQuest?.(questId);
    return true;
}

/** Start a queued quest without waiting for the next scan. */
export function runNow(questId: string) {
    const ctl = getController(questId);
    if (ctl && !ctl.cancelled) return resumeQuest(questId);

    const ids = getSkippedIds();
    if (ids.delete(questId)) writeSkipped(ids);

    if (isGloballyPaused()) setPaused(false);
    void startQuest?.(questId);
    return true;
}

// ---- Bulk actions ------------------------------------------------------

/** Runs every quest the plugin gave up on again. Does not touch ones you stopped yourself. */
export function retryAllFailed() {
    const failed = [...getQuestRuntime().values()].filter(rt => rt.status === "skipped");
    for (const rt of failed) retryQuest(rt.id);
    return failed.length;
}

/** Empties the skip list, so everything in it is eligible again on the next scan. */
export function clearSkipList() {
    const ids = getSkippedIds();
    if (ids.size === 0) return 0;

    settings.store.skippedQuestIds = "";
    for (const id of ids) clearQuestRuntime(id);
    return ids.size;
}

// ---- Global pause ------------------------------------------------------

export function isPaused() {
    return settings.store.questsPaused === true;
}

export function setPaused(paused: boolean) {
    settings.store.questsPaused = paused;
    setGlobalPause(paused);

    // A quest paused by hand stays paused when everything else resumes, so only the rows that
    // the global pause is actually holding change their label.
    for (const [id, ctl] of runningControllers()) {
        if (ctl.heldBy("user")) continue;
        setQuestRuntime(id, { status: paused ? "paused" : "running" });
    }
}

function* runningControllers() {
    for (const id of trackedIds) {
        const ctl = getController(id);
        if (ctl && !ctl.cancelled) yield [id, ctl] as const;
    }
}

/** Quest ids with a live controller, so a global pause knows which rows to relabel. */
const trackedIds = new Set<string>();

export function trackQuest(questId: string) {
    trackedIds.add(questId);
}

export function untrackQuest(questId: string) {
    trackedIds.delete(questId);
}

export function resetOps() {
    cancelAllControllers("plugin stopped");
    trackedIds.clear();
    registerQuestRunner(null);
}
