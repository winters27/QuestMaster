/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./QuestPanel.css";

import { Button } from "@components/Button";
import { createRoot, NavigationRouter, ReactDOM, Tooltip, useEffect, useRef, useState } from "@webpack/common";

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
            {/* Manual rows say nothing per-row: the section explains it once, above them all. */}
            {(row.task || row.why || showBar) && tone !== "manual" && (
                <div className="qm-row-meta">
                    <span>{row.task ? TASK_LABELS[row.task] ?? row.task.toLowerCase() : ""}</span>
                    {row.why
                        ? <span className="qm-row-why">{row.why}</span>
                        : showBar && <span>{pct >= 100 ? "complete" : minsLeft ? `~${minsLeft} min left` : `${row.value}/${row.target}s`}</span>}
                </div>
            )}
        </div>
    );
}

/** Every Activity quest opens the same page, so this belongs to the section, not to each row. */
function OpenQuestPageButton() {
    return (
        <Button size="xs" variant="primary" className="qm-section-action" onClick={openQuestHome}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    fill="currentColor"
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M20.97 4.06c0 .18.08.35.24.43.55.28.9.82 1.04 1.42.3 1.24.75 3.7.75 7.09v4.91a3.09 3.09 0 0 1-5.85 1.38l-1.76-3.51a1.09 1.09 0 0 0-1.23-.55c-.57.13-1.36.27-2.16.27s-1.6-.14-2.16-.27c-.49-.11-1 .1-1.23.55l-1.76 3.51A3.09 3.09 0 0 1 1 17.91V13c0-3.38.46-5.85.75-7.1.15-.6.49-1.13 1.04-1.4a.47.47 0 0 0 .24-.44c0-.7.48-1.32 1.2-1.47l2.93-.62c.5-.1 1 .06 1.36.4.35.34.78.71 1.28.68a42.4 42.4 0 0 1 4.4 0c.5.03.93-.34 1.28-.69.35-.33.86-.5 1.36-.39l2.94.62c.7.15 1.19.78 1.19 1.47ZM20 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM15.5 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5 7a1 1 0 0 1 2 0v1h1a1 1 0 0 1 0 2H7v1a1 1 0 1 1-2 0v-1H4a1 1 0 1 1 0-2h1V7Z"
                />
            </svg>
            Open Quests page
        </Button>
    );
}

function Section({ title, rows, showBar, note, tone, action }: { title: string; rows: Row[]; showBar: boolean; note?: string; tone?: "manual"; action?: React.ReactNode; }) {
    if (!rows.length) return null;

    return (
        <>
            <div className="qm-section">
                {title}
                <span className="qm-section-count">{rows.length}</span>
            </div>
            {/* Explain the group before listing it, then offer the action once, after. */}
            {note && <div className="qm-section-note">{note}</div>}
            {rows.map(row => <QuestRow key={row.id} row={row} showBar={showBar} tone={tone} />)}
            {action}
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
                <span className="qm-panel-title">QuestMaster</span>
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
                                note="These run as an Activity inside Discord: the game loads in Discord's own window and progress only counts while you actually play, so there is nothing to automate."
                                action={<OpenQuestPageButton />}
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
const SLOT_ID = "qm-launcher-slot";

/**
 * Put a slot in Discord's title bar and keep it there.
 *
 * Discord's React owns that container and evicts children it did not create, so an injected node
 * survives only until the next re-render. The answer is not to avoid injecting; it is to re-inject
 * the instant it is removed, which a MutationObserver does and a polling interval does not. An
 * earlier 2s interval left the node detached between re-renders, which is why the button measured
 * 0x0 and vanished.
 *
 * Anchoring is off `aria-label="Inbox"` rather than a hashed class, since the label is stable
 * across builds while `trailing_c38106` is not. The slot then wears the Inbox button's own wrapper
 * classes, so Discord's CSS sizes and spaces it exactly like a native icon.
 */
function installSlot(): HTMLElement | null {
    const existing = document.getElementById(SLOT_ID);
    if (existing?.isConnected) return existing;

    const inbox = document.querySelector('[aria-label="Inbox"]');
    const container = inbox?.closest('[class*="trailing_"]')
        ?? document.querySelector('[class*="titleBar"] [class*="trailing_"]');

    if (!container) return null;

    const slot = document.createElement("div");
    slot.id = SLOT_ID;
    slot.style.position = "relative";

    const inboxWrapper = inbox?.closest('[class*="iconWrapper_"]');
    if (inboxWrapper) slot.className = inboxWrapper.className;

    // First child puts it at the left of the icon strip, clear of the window controls.
    container.insertBefore(slot, container.firstChild);
    return slot;
}

function QuestLauncher() {
    const [, forceUpdate] = useState(0);
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    const slotRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const rerender = () => forceUpdate(n => n + 1);
        QuestsStore.addChangeListener(rerender);
        const unsub = subscribeQuestState(rerender);
        return () => {
            QuestsStore.removeChangeListener(rerender);
            unsub();
        };
    }, []);

    useEffect(() => {
        // The observer fires on nearly every DOM change in Discord, so the hot path is one
        // isConnected check against a ref. Only a genuine eviction reaches setState.
        const install = () => {
            if (slotRef.current?.isConnected) return;

            const next = installSlot();
            if (next !== slotRef.current) {
                slotRef.current = next;
                setSlot(next);
            }
        };

        install();
        const observer = new MutationObserver(install);
        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            observer.disconnect();
            document.getElementById(SLOT_ID)?.remove();
        };
    }, []);

    if (!settings.store.showQuestLauncher) return null;

    const wantsTitleBar = (settings.store.questLauncherPosition ?? "toolbar") === "toolbar";
    const docked = wantsTitleBar && slot !== null;

    const { running, skipped, claimable } = buildRows(getQuestRuntime());

    const dotClass = skipped.length
        ? "qm-dot-stopped"
        : running.length
            ? "qm-dot-working"
            : claimable.length
                ? "qm-dot-ready"
                : "";

    const label = skipped.length
        ? `QuestMaster: ${skipped.length} skipped`
        : running.length
            ? `QuestMaster: working on ${running.length}`
            : claimable.length
                ? `QuestMaster: ${claimable.length} ready to claim`
                : "QuestMaster";

    const button = (
        <Tooltip text={`${label} (Ctrl+Shift+Q)`}>
            {({ onMouseEnter, onMouseLeave }) => (
                <button
                    className={`qm-launcher ${docked ? "qm-launcher-docked" : "qm-launcher-floating"}`}
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

    return docked ? ReactDOM.createPortal(button, slot!) : button;
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
