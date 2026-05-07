/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { callWithRetry } from "../utils/retry";
import { QuestHandler } from "./types";

export const playOnDesktopHandler: QuestHandler = {
    supports(taskName: string) {
        return taskName === "PLAY_ON_DESKTOP";
    },

    handle({ quest, questName, secondsNeeded, secondsDone, applicationId, applicationName, pid, isApp, RestAPI, FluxDispatcher, RunningGameStore, completingQuest, configVersion, onQuestComplete }) {
        if (!isApp) {
            console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!");
            return;
        }

        callWithRetry(() => RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` }), { label: "applications/public" }).then(res => {
            const appData = (res as any).body[0];
            const exeName = (appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "")) ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");

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
            const fakeGames = [fakeGame];
            const realGetRunningGames = RunningGameStore.getRunningGames;
            const realGetGameForPID = RunningGameStore.getGameForPID;

            RunningGameStore.getRunningGames = () => fakeGames;
            RunningGameStore.getGameForPID = (pidValue: number) => fakeGames.find(x => x.pid === pidValue);

            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames });

            const unsubscribe = () => {
                try {
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
                } catch {
                    
                }
            };

            const cleanup = (completed: boolean) => {
                RunningGameStore.getRunningGames = realGetRunningGames;
                RunningGameStore.getGameForPID = realGetGameForPID;
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] });

                unsubscribe();

                if (completed) {
                    console.log("Quest completed!");
                    onQuestComplete();
                } else {
                    completingQuest.set(quest.id, false);
                }
            };

            const onHeartbeat = (data: any) => {
                if (data.questId !== quest.id) return;

                if (!completingQuest.get(quest.id)) {
                    console.log("Stopping completing quest:", questName);
                    cleanup(false);
                    return;
                }

                const progress = configVersion === 1
                    ? data.userStatus.streamProgressSeconds
                    : Math.floor(data.userStatus.progress?.PLAY_ON_DESKTOP?.value ?? 0);

                console.log(`Quest progress: ${progress}/${secondsNeeded}`);

                if (progress >= secondsNeeded) {
                    cleanup(true);
                }
            };

            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);

            console.log(`Spoofed your game to ${applicationName}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
        }).catch(err => {
            console.error("Failed to fetch application data for quest", questName, err);
            completingQuest.set(quest.id, false);
        });
    }
};
