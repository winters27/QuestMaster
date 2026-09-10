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

function realGames(): any[] {
    const games = real.getRunningGames?.call(store);
    return Array.isArray(games) ? games : [];
}

/**
 * What Discord should believe is running: the games really running, plus ours.
 *
 * Also the right payload for a `RUNNING_GAMES_CHANGE` dispatch, which must describe the whole set
 * rather than only our half of it.
 */
export function getAllGames(): any[] {
    return store ? [...realGames(), ...getSpoofedGames()] : getSpoofedGames();
}

function patch(target: any) {
    if (store) return;
    store = target;

    for (const name of PATCHED_METHODS) {
        if (typeof target[name] === "function") real[name] = target[name];
    }

    // Add to what is really running rather than standing in for it. Replacing the answer meant
    // that for as long as a quest ran, Discord could not see the game you were actually playing,
    // and everything keyed on that went with it.
    target.getRunningGames = () => [...realGames(), ...getSpoofedGames()];
    target.getGameForPID = (pid: number) =>
        getSpoofedGames().find(g => g.pid === pid) ?? real.getGameForPID?.call(target, pid);

    if (real.getVisibleGame) {
        target.getVisibleGame = () => getSpoofedGames()[0] ?? real.getVisibleGame.call(target);
    }
    if (real.getVisibleRunningGames) {
        target.getVisibleRunningGames = () => {
            const games = real.getVisibleRunningGames.call(target);
            return [...(Array.isArray(games) ? games : []), ...getSpoofedGames()];
        };
    }
    if (real.getCandidateGames) {
        target.getCandidateGames = () => {
            const games = real.getCandidateGames.call(target);
            return [...(Array.isArray(games) ? games : []), ...getSpoofedGames()];
        };
    }
    if (real.getRunningDiscordApplicationIds) {
        target.getRunningDiscordApplicationIds = () => {
            // This used to read the real ids and then throw them away, keeping them only to see
            // whether the collection was a Set. Merge into whatever shape came back.
            const ids = real.getRunningDiscordApplicationIds.call(target);
            const ours = getSpoofedGames().map(g => String(g.id));

            if (ids instanceof Set) return new Set([...ids, ...ours]);
            return [...(Array.isArray(ids) ? ids : []), ...ours];
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
