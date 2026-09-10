/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * One shared patch of the streaming store for every stream quest at once.
 *
 * Each quest used to capture `getStreamerActiveStreamMetadata` into its own local and restore it on
 * cleanup. With two quests running, the second captures the first's override as "the real one", and
 * then unwinding restores a patch instead of the original: the first quest's cleanup silently
 * unspoofs the second, and the second's cleanup leaves the store patched with a dead closure for
 * the rest of the session. This is the same defect that was fixed for game quests in gameSpoof.ts.
 *
 * The lifecycle mirrors gameSpoof.ts: patch once, pool by quest id, unpatch when the last entry
 * goes. What cannot mirror it is the answer, because Discord asks a different question here.
 * `getRunningGames` returns a list, so every spoofed game coexists in it. This getter returns one
 * stream, so only one quest can be the answer at a time and the rest have nothing to say. The pool
 * therefore hands the stream to whichever quest asked first and reports the truth to the others,
 * rather than letting them sit at zero per cent in silence.
 */

interface StreamMetadata {
    id?: string;
    pid: number;
    sourceName: null;
}

const spoofed = new Map<string, StreamMetadata>();

let store: any = null;
let real: (() => any) | null = null;

/** The quest currently answering for the stream, or null when nothing is spoofing. */
export function getStreamHolder(): string | null {
    for (const questId of spoofed.keys()) return questId;
    return null;
}

function patch(target: any) {
    if (store) return;

    store = target;
    real = target.getStreamerActiveStreamMetadata;

    target.getStreamerActiveStreamMetadata = () => {
        const holder = getStreamHolder();
        // Falling through to the real one keeps the client honest if the pool ever empties while
        // still patched, rather than telling Discord there is no stream at all.
        return holder ? spoofed.get(holder) : real?.call(target);
    };
}

function unpatch() {
    if (!store) return;

    store.getStreamerActiveStreamMetadata = real;
    store = null;
    real = null;
}

/**
 * Registers a quest's spoofed stream. Returns whether this quest is the one Discord will be told
 * about; a false means another stream quest already holds it and this one cannot make progress.
 */
export function addSpoofedStream(target: any, questId: string, metadata: StreamMetadata): boolean {
    const holder = getStreamHolder();
    spoofed.set(questId, metadata);
    patch(target);

    return holder == null || holder === questId;
}

export function removeSpoofedStream(questId: string) {
    spoofed.delete(questId);
    // Hand the getter back only once nothing is being spoofed any more.
    if (spoofed.size === 0) unpatch();
}
