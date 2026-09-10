/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Reads CHANGELOG.md into something the panel can render.
 *
 * The format is deliberately narrow: one `## <version> - <date>` heading per release with `-`
 * bullets under it. Anything else in the file is ignored rather than half-rendered, so an entry
 * written the wrong way goes missing instead of showing markup to the reader.
 */

export interface ChangelogEntry {
    version: string;
    date?: string;
    notes: string[];
}

const HEADING = /^##\s+([0-9]+(?:\.[0-9]+)*)\s*(?:[-–]\s*(.+))?$/;

/** Strips the inline markdown the panel does not render, rather than printing the asterisks. */
function plain(text: string) {
    return text
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .trim();
}

export function parseChangelog(raw: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];
    let current: ChangelogEntry | null = null;

    for (const line of raw.split(/\r?\n/)) {
        const heading = HEADING.exec(line.trim());
        if (heading) {
            current = { version: heading[1], date: heading[2]?.trim(), notes: [] };
            entries.push(current);
            continue;
        }

        if (!current) continue;

        const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
        if (bullet) {
            const note = plain(bullet[1]);
            if (note) current.notes.push(note);
        }
    }

    return entries.filter(entry => entry.notes.length > 0);
}
