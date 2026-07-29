/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * What the plugin itself is doing, as opposed to what QuestsStore knows. Discord can tell us a
 * quest is enrolled but not that we gave up on it, so the panel reads both: QuestsStore for
 * enrolled/claimable, this for running progress and skip reasons.
 */

/**
 * "manual" is not a failure. Some quests can only be finished by the person playing, so they are
 * separated from things that actually broke; showing them in red taught you to ignore red.
 */
export type QuestRuntimeStatus = "running" | "skipped" | "manual";

export interface QuestRuntime {
    id: string;
    name: string;
    taskName?: string;
    status: QuestRuntimeStatus;
    value: number;
    target: number;
    /** Why we gave up. Surfaced in the panel so a failure is not console-only. */
    why?: string;
}

const runtime = new Map<string, QuestRuntime>();
const listeners = new Set<() => void>();

let panelOpen = false;

function emit() {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (err) {
            console.error("[QuestMaster] Panel listener failed:", err);
        }
    }
}

export function subscribeQuestState(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function setQuestRuntime(id: string, patch: Partial<QuestRuntime>) {
    const prev = runtime.get(id);
    const next: QuestRuntime = {
        id,
        name: patch.name ?? prev?.name ?? "Quest",
        taskName: patch.taskName ?? prev?.taskName,
        status: patch.status ?? prev?.status ?? "running",
        value: patch.value ?? prev?.value ?? 0,
        target: patch.target ?? prev?.target ?? 0,
        why: "why" in patch ? patch.why : prev?.why,
    };

    // Heartbeats land every ~30s and often repeat the same value, so only wake the panel when
    // something actually moved.
    if (prev
        && prev.name === next.name
        && prev.taskName === next.taskName
        && prev.status === next.status
        && prev.value === next.value
        && prev.target === next.target
        && prev.why === next.why) return;

    runtime.set(id, next);
    emit();
}

export function clearQuestRuntime(id: string) {
    if (runtime.delete(id)) emit();
}

export function clearAllQuestRuntime() {
    if (runtime.size === 0) return;
    runtime.clear();
    emit();
}

export function getQuestRuntime() {
    return runtime;
}

export function isPanelOpen() {
    return panelOpen;
}

export function setPanelOpen(open: boolean) {
    if (panelOpen === open) return;
    panelOpen = open;
    emit();
}

export function toggleQuestPanel() {
    setPanelOpen(!panelOpen);
}
