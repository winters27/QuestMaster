/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./QuestPanel.css";

import { createRoot, NavigationRouter, ReactDOM, Tooltip, useEffect, useState } from "@webpack/common";

import { getQuestRuntime, isPanelOpen, QuestRuntime, setPanelOpen, subscribeQuestState, toggleQuestPanel } from "../questState";
import settings from "../settings";
import { QuestsStore } from "../stores";
import { checkForUpdate, getUpdateState, REPO_URL, subscribeUpdateState } from "../utils/updateCheck";
import { PLUGIN_VERSION } from "../utils/version";

// navigateToQuestHome no longer exists on current builds. The route itself is stable, so go
// through the router rather than depending on that helper being found.
function openQuestHome() {
    try {
        NavigationRouter.transitionTo("/quest-home");
    } catch (err) {
        console.error("[QuestMaster] Could not open Discord's quest page:", err);
    }
}

const TASK_LABELS: Record<string, string> = {
    PLAY_ON_DESKTOP: "play",
    STREAM_ON_DESKTOP: "stream",
    PLAY_ACTIVITY: "activity",
    WATCH_VIDEO: "watch",
    WATCH_VIDEO_ON_MOBILE: "watch",
};

interface Row {
    id: string;
    name: string;
    value: number;
    target: number;
    task?: string;
    why?: string;
}

function isLive(quest: QuestValue) {
    return new Date(quest.config.expiresAt).getTime() > Date.now();
}

/**
 * QuestsStore knows what Discord thinks; the runtime map knows what we are doing. A quest we gave
 * up on still reads as "enrolled" to Discord, so runtime wins wherever the two disagree.
 */
function buildRows(runtime: Map<string, QuestRuntime>) {
    const quests = [...QuestsStore.quests.values()].filter(isLive);

    const running: Row[] = [];
    const skipped: Row[] = [];
    const manual: Row[] = [];
    const queued: Row[] = [];
    const claimable: Row[] = [];

    for (const quest of quests) {
        const name = quest.config.messages.questName ?? quest.id;
        const rt = runtime.get(quest.id);

        if (rt?.status === "manual") {
            manual.push({ id: quest.id, name, task: rt.taskName, why: rt.why, value: rt.value, target: rt.target });
            continue;
        }
        if (rt?.status === "skipped") {
            skipped.push({ id: quest.id, name, task: rt.taskName, why: rt.why ?? "skipped", value: rt.value, target: rt.target });
            continue;
        }
        if (rt?.status === "running") {
            running.push({ id: quest.id, name, task: rt.taskName, value: rt.value, target: rt.target });
            continue;
        }
        if (quest.userStatus?.completedAt && !quest.userStatus?.claimedAt) {
            claimable.push({ id: quest.id, name, value: 1, target: 1 });
            continue;
        }
        if (!quest.userStatus?.claimedAt) {
            queued.push({ id: quest.id, name, value: 0, target: 0 });
        }
    }

    return { running, skipped, manual, queued, claimable };
}

function QuestRow({ row, showBar, tone }: { row: Row; showBar: boolean; tone?: "manual"; }) {
    const pct = row.target > 0 ? Math.min(100, Math.round((row.value / row.target) * 100)) : 0;
    const minsLeft = row.target > row.value ? Math.ceil((row.target - row.value) / 60) : 0;

    return (
        <div className="qm-row">
            <div className="qm-row-name">{row.name}</div>
            {showBar && (
                <div className="qm-bar">
                    <div className={`qm-fill${pct >= 100 ? " qm-fill-done" : ""}`} style={{ width: `${pct}%` }} />
                </div>
            )}
            {(row.task || row.why || showBar) && (
                <div className="qm-row-meta">
                    <span>{row.task ? TASK_LABELS[row.task] ?? row.task.toLowerCase() : ""}</span>
                    {row.why
                        ? <span className={tone === "manual" ? "qm-row-note" : "qm-row-why"}>{row.why}</span>
                        : showBar && <span>{pct >= 100 ? "complete" : minsLeft ? `~${minsLeft} min left` : `${row.value}/${row.target}s`}</span>}
                </div>
            )}
        </div>
    );
}

function Section({ title, rows, showBar, note, tone }: { title: string; rows: Row[]; showBar: boolean; note?: string; tone?: "manual"; }) {
    if (!rows.length) return null;

    return (
        <>
            <div className="qm-section">
                {title}
                <span className="qm-section-count">{rows.length}</span>
            </div>
            {note && <div className="qm-section-note">{note}</div>}
            {rows.map(row => <QuestRow key={row.id} row={row} showBar={showBar} tone={tone} />)}
        </>
    );
}

function UpdateNotice() {
    const update = getUpdateState();
    if (update.status !== "available") return null;

    return (
        <div className="qm-update">
            <span className="qm-update-text">
                Update available: v{update.latest}. Run <b>Run Update.bat</b> to install.
            </span>
            <a className="qm-update-link" href={REPO_URL} target="_blank" rel="noreferrer">Changes</a>
        </div>
    );
}

export function QuestPanel() {
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const rerender = () => forceUpdate(n => n + 1);

        QuestsStore.addChangeListener(rerender);
        const unsubRuntime = subscribeQuestState(rerender);
        const unsubUpdate = subscribeUpdateState(rerender);

        return () => {
            QuestsStore.removeChangeListener(rerender);
            unsubRuntime();
            unsubUpdate();
        };
    }, []);

    if (!isPanelOpen()) return null;

    const { running, skipped, manual, queued, claimable } = buildRows(getQuestRuntime());

    const dotClass = skipped.length
        ? "qm-dot qm-dot-stopped"
        : running.length
            ? "qm-dot qm-dot-working"
            : claimable.length
                ? "qm-dot qm-dot-ready"
                : "qm-dot";
    const dotLabel = skipped.length
        ? `${skipped.length} skipped`
        : running.length
            ? `working on ${running.length}`
            : claimable.length
                ? `${claimable.length} ready to claim`
                : "idle";

    const stats: Array<[string, number, string]> = [
        ["running", running.length, ""],
        ["queued", queued.length, ""],
        ["to claim", claimable.length, "qm-stat-ready"],
        ["play these", manual.length, ""],
    ];

    const nothingToShow = !running.length && !skipped.length && !manual.length && !queued.length && !claimable.length;

    return (
        <div className="qm-panel">
            <div className="qm-panel-header">
                <Tooltip text={dotLabel}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <span className={dotClass} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
                    )}
                </Tooltip>
                <span className="qm-panel-title">Auto Quests</span>
                <span className="qm-panel-version">v{PLUGIN_VERSION}</span>

                <Tooltip text="Check for updates">
                    {({ onMouseEnter, onMouseLeave }) => (
                        <button
                            className="qm-icon-btn"
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            onClick={() => checkForUpdate(true)}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" />
                            </svg>
                        </button>
                    )}
                </Tooltip>

                <Tooltip text="Open Discord's quest page">
                    {({ onMouseEnter, onMouseLeave }) => (
                        <button
                            className="qm-icon-btn"
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            onClick={openQuestHome}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M14 3v2h3.6l-9.3 9.3 1.4 1.4L19 6.4V10h2V3h-7Z M19 19H5V5h5V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-2v5Z" />
                            </svg>
                        </button>
                    )}
                </Tooltip>

                <Tooltip text="Close">
                    {({ onMouseEnter, onMouseLeave }) => (
                        <button
                            className="qm-icon-btn"
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            onClick={() => setPanelOpen(false)}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18.4 4.2 12 10.6 5.6 4.2 4.2 5.6 10.6 12l-6.4 6.4 1.4 1.4 6.4-6.4 6.4 6.4 1.4-1.4-6.4-6.4 6.4-6.4-1.4-1.4Z" />
                            </svg>
                        </button>
                    )}
                </Tooltip>
            </div>

            <UpdateNotice />

            <div className="qm-stats">
                {stats.map(([label, value, cls]) => (
                    <div key={label} className={`qm-stat${value ? "" : " qm-stat-zero"}${value && cls ? ` ${cls}` : ""}`}>
                        <b>{value}</b>
                        <span>{label}</span>
                    </div>
                ))}
            </div>

            <div className="qm-body">
                {nothingToShow
                    ? <div className="qm-empty">Nothing to do right now.<br />Waiting for Discord to post new quests.</div>
                    : (
                        <>
                            <Section title="Ready to claim" rows={claimable} showBar={false} />
                            <Section title="Running now" rows={running} showBar={true} />
                            <Section
                                title="Play these yourself"
                                rows={manual}
                                showBar={false}
                                tone="manual"
                                note="These run as an Activity inside Discord. Open the quest, hit Play, and the game loads in Discord's own window. Progress only counts while you are actually playing, so there is nothing to automate here."
                            />
                            <Section title="Skipped" rows={skipped} showBar={false} />
                            <Section title="Queued" rows={queued} showBar={false} />
                        </>
                    )}
            </div>
        </div>
    );
}

/**
 * Our own way in. Discord's title-bar injection depends on an element path that has since moved,
 * and its badge and settings-bar components no longer resolve at all, so the plugin cannot rely on
 * borrowing Discord's UI to stay reachable. This button is ours end to end.
 */
const SLOT_ID = "qm-toolbar-slot";

/**
 * Anchor to the window controls and sit immediately before them. `winButtons` is the one title-bar
 * element confirmed present on this build, and being a flex sibling of Discord's own icons means
 * it lays us out, so we cannot land on top of anything the way a fixed offset did.
 *
 * Returns a slot element we own; React portals into that rather than into Discord's node directly,
 * so React never manages children it did not create.
 */
function ensureToolbarSlot(): HTMLElement | null {
    const winButtons = document.querySelector('[class*="winButtons"]');
    const parent = winButtons?.parentElement;

    if (!parent) {
        // Fall back to the icon strip itself. The top check rejects the chat toolbar, which
        // matches the same class pattern further down the page.
        for (const selector of ['[class*="titleBar"] [class*="toolbar"]', '[class*="toolbar_"]']) {
            const el = document.querySelector<HTMLElement>(selector);
            if (el && el.getBoundingClientRect().top < 60) return el;
        }
        return null;
    }

    let slot = document.getElementById(SLOT_ID);
    if (!slot) {
        slot = document.createElement("div");
        slot.id = SLOT_ID;
    }

    // Discord rebuilds the title bar on navigation, so re-seat the slot whenever it drifts.
    if (slot.parentElement !== parent || slot.nextSibling !== winButtons) {
        parent.insertBefore(slot, winButtons);
    }
    return slot;
}

function QuestLauncher() {
    const [, forceUpdate] = useState(0);
    const [toolbar, setToolbar] = useState<HTMLElement | null>(null);

    useEffect(() => {
        const rerender = () => forceUpdate(n => n + 1);
        QuestsStore.addChangeListener(rerender);
        const unsub = subscribeQuestState(rerender);
        return () => {
            QuestsStore.removeChangeListener(rerender);
            unsub();
        };
    }, []);

    // Discord rebuilds the title bar on navigation, so re-check rather than resolving once.
    useEffect(() => {
        const check = () => setToolbar(prev => {
            const next = ensureToolbarSlot();
            return next === prev ? prev : next;
        });
        check();
        const id = setInterval(check, 2000);
        return () => {
            clearInterval(id);
            document.getElementById(SLOT_ID)?.remove();
        };
    }, []);

    if (!settings.store.showQuestLauncher) return null;

    const { running, skipped, claimable } = buildRows(getQuestRuntime());
    const wantsToolbar = (settings.store.questLauncherPosition ?? "toolbar") === "toolbar";
    // Falling back to floating is the point: never overlap, even when the toolbar cannot be found.
    const inToolbar = wantsToolbar && toolbar !== null;

    const dotClass = skipped.length
        ? "qm-dot-stopped"
        : running.length
            ? "qm-dot-working"
            : claimable.length
                ? "qm-dot-ready"
                : "";

    const label = skipped.length
        ? `Auto Quests: ${skipped.length} skipped`
        : running.length
            ? `Auto Quests: working on ${running.length}`
            : claimable.length
                ? `Auto Quests: ${claimable.length} ready to claim`
                : "Auto Quests";

    const button = (
        <Tooltip text={`${label} (Ctrl+Shift+Q)`}>
            {({ onMouseEnter, onMouseLeave }) => (
                <button
                    className={`qm-launcher ${inToolbar ? "qm-launcher-inline" : "qm-launcher-floating"}`}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    onClick={toggleQuestPanel}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.4-4.2-4.2 1.7-1.7 2.5 2.5 5.4-5.4 1.7 1.7-7.1 7.1Z" />
                    </svg>
                    {dotClass && <span className={`qm-launcher-dot ${dotClass}`} />}
                </button>
            )}
        </Tooltip>
    );

    return inToolbar ? ReactDOM.createPortal(button, toolbar!) : button;
}

function QuestPanelRoot() {
    return (
        <>
            <QuestLauncher />
            <QuestPanel />
        </>
    );
}

/**
 * The panel owns its own React root in the body rather than rendering alongside the quest button.
 * Mounting it next to the button meant anything that broke the button, such as a webpack finder
 * going stale after a Discord update, discarded the whole subtree and took the panel with it. This
 * way the panel survives the rest of the UI breaking, which is exactly when it is most useful.
 */
let panelRoot: ReturnType<typeof createRoot> | null = null;
let panelContainer: HTMLElement | null = null;

export function mountQuestPanel() {
    if (panelContainer) return;

    panelContainer = document.createElement("div");
    panelContainer.id = "qm-panel-root";
    document.body.appendChild(panelContainer);

    panelRoot = createRoot(panelContainer);
    panelRoot.render(<QuestPanelRoot />);
}

export function unmountQuestPanel() {
    const root = panelRoot;
    const container = panelContainer;
    panelRoot = null;
    panelContainer = null;

    // Deferred: React warns when a root is unmounted while it is mid-render, and plugin stop()
    // can land inside one.
    setTimeout(() => {
        try {
            root?.unmount();
        } catch (err) {
            console.error("[QuestMaster] Failed to unmount panel:", err);
        }
        container?.remove();
    }, 0);
}
