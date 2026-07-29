/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * One shared set of spoofed games for every quest running at once.
 *
 * Each quest used to patch RunningGameStore with its own single-game array, so starting a second
 * game quest replaced the first one's game rather than joining it. Discord stopped seeing the
 * first game and stopped heartbeating that quest, and the second quest also captured the first
 * quest's override as the "real" method, so cleanup restored a patch instead of the original.
 * The store is patched once here and the games are pooled.
 */

const PATCHED_METHODS = [
    "getRunningGames",
    "getGameForPID",
    "getVisibleGame",
    "getVisibleRunningGames",
    "getRunningDiscordApplicationIds",
    "getCandidateGames",
];

const spoofed = new Map<string, any>();

let store: any = null;
let real: Record<string, any> = {};

export function getSpoofedGames() {
    return [...spoofed.values()];
}

function patch(target: any) {
    if (store) return;
    store = target;

    for (const name of PATCHED_METHODS) {
        if (typeof target[name] === "function") real[name] = target[name];
    }

    target.getRunningGames = () => getSpoofedGames();
    target.getGameForPID = (pid: number) => getSpoofedGames().find(g => g.pid === pid);

    if (real.getVisibleGame) target.getVisibleGame = () => getSpoofedGames()[0] ?? null;
    if (real.getVisibleRunningGames) target.getVisibleRunningGames = () => getSpoofedGames();
    if (real.getCandidateGames) target.getCandidateGames = () => getSpoofedGames();
    if (real.getRunningDiscordApplicationIds) {
        target.getRunningDiscordApplicationIds = () => {
            // The collection type varies by build, so match whatever the real one returns.
            const ids = real.getRunningDiscordApplicationIds.call(target);
            const ours = getSpoofedGames().map(g => String(g.id));
            return ids instanceof Set ? new Set(ours) : ours;
        };
    }
}

function unpatch() {
    if (!store) return;

    for (const [name, fn] of Object.entries(real)) store[name] = fn;
    real = {};
    store = null;
}

export function addSpoofedGame(target: any, questId: string, game: any) {
    spoofed.set(questId, game);
    patch(target);
}

export function removeSpoofedGame(questId: string) {
    spoofed.delete(questId);
    // Hand the store back only once nothing is being spoofed any more.
    if (spoofed.size === 0) unpatch();
}
