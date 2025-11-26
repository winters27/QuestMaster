/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { filters, waitFor } from "@webpack";
import { FluxDispatcher, RestAPI } from "@webpack/common";

let QuestsStore: any = null;
let RunningGameStore: any = null;
let ChannelStore: any = null;
let GuildChannelStore: any = null;
let storesInitialized = false;

let availableQuests: any[] = [];
let completableQuests: any[] = [];

const completingQuest = new Map();
const fakeGames = new Map();
const fakeApplications = new Map();

const settings = definePluginSettings({});

export default definePlugin({
    name: "QuestMaster",
    description: "Effortlessly complete Discord quests in the background.",
    authors: [{
        name: "winters27",
        id: 681989594341834765n
    }],
    settings,

    patches: [
        {
            find: "\"RunningGameStore\"",
            group: true,
            replacement: [
                {
                    match: /}getRunningGames\(\){return/,
                    replace: "}getRunningGames(){const games=$self.getRunningGames();return games ? games : "
                },
                {
                    match: /}getGameForPID\((\i)\){/,
                    replace: "}getGameForPID($1){const pid=$self.getGameForPID($1);if(pid){return pid;}"
                }
            ]
        },
        {
            find: "ApplicationStreamingStore",
            replacement: {
                match: /}getStreamerActiveStreamMetadata\(\){/,
                replace: "}getStreamerActiveStreamMetadata(){const metadata=$self.getStreamerActiveStreamMetadata();if(metadata){return metadata;}"
            }
        }
    ],

    async start() {
        // Initialize stores asynchronously
        try {
            // Wait for stores to be available
            waitFor(filters.byProps("quests", "getQuest"), m => {
                QuestsStore = m;
                if (QuestsStore && typeof QuestsStore.addChangeListener === "function") {
                    QuestsStore.addChangeListener(updateQuests);
                    updateQuests();
                }
            });

            waitFor(filters.byProps("getRunningGames"), m => {
                RunningGameStore = m;
            });

            waitFor(filters.byProps("getSortedPrivateChannels"), m => {
                ChannelStore = m;
            });

            waitFor(filters.byProps("getAllGuilds", "getChannels"), m => {
                GuildChannelStore = m;
            });

            storesInitialized = true;
        } catch (e) {
            console.error("QuestMaster: Error initializing stores:", e);
        }
    },

    stop() {
        try {
            if (QuestsStore && typeof QuestsStore?.removeChangeListener === "function") {
                QuestsStore.removeChangeListener(updateQuests);
            }
        } catch (e) {
            // Ignore errors during cleanup
        }
        stopCompletingAll();
    },

    getRunningGames() {
        if (fakeGames.size > 0) {
            return Array.from(fakeGames.values());
        }
    },

    getGameForPID(pid: number) {
        if (fakeGames.size > 0) {
            return Array.from(fakeGames.values()).find(game => game.pid === pid);
        }
    },

    getStreamerActiveStreamMetadata() {
        if (fakeApplications.size > 0) {
            return Array.from(fakeApplications.values()).at(0);
        }
    }
});

function updateQuests() {
    try {
        if (!QuestsStore || !QuestsStore.quests) {
            console.warn("QuestMaster: QuestsStore not available");
            return;
        }

        availableQuests = [...QuestsStore.quests.values()];
        completableQuests = availableQuests.filter(x =>
            x.id !== "1248385850622869556" &&
            x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        ) || [];

        for (const quest of completableQuests) {
            if (completingQuest.has(quest.id)) {
                if (completingQuest.get(quest.id) === false) {
                    completingQuest.delete(quest.id);
                }
            } else {
                completeQuest(quest);
            }
        }
        console.log("Completable quests updated:", completableQuests);
    } catch (e) {
        console.error("QuestMaster: Error updating quests:", e);
    }
}

function stopCompletingAll() {
    for (const quest of completableQuests) {
        if (completingQuest.has(quest.id)) {
            completingQuest.set(quest.id, false);
        }
    }
    console.log("Stopped completing all quests.");
}

function completeQuest(quest: any) {
    const isApp = typeof DiscordNative !== "undefined";
    if (!quest) {
        console.log("You don't have any uncompleted quests!");
        return;
    }

    const pid = Math.floor(Math.random() * 30000) + 1000;
    const applicationId = quest.config.application.id;
    const applicationName = quest.config.application.name;
    const { questName } = quest.config.messages;
    const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
    const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"].find(x => taskConfig.tasks[x] != null);

    if (!taskName) {
        console.log("Unknown task type for quest:", questName);
        return;
    }

    const secondsNeeded = taskConfig.tasks[taskName].target;
    let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

    if (!isApp && taskName !== "WATCH_VIDEO" && taskName !== "WATCH_VIDEO_ON_MOBILE") {
        console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!");
        return;
    }

    completingQuest.set(quest.id, true);
    console.log(`Completing quest ${questName} (${quest.id}) - ${taskName} for ${secondsNeeded} seconds.`);

    switch (taskName) {
        case "WATCH_VIDEO":
        case "WATCH_VIDEO_ON_MOBILE": {
            const maxFuture = 10, speed = 7, interval = 1;
            const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
            let completed = false;

            const watchVideo = async () => {
                while (completingQuest.get(quest.id)) {
                    const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
                    const diff = maxAllowed - secondsDone;
                    const timestamp = secondsDone + speed;

                    if (diff >= speed) {
                        const res = await RestAPI.post({
                            url: `/quests/${quest.id}/video-progress`,
                            body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) }
                        });
                        completed = res.body.completed_at != null;
                        secondsDone = Math.min(secondsNeeded, timestamp);
                    }

                    if (timestamp >= secondsNeeded) break;
                    await new Promise(resolve => setTimeout(resolve, interval * 1000));
                }

                if (!completed) {
                    await RestAPI.post({
                        url: `/quests/${quest.id}/video-progress`,
                        body: { timestamp: secondsNeeded }
                    });
                }
                console.log("Quest completed!");
                completingQuest.set(quest.id, false);
            };

            watchVideo();
            console.log(`Spoofing video for ${questName}.`);
            break;
        }

        case "PLAY_ON_DESKTOP": {
            if (!RunningGameStore) {
                console.error("QuestMaster: RunningGameStore not available");
                completingQuest.set(quest.id, false);
                return;
            }

            RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` }).then(res => {
                const appData = res.body[0];
                const exeName = appData.executables.find((x: any) => x.os === "win32").name.replace(">", "");

                const fakeGame = {
                    cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                    exeName,
                    exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                    hidden: false,
                    isLauncher: false,
                    id: applicationId,
                    name: appData.name,
                    pid: pid,
                    pidPath: [pid],
                    processName: appData.name,
                    start: Date.now(),
                };

                const realGames = RunningGameStore.getRunningGames();
                fakeGames.set(quest.id, fakeGame);
                FluxDispatcher.dispatch({
                    type: "RUNNING_GAMES_CHANGE",
                    removed: realGames,
                    added: [fakeGame],
                    games: Array.from(fakeGames.values())
                });

                const playOnDesktop = (event: any) => {
                    if (event.questId !== quest.id) return;
                    const progress = quest.config.configVersion === 1
                        ? event.userStatus.streamProgressSeconds
                        : Math.floor(event.userStatus.progress.PLAY_ON_DESKTOP.value);
                    console.log(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                    if (!completingQuest.get(quest.id) || progress >= secondsNeeded) {
                        console.log("Stopping completing quest:", questName);
                        fakeGames.delete(quest.id);
                        FluxDispatcher.dispatch({
                            type: "RUNNING_GAMES_CHANGE",
                            removed: [fakeGame],
                            added: [],
                            games: Array.from(fakeGames.values())
                        });
                        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", playOnDesktop);

                        if (progress >= secondsNeeded) {
                            console.log("Quest completed!");
                            completingQuest.set(quest.id, false);
                        }
                    }
                };

                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", playOnDesktop);
                console.log(`Spoofed your game to ${applicationName}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
            });
            break;
        }

        case "STREAM_ON_DESKTOP": {
            const fakeApp = {
                id: applicationId,
                name: `FakeApp ${applicationName} (CompleteDiscordQuest)`,
                pid: pid,
                sourceName: null,
            };
            fakeApplications.set(quest.id, fakeApp);

            const streamOnDesktop = (event: any) => {
                if (event.questId !== quest.id) return;
                const progress = quest.config.configVersion === 1
                    ? event.userStatus.streamProgressSeconds
                    : Math.floor(event.userStatus.progress.STREAM_ON_DESKTOP.value);
                console.log(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                if (!completingQuest.get(quest.id) || progress >= secondsNeeded) {
                    console.log("Stopping completing quest:", questName);
                    fakeApplications.delete(quest.id);
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", streamOnDesktop);

                    if (progress >= secondsNeeded) {
                        console.log("Quest completed!");
                        completingQuest.set(quest.id, false);
                    }
                }
            };

            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", streamOnDesktop);
            console.log(`Spoofed your stream to ${applicationName}. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
            console.log("Remember that you need at least 1 other person to be in the vc!");
            break;
        }

        case "PLAY_ACTIVITY": {
            if (!ChannelStore || !GuildChannelStore) {
                console.error("QuestMaster: Channel stores not available");
                completingQuest.set(quest.id, false);
                return;
            }

            const sortedChannels = ChannelStore.getSortedPrivateChannels() as any;
            const channelId = sortedChannels[0]?.id ??
                (() => {
                    const guilds = Object.values(GuildChannelStore.getAllGuilds() as any) as any[];
                    const guildWithVocal = guilds.find((x: any) => x?.VOCAL?.length > 0);
                    return guildWithVocal?.VOCAL?.[0]?.channel?.id;
                })();
            const streamKey = `call:${channelId}:1`;

            const playActivity = async () => {
                console.log("Completing quest", questName, "-", quest.config.messages.questName);

                while (completingQuest.get(quest.id)) {
                    const res = await RestAPI.post({
                        url: `/quests/${quest.id}/heartbeat`,
                        body: { stream_key: streamKey, terminal: false }
                    });
                    const progress = res.body.progress.PLAY_ACTIVITY.value;
                    console.log(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                    if (progress >= secondsNeeded) {
                        await RestAPI.post({
                            url: `/quests/${quest.id}/heartbeat`,
                            body: { stream_key: streamKey, terminal: true }
                        });
                        break;
                    }

                    await new Promise(resolve => setTimeout(resolve, 20 * 1000));
                }

                console.log("Quest completed!");
                completingQuest.set(quest.id, false);
            };
            playActivity();
            break;
        }

        default:
            console.error("Unknown task type:", taskName);
            completingQuest.set(quest.id, false);
            break;
    }
}
