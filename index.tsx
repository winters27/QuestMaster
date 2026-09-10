/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { FluxDispatcher, RestAPI, showToast, Toasts } from "@webpack/common";

import { QuestButton, QuestsCount } from "./components/QuestButton";
import { mountQuestPanel, unmountQuestPanel } from "./components/QuestPanel";
import { questHandlers } from "./handlers";
import { bypassCaptcha, cleanupCaptchaMonitor, clearTokenCache, detectCaptchaChallenge, hasSolverService, noticeManualCaptcha, patchRequestWithCaptchaBypass, setupCaptchaMonitor, startTokenCacheCleanup, stopTokenCacheCleanup } from "./handlers/captcha";
import { getSkippedIds, isPaused, registerQuestRunner, resetOps, trackQuest, untrackQuest } from "./questOps";
import { clearAllQuestRuntime, clearQuestRuntime, setPanelOpen, setQuestRuntime, toggleQuestPanel } from "./questState";
import settings from "./settings";
import { ChannelStore, GuildChannelStore, QuestsStore, RunningGameStore } from "./stores";
import { SpoofingProfile, SpoofingSpeedMode } from "./types/spoofing";
import { devQuests, devRestAPI, isDevMode } from "./utils/dev";
import { questTaskConfig, readTaskProgress, resolveQuestApplication, resolveTaskName, taskFor, taskKeys } from "./utils/quest";
import { createController, getController, removeController, setGlobalPause } from "./utils/questControl";
import { callWithRetry } from "./utils/retry";
import { checkForUpdate } from "./utils/updateCheck";

const QuestApplyAction = findByCodeLazy("type:\"QUESTS_ENROLL_BEGIN\"") as (questId: string, action: QuestAction) => Promise<any>;
const QuestClaimAction = findByCodeLazy("type:\"QUESTS_CLAIM_REWARD_BEGIN\"") as (questId: string, action: QuestAction) => Promise<any>;
const QuestLocationMap = findByPropsLazy("QUEST_HOME_DESKTOP", "11") as Record<string, any>;

let availableQuests: QuestValue[] = [];
let acceptableQuests: QuestValue[] = [];
let completableQuests: QuestValue[] = [];
let claimableQuests: QuestValue[] = [];

const completingQuest = new Map();
const fakeGames = new Map();
const fakeApplications = new Map();
const claimingQuest = new Set<string>();

let captchaMonitor: MutationObserver | null = null;
let panelHotkeyHandler: ((e: KeyboardEvent) => void) | null = null;

const rewardPreferenceCache = new Map<string, boolean>();

/**
 * Discord answers a claim with a captcha, and retrying immediately just asks for another one. Give
 * a challenged quest a rest so the next attempt lands after there has been a chance to solve it,
 * rather than stacking challenges on top of each other.
 */
const claimBackoff = new Map<string, number>();
const CLAIM_CAPTCHA_BACKOFF_MS = 2 * 60 * 1000;

/**
 * Task types nobody can drive from inside Discord, and what to tell the user about each.
 *
 * Named one at a time rather than matched on a shared prefix. `ACHIEVEMENT_IN_ACTIVITY` and
 * `ACHIEVEMENT_IN_GAME` differ by one word and need opposite advice: the first is an activity you
 * launch from the quest and play inside Discord, the second wants an achievement earned in the
 * retail game with the game linked to your account, and cannot be launched from the quest at all.
 * A substring match told everyone the first answer.
 *
 * A new `ACHIEVEMENT_*` key that is not listed here deliberately falls through to the unknown-task
 * branch, which names the keys Discord offered and turns it into a lead rather than a guess.
 */
const MANUAL_TASKS: Record<string, string> = {
    ACHIEVEMENT_IN_ACTIVITY: "launch it from the quest and play",
    ACHIEVEMENT_IN_GAME: "play the game itself, with it linked to your account",
};

/**
 * Which setting switches each task type off. Only these five ever reach here, because a quest
 * offering anything else is rejected before this is consulted.
 */
const TASK_SETTING = {
    WATCH_VIDEO: "taskWatchVideo",
    WATCH_VIDEO_ON_MOBILE: "taskWatchVideoOnMobile",
    PLAY_ON_DESKTOP: "taskPlayOnDesktop",
    STREAM_ON_DESKTOP: "taskStreamOnDesktop",
    PLAY_ACTIVITY: "taskPlayActivity",
} as const;

function isTaskEnabled(taskName: string) {
    const key = TASK_SETTING[taskName as keyof typeof TASK_SETTING];
    return key ? settings.store[key] !== false : true;
}

/**
 * One toast per reward, not one per check. updateQuests runs on every store change, so without
 * this the same claimable quest would announce itself over and over.
 */
const announcedClaimable = new Set<string>();

function announceClaimable(quest: QuestValue) {
    if (!settings.store.notifyOnClaimable) return;
    if (announcedClaimable.has(quest.id)) return;
    announcedClaimable.add(quest.id);

    const questName = quest.config.messages.questName ?? quest.id;
    try {
        showToast(`${questName}: reward ready to claim`, Toasts.Type.SUCCESS);
    } catch (err) {
        // The toast comes from a Discord module that can move. Losing it should cost the notice,
        // not the claim.
        console.error("[QuestMaster] Could not show the claim toast:", err);
    }
}

function getCaptchaApiKeys() {
    return {
        nopecha: settings.store.nopchaApiKey,
        twoCaptcha: settings.store.twoCaptchaApiKey,
        capsolver: settings.store.capsolverApiKey,
    };
}
let updateQuestsTimeout: NodeJS.Timeout | null = null;
let lastProcessedQuestIds = new Set<string>();

let cachedRunningGames: any[] | null = null;
let cachedStreamMetadata: any | null = null;

function invalidateGamesCache() {
    cachedRunningGames = null;
}

function invalidateApplicationsCache() {
    cachedStreamMetadata = null;
}

function addFakeGame(questId: string, game: any) {
    fakeGames.set(questId, game);
    invalidateGamesCache();
}

function removeFakeGame(questId: string) {
    const result = fakeGames.delete(questId);
    if (result) invalidateGamesCache();
    return result;
}

function addFakeApplication(questId: string, app: any) {
    fakeApplications.set(questId, app);
    invalidateApplicationsCache();
}

function removeFakeApplication(questId: string) {
    const result = fakeApplications.delete(questId);
    if (result) invalidateApplicationsCache();
    return result;
}




const RewardPreference = {
    ANY: "any",
    NITRO: "nitro",
    AVATAR_DECORATION: "avatar_decoration",
    GAME_ITEM: "game_item",
    CURRENCY: "currency",
} as const;

type RewardPreference = (typeof RewardPreference)[keyof typeof RewardPreference];

const NitroSkuIds = new Set<string>([
    "521842865731829760",
    "521846918637420545",
]);

function getQuestRewardCategories(quest: QuestValue): RewardPreference[] {
    const rewards = quest.config?.rewardsConfig?.rewards ?? [];
    if (rewards.length === 0) {
        return [RewardPreference.GAME_ITEM];
    }

    const categories = new Set<RewardPreference>();

    for (const reward of rewards) {
        const rewardName = reward.messages?.name ?? "";
        const rewardLabel = `${rewardName} ${reward.messages?.nameWithArticle ?? ""}`.toLowerCase();
        if (NitroSkuIds.has(reward.skuId) || rewardLabel.includes("nitro")) {
            categories.add(RewardPreference.NITRO);
        }
        if (reward.orbQuantity > 0 || rewardLabel.includes("orb")) {
            categories.add(RewardPreference.CURRENCY);
        }
        if (rewardLabel.includes("avatar decoration") || rewardLabel.includes("profile decoration") || rewardLabel.includes("decoration")) {
            categories.add(RewardPreference.AVATAR_DECORATION);
        }
    }

    if (categories.size === 0) {
        categories.add(RewardPreference.GAME_ITEM);
    }

    return [...categories];
}

function questMatchesRewardPreference(quest: QuestValue) {
    const preference = (settings.store.preferredRewardType ?? RewardPreference.ANY) as RewardPreference;
    if (preference === RewardPreference.ANY) {
        return true;
    }

    const cacheKey = `${quest.id}-${preference}`;
    if (rewardPreferenceCache.has(cacheKey)) {
        return rewardPreferenceCache.get(cacheKey)!;
    }

    const rewardCategories = getQuestRewardCategories(quest);
    const matches = rewardCategories.includes(preference);
    rewardPreferenceCache.set(cacheKey, matches);
    return matches;
}

function getSpoofingProfile(): SpoofingProfile {
    const mode = (settings.store.spoofingSpeedMode ?? SpoofingSpeedMode.BALANCED) as SpoofingSpeedMode;

    switch (mode) {
        case SpoofingSpeedMode.SPEEDRUN:
            return {
                video: { maxFuture: 9999, speed: 60, interval: 0.15 },
                playActivity: { intervalMs: 2_000 },
            };
        case SpoofingSpeedMode.STEALTH:
            return {
                video: { maxFuture: 5, speed: 1, interval: 1 },
                playActivity: { intervalMs: 25_000 },
            };
        case SpoofingSpeedMode.BALANCED:
        default:
            return {
                video: { maxFuture: 10, speed: 7, interval: 1 },
                playActivity: { intervalMs: 20_000 },
            };
    }
}

function gatherRedeemCodes(body: any): string[] {
    const codes = new Set<string>();
    const codePattern = /^[A-Za-z0-9-]{10,}$/;

    const isValidRedeemCode = (str: string): boolean => {
        if (!codePattern.test(str)) return false;
        if (/^\d+$/.test(str)) return false;
        if (str.length < 10 || str.length > 50) return false;
        const letterCount = (str.match(/[A-Za-z]/g) || []).length;
        const hasHyphen = str.includes("-");
        return letterCount >= 3 || (letterCount >= 2 && hasHyphen);
    };

    const isCodeRelatedKey = (key: string): boolean => {
        const lowerKey = key.toLowerCase();
        return lowerKey.includes("code") ||
            lowerKey.includes("redemption") ||
            lowerKey.includes("reward") ||
            lowerKey.includes("claim") ||
            lowerKey.includes("gift") ||
            lowerKey.includes("key") ||
            lowerKey.includes("voucher") ||
            lowerKey.includes("token");
    };

    const walk = (value: any, depth: number, parentKey: string = "") => {
        if (depth > 6 || value == null) return;

        if (typeof value === "string") {
            const trimmed = value.trim();
            if (isValidRedeemCode(trimmed)) {
                codes.add(trimmed);
                console.log(`[CompleteDiscordQuest] Found potential code: ${trimmed} (from key: ${parentKey})`);
            }
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                walk(item, depth + 1, parentKey);
            }
            return;
        }

        if (typeof value === "object") {
            for (const [key, val] of Object.entries(value)) {
                if (isCodeRelatedKey(key) || isCodeRelatedKey(parentKey)) {
                    walk(val, depth + 1, key);
                } else {
                    walk(val, depth + 1, key);
                }
            }
        }
    };

    console.log("[CompleteDiscordQuest] Scanning response for codes:", JSON.stringify(body, null, 2).substring(0, 1000));
    walk(body, 0);
    return Array.from(codes);
}


function appendRedeemCodes(codes: string[], questName: string) {
    if (codes.length === 0) return;
    const timestamp = new Date().toLocaleString();
    const existing = (settings.store.redeemCodes ?? "").split("\n").map(x => x.trim()).filter(Boolean);
    const existingCodes = existing.map(line => line.split(" ")[0]);

    const newEntries = codes
        .filter(code => !existingCodes.includes(code))
        .map(code => `${code} (${questName} - ${timestamp})`);

    if (newEntries.length === 0) return;

    const merged = [...newEntries, ...existing];
    settings.store.redeemCodes = merged.join("\n");
    console.log("[CompleteDiscordQuest] Saved redeem codes:", newEntries.map(e => e.split(" ")[0]).join(", "));
}

async function claimQuestReward(quest: QuestValue) {
    if (!settings.store.autoClaimRewards) return;
    if (claimingQuest.has(quest.id)) return;
    if (quest.userStatus?.claimedAt) return;

    // Quiet on purpose: this runs on every store change, so a log here would be its own spam.
    const waitUntil = claimBackoff.get(quest.id) ?? 0;
    if (Date.now() < waitUntil) return;

    const questName = quest.config.messages.questName ?? quest.id;
    const endpoints = [`/quests/${quest.id}/claim-reward`];

    let claimPayload: any = {
        platform: 0,
        location: QuestLocationMap?.QUEST_HOME_DESKTOP ?? 11,
        is_targeted: false,
        metadata_raw: null,
    };

    if (settings.store.autoCaptchaSolving) {
        claimPayload = patchRequestWithCaptchaBypass(claimPayload);
    }

    claimingQuest.add(quest.id);
    try {
        let claimed = false;
        const collectedCodes: string[] = [];
        const tryClaim = async (fn: () => Promise<any>, label: string) => {
            try {
                const res = await callWithRetry(fn, { label: "claim-reward" });
                const codes = gatherRedeemCodes(res?.body ?? res);
                if (codes.length > 0) {
                    collectedCodes.push(...codes);
                }
                return true;
            } catch (err: any) {
                const challenge = detectCaptchaChallenge(err);

                if (challenge) {
                    const apiKeys = getCaptchaApiKeys();

                    // Only worth attempting when a solver actually exists. Previously this called
                    // bypassCaptcha with no keys at all, so a configured service was never used.
                    if (settings.store.autoCaptchaSolving && hasSolverService(apiKeys)) {
                        const bypassResult = await bypassCaptcha(challenge, settings.store.captchaSolvingService, apiKeys);
                        if (bypassResult.success && bypassResult.token) {
                            try {
                                const retryRes = await callWithRetry(fn, { label: "claim-reward-with-captcha" });
                                const codes = gatherRedeemCodes(retryRes?.body ?? retryRes);
                                if (codes.length > 0) {
                                    collectedCodes.push(...codes);
                                }
                                return true;
                            } catch (retryErr) {
                                console.warn(`[QuestMaster] Claim retry after solving the captcha failed for ${questName}`, retryErr);
                            }
                        }
                    }

                    // Back off either way. Hammering the endpoint only produces more challenges.
                    claimBackoff.set(quest.id, Date.now() + CLAIM_CAPTCHA_BACKOFF_MS);
                    noticeManualCaptcha(`claiming ${questName}`);
                    return false;
                }

                console.warn(`[QuestMaster] Claim attempt failed (${label}) for quest ${questName}`, err);
                return false;
            }
        };

        for (const url of endpoints) {
            if (claimed) break;
            claimed = await tryClaim(() => RestAPI.post({ url, body: claimPayload }), `${url} (with body)`);
        }

        if (!claimed) {
            claimed = await tryClaim(() => RestAPI.get({ url: `/quests/${quest.id}/reward-code` }), "reward-code");
        }
        if (claimed) {
            appendRedeemCodes(collectedCodes, questName);
            console.log("Claimed reward for quest:", questName);
        } else {
            console.error("Failed to claim reward for quest:", questName);
        }
    } finally {
        claimingQuest.delete(quest.id);
    }
}

function handleQuestCompletion(quest: QuestValue) {
    completingQuest.set(quest.id, false);
    removeController(quest.id);
    untrackQuest(quest.id);
    clearQuestRuntime(quest.id);
    void claimQuestReward(quest);
}

/** Starts one quest by id, for the panel's Run now and Retry buttons. */
async function startQuestById(questId: string) {
    const find = () => availableQuests.find(q => q.id === questId)
        ?? [...QuestsStore.quests.values()].find(q => q.id === questId);

    const quest = find();
    if (!quest) {
        console.warn("[QuestMaster] Asked to start a quest that is no longer listed:", questId);
        return;
    }

    completingQuest.delete(questId);
    removeController(questId);

    // Enrolling has to finish first. The video handler measures how much progress it is allowed
    // to claim from enrolledAt, so starting before that lands would measure from nothing.
    // Pressing the button is the ask, so it enrols even with auto-accept switched off.
    if (quest.userStatus?.enrolledAt == null) {
        await acceptQuest(quest, true);
    }

    const fresh = find() ?? quest;
    if (fresh.userStatus?.enrolledAt == null) {
        console.error("[QuestMaster] Could not enrol in the quest, so there is nothing to run:", questId);
        setQuestRuntime(questId, { status: "skipped", why: "could not enrol" });
        return;
    }

    completeQuest(fresh);
}

export default definePlugin({
    name: "QuestMaster",
    description: "Effortlessly complete Discord quests in the background. Auto-accepts, auto-completes, and auto-claims with optional captcha bypass. Press Ctrl+Shift+Q for the quest panel.",
    authors: [{
        name: "winters27",
        id: 681989594341834765n
    }],
    settings,
    patches: [
        {
            find: ".winButtonsWithDivider]",
            replacement: {
                match: /(\((\i)\){)(let{leading)/,
                replace: "$1$2?.trailing?.props?.children?.unshift($self.renderQuestButtonTopBar());$3"
            }
        },
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /className:\i\.buttons,.+?children:\[/,
                replace: "$&$self.renderQuestButtonSettingsBar(),"
            }
        },
        {
            find: "\"innerRef\",\"navigate\",\"onClick\"",
            replacement: {
                match: /(\i).createElement\("a",(\i)\)/,
                replace: "$1.createElement(\"a\",$self.renderQuestButtonBadges($2))"
            }
        },
        {
            find: "location:\"GlobalDiscoverySidebar\"",
            replacement: {
                match: /(\(\i\){let{tab:(\i)}=.+?children:\i}\))(]}\))/,
                replace: "$1,$self.renderQuestButtonBadges($2)$3"
            }
        }
    ],
    start: () => {
        if (isDevMode()) console.warn("[QuestMaster] Dev overrides are in place. Quests and requests may be fake.");

        // The pause is deliberately remembered across restarts, so restore it before the first
        // scan rather than letting one slip through.
        setGlobalPause(settings.store.questsPaused === true);
        registerQuestRunner(startQuestById);

        QuestsStore.addChangeListener(updateQuestsDebounced);
        updateQuests();

        // Always setup captcha monitor for auto-click checkbox feature
        const servicePreference = settings.store.autoCaptchaSolving ?
            settings.store.captchaSolvingService : "fallback";
        const apiKeys = settings.store.autoCaptchaSolving ? getCaptchaApiKeys() : undefined;

        captchaMonitor = setupCaptchaMonitor(servicePreference, apiKeys);

        startTokenCacheCleanup();

        if (!settings.store.disableUiRendering) mountQuestPanel();

        // The button renders through Discord's own components, so a Discord update can take it
        // away without warning. These two routes in depend on nothing but the plugin itself.
        (window as any).openQuestPanel = () => setPanelOpen(true);

        panelHotkeyHandler = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyQ") {
                e.preventDefault();
                toggleQuestPanel();
            }
        };
        document.addEventListener("keydown", panelHotkeyHandler);

        if (settings.store.checkForUpdates) void checkForUpdate();
    },
    stop: () => {
        QuestsStore.removeChangeListener(updateQuestsDebounced);
        if (updateQuestsTimeout) {
            clearTimeout(updateQuestsTimeout);
            updateQuestsTimeout = null;
        }
        stopCompletingAll();

        stopTokenCacheCleanup();
        clearTokenCache();

        if (captchaMonitor) {
            cleanupCaptchaMonitor(captchaMonitor);
            captchaMonitor = null;
        }

        unmountQuestPanel();
        delete (window as any).openQuestPanel;

        if (panelHotkeyHandler) {
            document.removeEventListener("keydown", panelHotkeyHandler);
            panelHotkeyHandler = null;
        }

        rewardPreferenceCache.clear();
        lastProcessedQuestIds.clear();
        claimBackoff.clear();
        announcedClaimable.clear();
        resetOps();
        clearAllQuestRuntime();
    },

    // Wrapped: these render Discord's own components through webpack finders, which go stale
    // whenever Discord reshuffles its UI. A stale finder should cost you the button, not the
    // surface that tells you something is wrong.
    renderQuestButtonTopBar: ErrorBoundary.wrap(() => {
        if (settings.store.disableUiRendering) return null;
        if (!settings.store.showQuestsButtonTopBar) return null;
        return <QuestButton type="top-bar" />;
    }, { noop: true }),

    renderQuestButtonSettingsBar: ErrorBoundary.wrap(() => {
        if (settings.store.disableUiRendering) return null;
        if (!settings.store.showQuestsButtonSettingsBar) return null;
        return <QuestButton type="settings-bar" />;
    }, { noop: true }),

    renderQuestButtonBadges(questButton) {
        if (settings.store.disableUiRendering) {
            return questButton;
        }
        if (settings.store.showQuestsButtonBadges && typeof questButton === "string" && questButton === "quests") {
            return (<QuestsCount />);
        }
        if (settings.store.showQuestsButtonBadges && questButton?.href?.startsWith("/quest-home")
            && Array.isArray(questButton?.children) && questButton.children.findIndex(child => child?.type === QuestsCount) === -1) {
            questButton.children.push(<QuestsCount />);
        }
        return questButton;
    }
});

function updateQuestsDebounced() {
    if (updateQuestsTimeout) {
        clearTimeout(updateQuestsTimeout);
    }

    updateQuestsTimeout = setTimeout(() => {
        updateQuests();
        updateQuestsTimeout = null;
    }, 300);
}

function updateQuests() {
    availableQuests = devQuests([...QuestsStore.quests.values()]);
    const preferredQuests = availableQuests.filter(questMatchesRewardPreference);

    // A quest you skipped and a task type you switched off are both "leave it alone", so neither
    // gets enrolled in nor started. Claiming is left out of this on purpose: a reward already
    // earned should still be collectable after you stop the quest that earned it.
    const skipped = getSkippedIds();
    const wanted = preferredQuests.filter(quest => {
        if (skipped.has(quest.id)) return false;

        const taskName = resolveTaskName(quest);
        return taskName == null || isTaskEnabled(taskName);
    });

    acceptableQuests = wanted.filter(x => x.userStatus?.enrolledAt == null && new Date(x.config.expiresAt).getTime() > Date.now()) || [];
    completableQuests = wanted.filter(x => x.userStatus?.enrolledAt && !x.userStatus?.completedAt && new Date(x.config.expiresAt).getTime() > Date.now()) || [];
    claimableQuests = preferredQuests.filter(x => x.userStatus?.completedAt && !x.userStatus?.claimedAt && new Date(x.config.expiresAt).getTime() > Date.now()) || [];

    for (const quest of claimableQuests) announceClaimable(quest);

    // Paused means nothing new starts. Anything already running is held by its own controller.
    if (isPaused()) return;

    const currentQuestIds = new Set([
        ...acceptableQuests.map(q => `accept-${q.id}`),
        ...completableQuests.map(q => `complete-${q.id}`),
        ...claimableQuests.map(q => `claim-${q.id}`)
    ]);

    const hasChanges = currentQuestIds.size !== lastProcessedQuestIds.size ||
        [...currentQuestIds].some(id => !lastProcessedQuestIds.has(id));

    if (!hasChanges && lastProcessedQuestIds.size > 0) {
        return;
    }

    lastProcessedQuestIds = currentQuestIds;

    for (const quest of acceptableQuests) {
        acceptQuest(quest);
    }
    for (const quest of completableQuests) {
        if (completingQuest.has(quest.id)) {
            if (completingQuest.get(quest.id) === false) {
                completingQuest.delete(quest.id);
            }
        } else {
            completeQuest(quest);
        }
    }
    for (const quest of claimableQuests) {
        claimQuestReward(quest);
    }
}

async function acceptQuest(quest: QuestValue, force = false) {
    // force is the panel's Run now: you asked for this one by hand, so the auto-accept setting
    // is not the question being answered.
    if (!force && !settings.store.acceptQuestsAutomatically) return;
    const action: QuestAction = {
        questContent: QuestLocationMap.QUEST_HOME_DESKTOP,
        questContentCTA: "ACCEPT_QUEST",
        sourceQuestContent: 0,
    };

    try {
        await QuestApplyAction(quest.id, action);
        console.log("Accepted quest:", quest.config.messages.questName);
    } catch (err: any) {
        if (settings.store.autoCaptchaSolving) {
            const challenge = detectCaptchaChallenge(err);
            if (challenge) {
                console.log("[CompleteDiscordQuest] Captcha detected during quest accept, bypassing...");
                const bypassResult = await bypassCaptcha(challenge);
                if (bypassResult.success) {
                    console.log("[CompleteDiscordQuest] Captcha bypassed, retrying quest accept...");
                    try {
                        await QuestApplyAction(quest.id, action);
                        console.log("Accepted quest after captcha bypass:", quest.config.messages.questName);
                        return;
                    } catch (retryErr) {
                        console.error("Failed to accept quest after captcha bypass:", quest.config.messages.questName, retryErr);
                    }
                }
            }
        }
        console.error("Failed to accept quest:", quest.config.messages.questName, err);
    }
}

function stopCompletingAll() {
    for (const quest of completableQuests) {
        if (completingQuest.has(quest.id)) {
            completingQuest.set(quest.id, false);
        }
        // The two handlers that wait on Discord's heartbeats never look at the map above, so
        // they only stop if their controller tells them to.
        getController(quest.id)?.cancel("plugin stopped");
    }
    console.log("Stopped completing all quests.");
}

function completeQuest(quest: QuestValue) {
    const isApp = typeof DiscordNative !== "undefined";
    if (!quest) {
        console.log("You don't have any uncompleted quests!");
        return;
    }

    const pid = Math.floor(Math.random() * 30000) + 1000;

    const { questName } = quest.config.messages;
    const taskConfig = questTaskConfig(quest);
    const taskName = resolveTaskName(quest);
    if (!taskName) {
        const offered = taskKeys(taskConfig);

        // Progress on these comes from really playing, so there is nothing to spoof and nothing
        // is broken. Which kind of playing depends on the key, so read it rather than assume.
        const manual = offered.find(k => MANUAL_TASKS[k] != null);
        if (manual) {
            console.log("Play-it-yourself quest:", questName, `(${manual})`);
            setQuestRuntime(quest.id, {
                name: questName,
                taskName: manual,
                status: "manual",
                why: MANUAL_TASKS[manual],
            });
            return;
        }

        // Naming the keys Discord offered turns "unknown task type" into a lead: a new task name
        // showing up here is the next thing worth supporting.
        const label = offered.join(", ") || "none";
        console.log("Unknown task type for quest:", questName, `(offered: ${label})`);
        setQuestRuntime(quest.id, { name: questName, status: "skipped", why: `unsupported: ${label}` });
        return;
    }

    if (!isTaskEnabled(taskName)) {
        console.log("Task type turned off, leaving quest alone:", questName, `(${taskName})`);
        setQuestRuntime(quest.id, { name: questName, taskName, status: "skipped", why: "task type turned off" });
        return;
    }

    // Resolve the application only after the task is known, since newer quests store it
    // per task rather than on the quest config.
    const taskData = taskFor(taskConfig, taskName);
    const { id: applicationId, name: applicationName } = resolveQuestApplication(quest, taskData);

    const secondsNeeded = taskData.target;
    const secondsDone = readTaskProgress(quest.userStatus, taskName, quest.config.configVersion);

    if (!isApp && taskName !== "WATCH_VIDEO" && taskName !== "WATCH_VIDEO_ON_MOBILE") {
        console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!");
        return;
    }

    // Without a real application id the spoofed process is one Discord can never match to the
    // quest, so it would idle at 0% instead of failing. Say so rather than sitting silent.
    if (!applicationId && (taskName === "PLAY_ON_DESKTOP" || taskName === "STREAM_ON_DESKTOP")) {
        console.error(`[QuestMaster] No application id found for "${questName}" (${taskName}). Discord may have moved it again. Skipping this quest.`);
        setQuestRuntime(quest.id, { name: questName, taskName, status: "skipped", why: "no application id" });
        completingQuest.set(quest.id, false);
        return;
    }

    const handler = questHandlers.find(h => h.supports(taskName));
    if (!handler) {
        console.error("No handler found for task type:", taskName);
        setQuestRuntime(quest.id, { name: questName, taskName, status: "skipped", why: `unsupported task ${taskName}` });
        completingQuest.set(quest.id, false);
        return;
    }

    completingQuest.set(quest.id, true);

    // One controller per quest, so the panel can pause, resume or stop this one without the
    // handler needing to know which of those happened.
    const controller = createController(quest.id);
    trackQuest(quest.id);

    setQuestRuntime(quest.id, {
        name: questName,
        taskName,
        status: controller.paused ? "paused" : "running",
        value: secondsDone,
        target: secondsNeeded,
        why: undefined,
        failed: false,
    });

    console.log(`Completing quest ${questName} (${quest.id}) - ${taskName} for ${secondsNeeded} seconds.`);

    handler.handle({
        quest,
        questName,
        taskName,
        secondsNeeded,
        secondsDone,
        applicationId,
        applicationName,
        configVersion: quest.config.configVersion,
        pid,
        isApp,
        completingQuest,
        fakeGames,
        fakeApplications,
        addFakeGame,
        removeFakeGame,
        addFakeApplication,
        removeFakeApplication,
        RestAPI: devRestAPI(RestAPI),
        FluxDispatcher,
        RunningGameStore,
        ChannelStore,
        GuildChannelStore,
        getSpoofingProfile,
        controller,
        onQuestComplete: () => handleQuestCompletion(quest)
    });
}
