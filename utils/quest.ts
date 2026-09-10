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

/**
 * Reads the task table off a quest, whichever shape it arrived in.
 *
 * `readTaskProgress` already says of `progress` that a dispatched payload passes through the
 * client's own transform first, so the shape is not ours to assume. The same is true of `tasks`,
 * and indexing it as a plain object was the half of that lesson never applied: a `Map` would
 * answer nothing for every key, and every quest would read as offering no task at all.
 */
export function taskKeys(taskConfig: any): string[] {
    const tasks = taskConfig?.tasks;
    if (tasks instanceof Map) return [...tasks.keys()].map(String);
    if (tasks && typeof tasks === "object") return Object.keys(tasks);

    return [];
}

export function taskFor(taskConfig: any, key: string): any {
    const tasks = taskConfig?.tasks;
    return tasks instanceof Map ? tasks.get(key) : tasks?.[key];
}

/** The task table a quest carries, under either the current name or the legacy one. */
export function questTaskConfig(quest: QuestValue): any {
    return (quest.config as any).taskConfig ?? quest.config.taskConfigV2;
}

/**
 * Reachable only with the achievement bypass switched on, and always last.
 *
 * A quest offering this alongside something spoofable should take the spoofable one: that path
 * touches nothing but this client, and this one authorizes an application on the account.
 */
export const BYPASS_TASK = "ACHIEVEMENT_IN_ACTIVITY";

/** The task this plugin would actually run for a quest, or undefined if it supports none of them. */
export function resolveTaskName(quest: QuestValue): SupportedTask | undefined {
    const taskConfig = questTaskConfig(quest);
    return SUPPORTED_TASKS.find(task => taskFor(taskConfig, task) != null);
}

/**
 * The game art Discord ships with a quest, or null when it ships none.
 *
 * The asset fields hold a path relative to Discord's CDN rather than a URL, and older quests only
 * carry a bare filename that has to be hung under the quest id.
 */
export function questArt(quest: QuestValue): string | null {
    const assets = (quest.config as any)?.assets ?? {};
    const relative = assets.gameTileDark
        ?? assets.gameTileLight
        ?? (assets.gameTile ? `quests/${quest.id}/${assets.gameTile}` : null);

    return relative ? `https://cdn.discordapp.com/${relative}` : null;
}

/**
 * Which of Discord's stream-quest preconditions is not met, or null when both are.
 *
 * Discord only counts a stream quest as progressing when you are Going Live, in a channel with at
 * least one other person, and reporting stream metadata. The plugin supplies the metadata; the
 * other two are yours to do. This takes values already read from the client rather than the stores
 * themselves, so the decision can be tested without one.
 *
 * `inChannel` being undefined means the count could not be read, which is not the same as the
 * channel being empty and must not be reported as it.
 */
export function describeMissingStreamPrecondition(stream: unknown, inChannel: number | undefined): string | null {
    if (stream == null) return "waiting for you to Go Live";
    if (typeof inChannel === "number" && inChannel < 2) return "waiting for someone to join the call";

    return null;
}
