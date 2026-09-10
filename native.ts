/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Main-process side. The renderer cannot touch the filesystem or open Explorer, so revealing the
 * updater has to happen here.
 *
 * Nothing is assumed about where the plugin lives: the path is searched for and then checked, and
 * a path that does not exist is reported as null so the UI can hide the link rather than offer a
 * button that does nothing.
 */

import { IpcMainInvokeEvent, shell } from "electron";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";

const UPDATER_NAME = "Run Update.bat";
const CHANGELOG_NAME = "CHANGELOG.md";
const PLUGIN_PATH = join("src", "userplugins", "questMaster");

function findPluginFile(name: string): string | null {
    // Natives are bundled into Vencord's main-process bundle, so __dirname sits somewhere inside
    // the Vencord checkout. Walk up rather than hardcoding a depth, since that depends on how the
    // bundle happens to be laid out.
    let dir = __dirname;

    for (let i = 0; i < 6; i++) {
        const candidate = join(dir, PLUGIN_PATH, name);
        if (existsSync(candidate)) return candidate;

        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return null;
}

function findUpdater(): string | null {
    return findPluginFile(UPDATER_NAME);
}

/** Null when the updater cannot be found, which is the signal to hide the link entirely. */
export async function getUpdaterPath(_: IpcMainInvokeEvent): Promise<string | null> {
    return findUpdater();
}

/** Opens Explorer with the .bat selected. Deliberately does not run it: closing Discord first is
 *  part of the job, and a plugin should not kill the client out from under you. */
export async function revealUpdater(_: IpcMainInvokeEvent): Promise<boolean> {
    const path = findUpdater();
    if (!path) return false;

    shell.showItemInFolder(path);
    return true;
}

/**
 * The changelog for the build that is actually installed, read off disk rather than fetched.
 *
 * Fetching it from the repo would describe whatever is newest there, which is not what you are
 * running, and would lag behind a push by however long the CDN caches. The file next to the
 * updater is the one that came with this build.
 */
export async function readChangelog(_: IpcMainInvokeEvent): Promise<string | null> {
    const path = findPluginFile(CHANGELOG_NAME);
    if (!path) return null;

    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

/**
 * The two requests the achievement bypass makes to an activity's own backend.
 *
 * Discord's renderer forbids `connect-src` to `*.discordsays.com`, so these cannot be sent from
 * the plugin's UI half at all. They run here instead, where that policy does not apply.
 *
 * Three deliberate restrictions, because this is the one part of the plugin that talks to a host
 * outside Discord while carrying an authorization:
 *
 * - The caller passes an application id, never a URL. The address is built here, so nothing the
 *   renderer sends can point these requests somewhere else.
 * - That id must be digits. It is interpolated into a hostname, and a malformed one would move the
 *   request to another host entirely.
 * - Redirects are refused rather than followed, so a 3xx cannot carry the auth token or the proxy
 *   ticket in the referrer off to somewhere that was never authorized.
 */

const APP_ID = /^\d+$/;

export interface DiscordSaysResponse {
    ok: boolean;
    status: number;
    body: string;
}

async function postToActivity(appId: string, path: string, headers: Record<string, string>, body: string): Promise<DiscordSaysResponse> {
    if (!APP_ID.test(appId)) {
        throw new Error(`Refusing a non-numeric application id: ${appId}`);
    }

    const res = await fetch(`https://${appId}.discordsays.com/.proxy/acf/${path}`, {
        method: "POST",
        headers,
        body,
        redirect: "error",
    });

    return { ok: res.ok, status: res.status, body: await res.text() };
}

export async function discordSaysAuthorize(
    _: IpcMainInvokeEvent,
    opts: { appId: string; questId: string; authCode: string; referrer: string; },
): Promise<DiscordSaysResponse> {
    return postToActivity(opts.appId, "authorize", {
        "Content-Type": "application/json",
        "X-Auth-Token": "",
        "X-Discord-Quest-ID": opts.questId,
        Referer: opts.referrer,
    }, JSON.stringify({ code: opts.authCode }));
}

export async function discordSaysProgress(
    _: IpcMainInvokeEvent,
    opts: { appId: string; questId: string; token: string; target: number; referrer: string; },
): Promise<DiscordSaysResponse> {
    return postToActivity(opts.appId, "quest/progress", {
        "Content-Type": "application/json",
        "X-Auth-Token": opts.token,
        "X-Discord-Quest-ID": opts.questId,
        Referer: opts.referrer,
    }, JSON.stringify({ progress: opts.target }));
}
