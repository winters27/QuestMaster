/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A way to exercise the plugin without waiting for Discord to post a real quest.
 *
 * Most of this plugin can only be tested when a live quest happens to exist, of the right type,
 * in the right state, which is why so much of it shipped unverified. Setting these before the
 * plugin starts swaps in your own quests and your own request layer, so every panel group and
 * every failure path can be reached on demand and nothing reaches Discord.
 *
 * Nothing writes to this object; it is absent unless you put it there yourself.
 *
 *   window.__questMasterDev = {
 *       quests: [ ...fake quest objects... ],
 *       RestAPI: { get: async () => ({ body: [] }), post: async () => ({ body: {} }) },
 *   };
 */

export interface DevOverrides {
    /** Stands in for QuestsStore's quests. */
    quests?: QuestValue[];
    /** Stands in for RestAPI, so no request leaves the client. */
    RestAPI?: { get(...args: any[]): Promise<any>; post(...args: any[]): Promise<any>; };
    /** Stands in for the stores the game and stream handlers spoof. */
    stores?: Record<string, any>;
}

function overrides(): DevOverrides | null {
    const dev = (window as any).__questMasterDev;
    return dev && typeof dev === "object" ? dev as DevOverrides : null;
}

export function isDevMode() {
    return overrides() != null;
}

/** The quest list to work from: yours if you supplied one, Discord's otherwise. */
export function devQuests(real: QuestValue[]): QuestValue[] {
    return overrides()?.quests ?? real;
}

/** The request layer to use. Swapping this is what keeps a test off the network. */
export function devRestAPI<T>(real: T): T {
    return (overrides()?.RestAPI as T | undefined) ?? real;
}

/** A store to spoof against, when you would rather not touch the client's own. */
export function devStore<T>(name: string, real: T): T {
    return (overrides()?.stores?.[name] as T | undefined) ?? real;
}
