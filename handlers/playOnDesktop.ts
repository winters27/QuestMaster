/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setQuestRuntime } from "../questState";
import { addSpoofedGame, getSpoofedGames, removeSpoofedGame } from "../utils/gameSpoof";
import { HEARTBEAT_GRACE_MS, readTaskProgress } from "../utils/quest";
import { callWithRetry } from "../utils/retry";
import { QuestHandler } from "./types";

export const playOnDesktopHandler: QuestHandler = {
    supports(taskName: string) {
        return taskName === "PLAY_ON_DESKTOP";
    },

    handle({ quest, questName, taskName, secondsNeeded, secondsDone, applicationId, applicationName, pid, isApp, RestAPI, FluxDispatcher, RunningGameStore, completingQuest, configVersion, onQuestComplete }) {
        if (!isApp) {
            console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!");
            return;
        }

        callWithRetry(() => RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` }), { label: "applications/public" }).then(res => {
            const appData = (res as any).body[0];
            const exeName = (appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "")) ?? appData.name.replace(/[/\\:*?"<>|]/g, "");

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
            addSpoofedGame(RunningGameStore, quest.id, fakeGame);

            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: getSpoofedGames() });

            let cleaned = false;
            let beats = 0;
            let watchdog: ReturnType<typeof setTimeout> | undefined;

            const unsubscribe = () => {
                try {
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
                } catch {

                }
            };

            const cleanup = (completed: boolean) => {
                if (cleaned) return;
                cleaned = true;

                clearTimeout(watchdog);
                removeSpoofedGame(quest.id);
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: getSpoofedGames() });

                unsubscribe();

                if (completed) {
                    console.log("Quest completed!");
                    onQuestComplete();
                } else {
                    completingQuest.set(quest.id, false);
                }
            };

            // Discord sends the heartbeat itself while it believes the game is running, so if
            // it never accepts the spoofed process nothing arrives and the quest would sit at
            // 0% in silence. Re-armed on every beat so a task that stops partway is caught too.
            const armWatchdog = () => {
                clearTimeout(watchdog);
                watchdog = setTimeout(() => {
                    console.error(beats === 0
                        ? `[QuestMaster] Discord never sent a heartbeat for "${questName}". It is not accepting the spoofed game on this client, so there is nothing to wait for.`
                        : `[QuestMaster] Discord stopped sending heartbeats for "${questName}" after ${beats}. Giving up.`);
                    setQuestRuntime(quest.id, {
                        status: "skipped",
                        why: beats === 0 ? "Discord never started it" : "heartbeats stopped",
                    });
                    cleanup(false);
                }, HEARTBEAT_GRACE_MS);
            };

            const onHeartbeat = (data: any) => {
                if (data.questId !== quest.id) return;

                if (!completingQuest.get(quest.id)) {
                    console.log("Stopping completing quest:", questName);
                    cleanup(false);
                    return;
                }

                beats++;
                armWatchdog();

                const progress = readTaskProgress(data.userStatus, taskName, configVersion);
                setQuestRuntime(quest.id, { value: progress, target: secondsNeeded });

                console.log(`Quest progress: ${progress}/${secondsNeeded}`);

                if (progress >= secondsNeeded) {
                    cleanup(true);
                }
            };

            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
            armWatchdog();

            console.log(`Spoofed your game to ${applicationName ?? appData.name}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
        }).catch(err => {
            console.error("Failed to fetch application data for quest", questName, err);
            completingQuest.set(quest.id, false);
        });
    }
};
