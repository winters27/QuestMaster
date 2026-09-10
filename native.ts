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
