/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Must match the VERSION file at the repo root. The panel compares this baked-in value against
 * the VERSION file on main to tell you an update exists; if the two drift, the panel lies.
 * `_update-script.ps1` fails the build when they disagree.
 */
export const PLUGIN_VERSION = "1.2.0";
