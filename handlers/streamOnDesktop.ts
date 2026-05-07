/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationStreamingStore } from "../stores";
import { QuestHandler } from "./types";

export const streamOnDesktopHandler: QuestHandler = {
    supports(taskName: string) {
        return taskName === "STREAM_ON_DESKTOP";
    },

    handle({ quest, questName, secondsNeeded, secondsDone, applicationId, applicationName, pid, configVersion, FluxDispatcher, completingQuest, onQuestComplete }) {
        const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

        ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
            id: applicationId,
            pid,
            sourceName: null
        });

        const unsubscribe = () => {
            try {
                FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
            } catch {
                
            }
        };

        const cleanup = (completed: boolean) => {
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
            unsubscribe();

            if (completed) {
                console.log("Quest completed!");
                onQuestComplete();
            } else {
                completingQuest.set(quest.id, false);
            }
        };

        const onHeartbeat = (event: any) => {
            if (event.questId !== quest.id) return;

            if (!completingQuest.get(quest.id)) {
                console.log("Stopping completing quest:", questName);
                cleanup(false);
                return;
            }

            const progress = configVersion === 1
                ? event.userStatus.streamProgressSeconds
                : Math.floor(event.userStatus.progress.STREAM_ON_DESKTOP.value);

            console.log(`Quest progress: ${progress}/${secondsNeeded}`);

            if (progress >= secondsNeeded) {
                cleanup(true);
            }
        };

        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);

        console.log(`Spoofed your stream to ${applicationName}. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
        console.log("Remember that you need at least 1 other person to be in the vc!");
    }
};
