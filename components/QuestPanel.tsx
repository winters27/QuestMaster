/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./QuestPanel.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Switch } from "@components/Switch";
import { PluginNative } from "@utils/types";
import { createRoot, NavigationRouter, ReactDOM, useEffect, useRef, useState } from "@webpack/common";

import { clearSkipList, getSkippedIds, isPaused, pauseQuest, resumeQuest, retryAllFailed, retryQuest, runNow, setPaused, skipQuest, stopQuest, unskipQuest } from "../questOps";
import { getQuestRuntime, isPanelOpen, QuestRuntime, setPanelOpen, subscribeQuestState, toggleQuestPanel } from "../questState";
import settings from "../settings";
import { QuestsStore } from "../stores";
import { ChangelogEntry, parseChangelog } from "../utils/changelog";
import { devQuests } from "../utils/dev";
import { questArt, questOrbs } from "../utils/quest";
import { checkForUpdate, getUpdateState, REPO_URL, subscribeUpdateState } from "../utils/updateCheck";
import { PLUGIN_VERSION } from "../utils/version";
import { hideHint, Hint, PanelHintLayer } from "./PanelHint";

// Registered automatically from native.ts by the build, keyed on the plugin's name.
const Native = VencordNative.pluginHelpers.QuestMaster as PluginNative<typeof import("../native")>;

/**
 * Calls into the plugin's main-process half, and resolves to null instead of throwing when it
 * cannot.
 *
 * The native module is loaded once when Discord starts, so a rebuild that adds a function to it
 * leaves the running client with the old one. Optional chaining on the object is not enough: the
 * object is there, the function is not, and calling it throws a TypeError out of the effect that
 * called it. Check the function itself.
 */
async function callNative<K extends keyof typeof Native>(
    name: K,
    ...args: Parameters<(typeof Native)[K]>
): Promise<Awaited<ReturnType<(typeof Native)[K]>> | null> {
    const fn = Native?.[name];
    if (typeof fn !== "function") return null;

    try {
        return await (fn as any)(...args);
    } catch (err) {
        console.error(`[QuestMaster] Native call ${String(name)} failed:`, err);
        return null;
    }
}

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

/** Stands in for the game art when Discord ships none, so every row still has something to read. */
const TASK_PATHS: Record<string, string> = {
    PLAY_ON_DESKTOP: "M21 6H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1ZM8 13H6v2H4v-2H2v-2h2V9h2v2h2v2Zm7 2a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z",
    STREAM_ON_DESKTOP: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5l3 3H6l3-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm6 3.5v6l5-3-5-3Z",
    PLAY_ACTIVITY: "M12 2 9.2 8.8 2 9.6l5.4 4.7L5.8 22 12 18.3 18.2 22l-1.6-7.7L22 9.6l-7.2-.8L12 2Z",
    WATCH_VIDEO: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm6 3.5v9l7-4.5-7-4.5Z",
    WATCH_VIDEO_ON_MOBILE: "M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Zm3 19h4v-1h-4v1Zm0-16v10l6-5-6-5Z",
};

const ORB_PATH = "M12 2 21.5 12 12 22 2.5 12 12 2Z";

/** Discord's own art when it exists, the task glyph when it does not, nothing when neither fits. */
function RowTile({ row }: { row: Row; }) {
    const [artFailed, setArtFailed] = useState(false);

    if (row.art && !artFailed) {
        return <img className="qm-row-tile" src={row.art} alt="" onError={() => setArtFailed(true)} />;
    }

    const path = row.task ? TASK_PATHS[row.task] : undefined;

    return (
        <div className="qm-row-tile qm-row-tile-glyph">
            {path && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d={path} />
                </svg>
            )}
        </div>
    );
}

/** Which buttons a row offers. A row never shows an action that would do nothing. */
type RowAction = "pause" | "resume" | "stop" | "skip" | "run" | "retry" | "unskip";

interface Row {
    id: string;
    name: string;
    value: number;
    target: number;
    task?: string;
    why?: string;
    orbs: number;
    art: string | null;
    actions: RowAction[];
}

function isLive(quest: QuestValue) {
    return new Date(quest.config.expiresAt).getTime() > Date.now();
}

/**
 * QuestsStore knows what Discord thinks; the runtime map knows what we are doing. A quest we gave
 * up on still reads as "enrolled" to Discord, so runtime wins wherever the two disagree.
 */
function buildRows(runtime: Map<string, QuestRuntime>) {
    // Through the dev override too, or the panel would keep rendering Discord's real quests while
    // the engine ran against mock ones, which is half a testing hook.
    const quests = devQuests([...QuestsStore.quests.values()]).filter(isLive);

    const running: Row[] = [];
    const skipped: Row[] = [];
    const manual: Row[] = [];
    const queued: Row[] = [];
    const claimable: Row[] = [];

    let orbsClaimed = 0;
    let orbsPending = 0;

    // Read once rather than per quest: this runs on every render, and the skip list lives in a
    // settings string that has to be split apart each time it is asked for.
    const skippedIds = getSkippedIds();

    for (const quest of quests) {
        const name = quest.config.messages.questName ?? quest.id;
        const rt = runtime.get(quest.id);
        const orbs = questOrbs(quest);
        const base = { id: quest.id, name, orbs, art: questArt(quest) };

        if (quest.userStatus?.claimedAt) {
            orbsClaimed += orbs;
            continue;
        }

        if (rt?.status === "manual") {
            // Nothing to drive, so nothing to offer beyond the section's own link.
            manual.push({ ...base, task: rt.taskName, why: rt.why, value: rt.value, target: rt.target, actions: [] });
            continue;
        }
        if (rt?.status === "stopped" || (rt == null && skippedIds.has(quest.id))) {
            skipped.push({ ...base, task: rt?.taskName, why: rt?.why ?? "stopped by you", value: rt?.value ?? 0, target: rt?.target ?? 0, actions: ["unskip"] });
            continue;
        }
        if (rt?.status === "skipped") {
            skipped.push({ ...base, task: rt.taskName, why: rt.why ?? "skipped", value: rt.value, target: rt.target, actions: ["retry"] });
            continue;
        }
        if (rt?.status === "paused") {
            running.push({ ...base, task: rt.taskName, why: "paused", value: rt.value, target: rt.target, actions: ["resume", "stop"] });
            continue;
        }
        if (rt?.status === "running") {
            running.push({ ...base, task: rt.taskName, value: rt.value, target: rt.target, actions: ["pause", "stop"] });
            continue;
        }
        if (quest.userStatus?.completedAt) {
            orbsPending += orbs;
            claimable.push({ ...base, value: 1, target: 1, actions: [] });
            continue;
        }

        queued.push({ ...base, value: 0, target: 0, actions: ["run", "skip"] });
    }

    const pausedCount = running.filter(r => r.why === "paused").length;

    return { running, skipped, manual, queued, claimable, orbsClaimed, orbsPending, pausedCount };
}

const ACTION_LABELS: Record<RowAction, string> = {
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    skip: "Skip",
    run: "Run now",
    retry: "Retry",
    unskip: "Resume",
};

const ACTION_PATHS: Record<RowAction, string> = {
    pause: "M8 5h3v14H8V5Zm5 0h3v14h-3V5Z",
    resume: "M8 5v14l11-7L8 5Z",
    stop: "M7 7h10v10H7V7Z",
    skip: "M18.4 4.2 12 10.6 5.6 4.2 4.2 5.6 10.6 12l-6.4 6.4 1.4 1.4 6.4-6.4 6.4 6.4 1.4-1.4-6.4-6.4 6.4-6.4-1.4-1.4Z",
    run: "M8 5v14l11-7L8 5Z",
    retry: "M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z",
    unskip: "M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z",
};

function runAction(action: RowAction, questId: string) {
    switch (action) {
        case "pause": pauseQuest(questId); break;
        case "resume": resumeQuest(questId); break;
        case "stop": stopQuest(questId); break;
        case "skip": skipQuest(questId); break;
        case "run": runNow(questId); break;
        case "retry": retryQuest(questId); break;
        case "unskip": unskipQuest(questId); break;
    }
}

function RowActions({ row }: { row: Row; }) {
    if (!row.actions.length) return null;

    return (
        <div className="qm-row-actions">
            {row.actions.map(action => (
                <Hint key={action} text={ACTION_LABELS[action]}>
                    {hint => (
                        <button
                            className="qm-row-btn"
                            aria-label={ACTION_LABELS[action]}
                            {...hint}
                            onClick={() => runAction(action, row.id)}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d={ACTION_PATHS[action]} />
                            </svg>
                        </button>
                    )}
                </Hint>
            ))}
        </div>
    );
}

function QuestRow({ row, showBar, tone }: { row: Row; showBar: boolean; tone?: "manual"; }) {
    const pct = row.target > 0 ? Math.min(100, Math.round((row.value / row.target) * 100)) : 0;
    const minsLeft = row.target > row.value ? Math.ceil((row.target - row.value) / 60) : 0;
    const paused = row.why === "paused";

    const fillClass = pct >= 100
        ? " qm-fill-done"
        : paused
            ? " qm-fill-paused"
            : "";

    return (
        <div className="qm-row">
            <RowTile row={row} />
            <div className="qm-row-body">
                <div className="qm-row-head">
                    <div className="qm-row-name">{row.name}</div>
                    {row.orbs > 0 && (
                        <span className={`qm-row-orbs${row.actions.length ? " qm-row-orbs-yields" : ""}`}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d={ORB_PATH} />
                            </svg>
                            {row.orbs}
                        </span>
                    )}
                    <RowActions row={row} />
                </div>
                {showBar && (
                    <div className="qm-bar">
                        <div className={`qm-fill${fillClass}`} style={{ width: `${pct}%` }} />
                    </div>
                )}
                {/* Manual rows say nothing per-row: the section explains it once, above them all. */}
                {(row.task || row.why || showBar) && tone !== "manual" && (
                    <div className="qm-row-meta">
                        <span>{row.task ? TASK_LABELS[row.task] ?? row.task.toLowerCase() : ""}</span>
                        {row.why
                            ? <span className={`qm-row-why${paused ? " qm-row-why-paused" : ""}`}>{row.why}</span>
                            : showBar && <span>{pct >= 100 ? "complete" : minsLeft ? `~${minsLeft} min left` : `${row.value}/${row.target}s`}</span>}
                    </div>
                )}
            </div>
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
    const [canReveal, setCanReveal] = useState(false);

    // Only offer to show the file once the main process confirms it is actually there.
    useEffect(() => {
        let cancelled = false;

        void callNative("getUpdaterPath")
            .then(path => { if (!cancelled) setCanReveal(Boolean(path)); });

        return () => { cancelled = true; };
    }, []);

    if (update.status !== "available") return null;

    return (
        <div className="qm-update">
            <span className="qm-update-text">
                Update available: v{update.latest}. Run{" "}
                {canReveal
                    ? (
                        <a
                            className="qm-update-link"
                            onClick={() => void callNative("revealUpdater")}
                            title="Show it in Explorer"
                        >
                            Run Update.bat
                        </a>
                    )
                    : <b>Run Update.bat</b>}
                {" "}to install.
            </span>
            <a className="qm-update-link" href={REPO_URL} target="_blank" rel="noreferrer">Changes</a>
        </div>
    );
}

/**
 * What changed in the build you are running. Read off disk rather than fetched, so it describes
 * this build rather than whatever is newest in the repo, and works with no network at all.
 */
function useChangelog(open: boolean) {
    const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);

    useEffect(() => {
        if (!open || entries != null) return;
        let cancelled = false;

        void callNative("readChangelog")
            .then(raw => { if (!cancelled) setEntries(raw ? parseChangelog(raw) : []); });

        return () => { cancelled = true; };
    }, [open]);

    return entries;
}

/** True until the changelog has been opened on this version. */
function hasUnreadChangelog() {
    return settings.store.seenChangelogVersion !== PLUGIN_VERSION;
}

/** One switch and its explanation, the same shape whether it toggles a behaviour or a task type. */
function SettingRow({ label, note, setting }: { label: string; note: string; setting: keyof typeof settings.store; }) {
    const [, forceUpdate] = useState(0);
    const checked = settings.store[setting] !== false;

    return (
        <div className="qm-setting">
            <div className="qm-setting-text">
                <div className="qm-setting-label">{label}</div>
                <div className="qm-setting-note">{note}</div>
            </div>
            <Switch
                checked={checked}
                onChange={value => {
                    (settings.store as any)[setting] = value;
                    forceUpdate(n => n + 1);
                }}
            />
        </div>
    );
}

const BEHAVIOUR_SETTINGS: Array<[string, string, keyof typeof settings.store]> = [
    ["Accept quests", "Enrol in new quests as Discord posts them.", "acceptQuestsAutomatically"],
    ["Claim rewards", "Collect the reward once a quest finishes.", "autoClaimRewards"],
    ["Tell me when a reward is ready", "One toast per quest, not one per check.", "notifyOnClaimable"],
];

const TYPE_SETTINGS: Array<[string, string, keyof typeof settings.store]> = [
    ["Videos", "Trailer and video quests. Fully automatic.", "taskWatchVideo"],
    ["Mobile videos", "Mobile video quests. They finish from the desktop client.", "taskWatchVideoOnMobile"],
    ["Games", "Nothing is installed or launched; Discord is told the game is running.", "taskPlayOnDesktop"],
    ["Streams", "You still have to Go Live in a call with someone else.", "taskStreamOnDesktop"],
    ["Activities", "Heartbeats the activity without opening it.", "taskPlayActivity"],
];

function SettingsView({ onBack }: { onBack: () => void; }) {
    const [note, setNote] = useState<string | null>(null);

    return (
        <div className="qm-body">
            <div className="qm-section">
                Settings
                <button className="qm-link-btn" onClick={onBack}>Back</button>
            </div>

            {BEHAVIOUR_SETTINGS.map(([label, text, key]) => (
                <SettingRow key={key} label={label} note={text} setting={key} />
            ))}

            <div className="qm-section">Quest types</div>
            <div className="qm-section-note">A type switched off is neither accepted nor started.</div>
            {TYPE_SETTINGS.map(([label, text, key]) => (
                <SettingRow key={key} label={label} note={text} setting={key} />
            ))}

            <div className="qm-section">Maintenance</div>
            <div className="qm-actions">
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                        const n = retryAllFailed();
                        setNote(n ? `Retrying ${n} quest${n === 1 ? "" : "s"}.` : "Nothing had failed.");
                    }}
                >
                    Retry failed quests
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                        const n = clearSkipList();
                        setNote(n ? `Cleared ${n} skipped quest${n === 1 ? "" : "s"}.` : "The skip list was empty.");
                    }}
                >
                    Clear skip list
                </Button>
            </div>
            {note && <div className="qm-section-note">{note}</div>}

            <div className="qm-settings-foot">
                <span>v{PLUGIN_VERSION}</span>
                <button className="qm-link-btn" onClick={openQuestHome}>Open Quests page</button>
            </div>
        </div>
    );
}

function ChangelogView({ onBack }: { onBack: () => void; }) {
    const entries = useChangelog(true);

    return (
        <div className="qm-body">
            <div className="qm-section">
                What&apos;s new
                <button className="qm-link-btn" onClick={onBack}>Back</button>
            </div>
            {entries == null && <div className="qm-empty">Reading the changelog...</div>}
            {entries?.length === 0 && (
                <div className="qm-empty">
                    {typeof Native?.readChangelog === "function"
                        ? <>No changelog found next to the plugin.<br />It arrives with the next update.</>
                        : <>Restart Discord to read the changelog.<br />This part of the plugin only loads at startup, so reloading the window is not enough.</>}
                </div>
            )}
            {entries?.map(entry => (
                <div key={entry.version} className="qm-log-entry">
                    <div className="qm-log-head">
                        <b>v{entry.version}</b>
                        {entry.date && <span className="qm-log-date">{entry.date}</span>}
                        {entry.version === PLUGIN_VERSION && <span className="qm-log-current">installed</span>}
                    </div>
                    <ul className="qm-log-notes">
                        {entry.notes.map((note, i) => <li key={i}>{note}</li>)}
                    </ul>
                </div>
            ))}
        </div>
    );
}

/**
 * Where the panel sits, remembered across restarts.
 *
 * Dragging was left out in July because a position that resets on every reload is worse than one
 * you cannot move at all. The plugin has somewhere to put it now.
 */
function readPosition(): { left: number; top: number; } | null {
    const raw = settings.store.questPanelPosition ?? "";
    const [left, top] = raw.split(",").map(Number);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;

    // A window that shrank since last time would otherwise leave the panel off screen with no way
    // to drag it back.
    return {
        left: Math.min(Math.max(left, 0), Math.max(window.innerWidth - 120, 0)),
        top: Math.min(Math.max(top, 0), Math.max(window.innerHeight - 60, 0)),
    };
}

function usePanelDrag() {
    const [position, setPosition] = useState(readPosition);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const onHeaderMouseDown = (event: React.MouseEvent) => {
        // Only the header background drags. Starting a drag from a button would swallow its click.
        if ((event.target as HTMLElement).closest("button")) return;
        event.preventDefault();

        const rect = panelRef.current?.getBoundingClientRect();
        if (!rect) return;

        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;

        const onMove = (move: MouseEvent) => {
            setPosition({
                left: Math.min(Math.max(move.clientX - offsetX, 0), window.innerWidth - rect.width),
                top: Math.min(Math.max(move.clientY - offsetY, 0), window.innerHeight - rect.height),
            });
        };

        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);

            // Written once the drag ends rather than on every frame, since each write goes to disk.
            const settled = panelRef.current?.getBoundingClientRect();
            if (settled) settings.store.questPanelPosition = `${Math.round(settled.left)},${Math.round(settled.top)}`;
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    };

    return { position, panelRef, onHeaderMouseDown };
}

export function QuestPanel() {
    const [, forceUpdate] = useState(0);
    // One view at a time, so opening settings cannot leave the changelog underneath it.
    const [view, setView] = useState<"list" | "settings" | "changelog">("list");
    const { position, panelRef, onHeaderMouseDown } = usePanelDrag();

    useEffect(() => {
        const rerender = () => forceUpdate(n => n + 1);

        QuestsStore.addChangeListener(rerender);
        const unsubRuntime = subscribeQuestState(rerender);
        const unsubUpdate = subscribeUpdateState(rerender);

        // Esc closes, the way every other floating thing in Discord does. Capture, so a focused
        // control inside the panel cannot eat it first.
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || !isPanelOpen()) return;
            e.preventDefault();
            setPanelOpen(false);
        };
        document.addEventListener("keydown", onKey, true);

        return () => {
            QuestsStore.removeChangeListener(rerender);
            unsubRuntime();
            unsubUpdate();
            document.removeEventListener("keydown", onKey, true);
        };
    }, []);

    if (!isPanelOpen()) {
        hideHint();
        return null;
    }

    const { running, skipped, manual, queued, claimable, orbsClaimed, orbsPending, pausedCount } = buildRows(getQuestRuntime());
    const paused = isPaused();

    const dotClass = paused
        ? "qm-dot qm-dot-paused"
        : running.length
            ? "qm-dot qm-dot-working"
            : claimable.length
                ? "qm-dot qm-dot-ready"
                : skipped.length
                    ? "qm-dot qm-dot-stopped"
                    : "qm-dot";

    // The dot carried this on hover, which meant the panel could be open and still not say what it
    // was doing. It says it out loud now, and the dot is only the colour of it.
    const dotLabel = paused
        ? "paused"
        : running.length
            ? `working on ${running.length}${pausedCount ? ` (${pausedCount} paused)` : ""}`
            : claimable.length
                ? `${claimable.length} ready to claim`
                : skipped.length
                    ? `idle, ${skipped.length} skipped`
                    : "idle";

    const stats: Array<[string, number, string]> = [
        ["running", running.length, ""],
        ["queued", queued.length, ""],
        ["to claim", claimable.length, "qm-stat-ready"],
        ["orbs won", orbsClaimed, "qm-stat-orbs"],
    ];

    const nothingToShow = !running.length && !skipped.length && !manual.length && !queued.length && !claimable.length;

    return (
        <div
            className="qm-panel"
            ref={panelRef}
            style={position ? { left: `${position.left}px`, top: `${position.top}px`, right: "auto", bottom: "auto" } : undefined}
        >
            <div className="qm-panel-header" onMouseDown={onHeaderMouseDown}>
                <Hint text={dotLabel}>
                    {hint => (
                        <span className={dotClass} {...hint} />
                    )}
                </Hint>
                <span className="qm-panel-title">QuestMaster</span>
                <span className={`qm-panel-status${paused ? " qm-panel-status-paused" : ""}`}>{dotLabel}</span>

                <Hint text={paused ? "Resume everything" : "Pause everything"}>
                    {hint => (
                        <button
                            className={`qm-icon-btn${paused ? " qm-icon-btn-on" : ""}`}
                            aria-label={paused ? "Resume everything" : "Pause everything"}
                            {...hint}
                            onClick={() => { setPaused(!paused); forceUpdate(n => n + 1); }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d={paused ? "M8 5v14l11-7L8 5Z" : "M8 5h3v14H8V5Zm5 0h3v14h-3V5Z"} />
                            </svg>
                        </button>
                    )}
                </Hint>

                <Hint text="What's new">
                    {hint => (
                        <button
                            className="qm-icon-btn"
                            aria-label="What's new"
                            {...hint}
                            onClick={() => {
                                settings.store.seenChangelogVersion = PLUGIN_VERSION;
                                setView(v => v === "changelog" ? "list" : "changelog");
                            }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM8 12h8v2H8v-2Zm0 4h8v2H8v-2Z" />
                            </svg>
                            {hasUnreadChangelog() && <span className="qm-icon-badge" />}
                        </button>
                    )}
                </Hint>

                <Hint text="Settings">
                    {hint => (
                        <button
                            className={`qm-icon-btn${view === "settings" ? " qm-icon-btn-on" : ""}`}
                            aria-label="Settings"
                            {...hint}
                            onClick={() => setView(v => v === "settings" ? "list" : "settings")}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm9.4-2c0-.5 0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2.5-1.5L16 2H8l-.4 2.5c-.9.3-1.7.8-2.5 1.5l-2.4-1-2 3.5 2 1.5a9 9 0 0 0 0 3l-2 1.5 2 3.5 2.4-1c.8.7 1.6 1.2 2.5 1.5L8 22h8l.4-2.5c.9-.3 1.7-.8 2.5-1.5l2.4 1 2-3.5-2-1.5c.1-.5.1-1 .1-1.5Z" />
                            </svg>
                        </button>
                    )}
                </Hint>

                <Hint text="Check for updates">
                    {hint => (
                        <button
                            className="qm-icon-btn"
                            {...hint}
                            onClick={() => checkForUpdate(true)}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" />
                            </svg>
                        </button>
                    )}
                </Hint>

                <Hint text="Open Discord's quest page">
                    {hint => (
                        <button
                            className="qm-icon-btn"
                            {...hint}
                            onClick={openQuestHome}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M14 3v2h3.6l-9.3 9.3 1.4 1.4L19 6.4V10h2V3h-7Z M19 19H5V5h5V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-2v5Z" />
                            </svg>
                        </button>
                    )}
                </Hint>

                <Hint text="Close">
                    {hint => (
                        <button
                            className="qm-icon-btn"
                            {...hint}
                            onClick={() => setPanelOpen(false)}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18.4 4.2 12 10.6 5.6 4.2 4.2 5.6 10.6 12l-6.4 6.4 1.4 1.4 6.4-6.4 6.4 6.4 1.4-1.4-6.4-6.4 6.4-6.4-1.4-1.4Z" />
                            </svg>
                        </button>
                    )}
                </Hint>
            </div>

            <UpdateNotice />

            {view === "list" && <div className="qm-stats">
                {stats.map(([label, value, cls]) => (
                    <div key={label} className={`qm-stat${value ? "" : " qm-stat-zero"}${value && cls ? ` ${cls}` : ""}`}>
                        <b>{value}</b>
                        <span>{label}</span>
                    </div>
                ))}
            </div>}

            {view === "settings" && <SettingsView onBack={() => setView("list")} />}
            {view === "changelog" && <ChangelogView onBack={() => setView("list")} />}

            {view === "list" && <div className="qm-body">
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
            </div>}

            {view === "list" && orbsPending > 0 && (
                <div className="qm-footer">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d={ORB_PATH} />
                    </svg>
                    {orbsPending} orbs waiting, claim them in Discover
                </div>
            )}
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
 * Where in Discord's title bar the button goes, and which of Discord's own classes to wear.
 *
 * The obvious anchor is the Inbox button, but `aria-label="Inbox"` only matches while Discord is
 * in English: the label is translated, so on any other language that lookup finds nothing. So it
 * is the first thing tried and never the only thing, and each fallback still reports a wrapper
 * class, because a slot with no class loses Discord's sizing and spacing and looks wrong even
 * when it lands in the right place.
 */
function findAnchor(): { container: Element; wrapperClass: string; } | null {
    // 1. The Inbox button itself, when it happens to carry the English label. Cheapest and exact.
    const inbox = document.querySelector('[aria-label="Inbox"]');
    const byLabel = inbox?.closest('[class*="trailing_"]');
    if (byLabel) {
        return { container: byLabel, wrapperClass: inbox!.closest('[class*="iconWrapper_"]')?.className ?? "" };
    }

    // 2. Any title-bar group that holds icon wrappers, whatever those icons are called here.
    for (const container of document.querySelectorAll('[class*="trailing_"]')) {
        const wrapper = container.querySelector(':scope > [class*="iconWrapper_"]');
        if (wrapper) return { container, wrapperClass: wrapper.className };
    }

    // 3. Any title-bar group at all. No class to borrow, so the slot styles itself.
    const bare = document.querySelector('[class*="titleBar"] [class*="trailing_"]');
    return bare ? { container: bare, wrapperClass: "" } : null;
}

/**
 * Put a slot in Discord's title bar and keep it there.
 *
 * Discord's React owns that container and evicts children it did not create, so an injected node
 * survives only until the next re-render. The answer is not to avoid injecting; it is to re-inject
 * the instant it is removed, which a MutationObserver does and a polling interval does not. An
 * earlier 2s interval left the node detached between re-renders, which is why the button measured
 * 0x0 and vanished.
 */
function installSlot(): HTMLElement | null {
    const existing = document.getElementById(SLOT_ID);
    if (existing?.isConnected) return existing;

    const anchor = findAnchor();
    if (!anchor) return null;

    const slot = document.createElement("div");
    slot.id = SLOT_ID;
    slot.style.position = "relative";
    if (anchor.wrapperClass) slot.className = anchor.wrapperClass;
    else slot.classList.add("qm-slot-bare");

    // First child puts it at the left of the icon strip, clear of the window controls.
    anchor.container.insertBefore(slot, anchor.container.firstChild);
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

    const { running, queued, claimable } = buildRows(getQuestRuntime());
    const paused = isPaused();
    const outstanding = running.length + queued.length;

    /**
     * A count rather than a coloured dot, because the dot could say "something is happening" and
     * never how much. Rewards win over work: a finished quest wants you, a running one does not.
     */
    const badge = claimable.length
        ? { kind: "claim", text: `${claimable.length > 99 ? "99+" : claimable.length}`, label: `${claimable.length} ready to claim` }
        : paused && outstanding
            ? { kind: "hold", text: "", label: "paused" }
            : outstanding
                ? { kind: "work", text: `${outstanding > 99 ? "99+" : outstanding}`, label: `${outstanding} quest${outstanding === 1 ? "" : "s"} outstanding` }
                : null;

    const label = badge ? `QuestMaster: ${badge.label}` : "QuestMaster";

    const button = (
        <Hint text={`${label} (Ctrl+Shift+Q)`}>
            {hint => (
                <button
                    className={`qm-launcher ${docked ? "qm-launcher-docked" : "qm-launcher-floating"}`}
                    {...hint}
                    onClick={toggleQuestPanel}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.4-4.2-4.2 1.7-1.7 2.5 2.5 5.4-5.4 1.7 1.7-7.1 7.1Z" />
                    </svg>
                    {badge && (
                        <span className={`qm-launcher-badge qm-badge-${badge.kind}`}>
                            {badge.kind === "hold"
                                ? (
                                    <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M8 5h3v14H8V5Zm5 0h3v14h-3V5Z" />
                                    </svg>
                                )
                                : badge.text}
                        </span>
                    )}
                </button>
            )}
        </Hint>
    );

    return docked ? ReactDOM.createPortal(button, slot!) : button;
}

/**
 * The launcher and the panel share a root, so they must not share a fate.
 *
 * Without a boundary between them, anything that throws inside the panel unmounts the whole root,
 * and the launcher's cleanup then pulls its slot out of Discord's title bar on the way down. The
 * way back in disappears at exactly the moment something has gone wrong. Each half is bounded
 * separately so the other survives.
 */
function QuestPanelRoot() {
    return (
        <>
            <ErrorBoundary noop>
                <QuestLauncher />
            </ErrorBoundary>
            <ErrorBoundary noop>
                <QuestPanel />
            </ErrorBoundary>
            <ErrorBoundary noop>
                <PanelHintLayer />
            </ErrorBoundary>
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
