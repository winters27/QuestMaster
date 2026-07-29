/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PLUGIN_VERSION } from "./version";

/**
 * Tells you an update exists. It deliberately cannot install one.
 *
 * Fetching code from a branch head and running it would hand whoever controls the repo a way to
 * run anything on this machine at any time. So this reads one plain-text version number and
 * nothing else; updating stays a thing you start yourself by running Run Update.bat, which
 * builds from source you can read first.
 */

export const REPO_URL = "https://github.com/winters27/QuestMaster";
const VERSION_URL = "https://raw.githubusercontent.com/winters27/QuestMaster/main/VERSION";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "failed";

export interface UpdateState {
    status: UpdateStatus;
    latest?: string;
    error?: string;
}

let state: UpdateState = { status: "idle" };
let lastCheckedAt = 0;

const listeners = new Set<() => void>();

export function subscribeUpdateState(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getUpdateState(): UpdateState {
    return state;
}

function setState(next: UpdateState) {
    state = next;
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (err) {
            console.error("[QuestMaster] Update listener failed:", err);
        }
    }
}

/** Compares dotted numeric versions. Returns true when remote is genuinely ahead of local. */
function isNewer(remote: string, local: string) {
    const a = remote.split(".").map(n => parseInt(n, 10) || 0);
    const b = local.split(".").map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff > 0;
    }
    return false;
}

export async function checkForUpdate(force = false) {
    if (state.status === "checking") return;
    if (!force && lastCheckedAt && Date.now() - lastCheckedAt < CHECK_INTERVAL_MS) return;

    lastCheckedAt = Date.now();
    setState({ ...state, status: "checking" });

    try {
        const res = await fetch(VERSION_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const latest = (await res.text()).trim();
        // A rewritten or missing file would otherwise show up as a bogus "update available".
        if (!/^\d+(\.\d+)*$/.test(latest)) throw new Error("VERSION did not look like a version number");

        setState({ status: isNewer(latest, PLUGIN_VERSION) ? "available" : "current", latest });
    } catch (err: any) {
        setState({ status: "failed", error: err?.message ?? String(err) });
    }
}
