/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Discord drives GAME and STREAM quests: it sends the heartbeat itself while it believes
 * the spoofed process is running, and we only read the replies. If it never accepts the
 * process, no heartbeat arrives and the task would sit silent forever. Give up after three
 * missed beats at the usual ~30s cadence.
 */
export const HEARTBEAT_GRACE_MS = 90_000;

/**
 * Newer quests carry the application per task, older ones carried a single one on the quest
 * config. Reading only the old path yields undefined, which builds a fake process claiming to
 * be application 0, which Discord can never match back to the quest.
 */
export function resolveQuestApplication(quest: QuestValue, taskData: TaskDefinition | undefined) {
    const taskApp = taskData?.applications?.[0];
    return {
        id: quest.config.application?.id ?? taskApp?.id,
        name: quest.config.application?.name ?? taskApp?.name,
    };
}

/**
 * Progress is keyed by task name. Reading a hardcoded key returns undefined for any renamed
 * variant, which looks exactly like "no progress" and pins the task at 0.
 */
export function readTaskProgress(userStatus: any, taskName: string, configVersion?: number): number {
    if (configVersion === 1) return Math.floor(userStatus?.streamProgressSeconds ?? 0);

    // Plain object over REST, but dispatched payloads pass through the client's own transform
    // first, so the shape is not ours to assume.
    const progress = userStatus?.progress;
    const entry = progress instanceof Map ? progress.get(taskName) : progress?.[taskName];

    return Math.floor(entry?.value ?? userStatus?.streamProgressSeconds ?? 0);
}

/**
 * Every task type the plugin knows how to run, in the order it prefers them when a quest
 * offers more than one.
 */
export const SUPPORTED_TASKS = [
    "WATCH_VIDEO",
    "PLAY_ON_DESKTOP",
    "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY",
    "WATCH_VIDEO_ON_MOBILE",
] as const;

export type SupportedTask = (typeof SUPPORTED_TASKS)[number];

/**
 * How many orbs a quest pays. The number is already on the quest we hold, so this is a sum
 * rather than anything the plugin has to track for itself.
 */
export function questOrbs(quest: QuestValue): number {
    const rewards = quest.config?.rewardsConfig?.rewards ?? [];
    return rewards.reduce((total: number, reward: any) => total + (reward?.orbQuantity ?? 0), 0);
}

/** The task this plugin would actually run for a quest, or undefined if it supports none of them. */
export function resolveTaskName(quest: QuestValue): SupportedTask | undefined {
    const taskConfig = (quest.config as any).taskConfig ?? quest.config.taskConfigV2;
    return SUPPORTED_TASKS.find(task => taskConfig?.tasks?.[task] != null);
}
