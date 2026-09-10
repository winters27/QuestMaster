/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setQuestRuntime } from "../questState";
import { ApplicationStreamingStore, SortedVoiceStateStore } from "../stores";
import { describeHeartbeatError, HeartbeatWatchdog } from "../utils/heartbeat";
import { describeMissingStreamPrecondition, readTaskProgress } from "../utils/quest";
import { addSpoofedStream, removeSpoofedStream } from "../utils/streamSpoof";
import { QuestHandler } from "./types";

/**
 * How often to re-check what a stream quest is still waiting on.
 *
 * This handler deliberately does not arm its watchdog until the first heartbeat, because starting
 * a stream has no time limit and a from-start timer would kill a slow setup. The cost was silence:
 * a quest where the user never went live sat at zero per cent forever with nothing said. So it
 * reports what is missing instead, and keeps reporting until Discord starts counting.
 */
const PRECONDITION_POLL_MS = 10_000;

/**
 * Reads the two preconditions off the client. Both stores are found by name, so a build that moves
 * one should cost the explanation rather than the quest: an unreadable count reports nothing rather
 * than claiming the channel is empty.
 */
function whatIsMissing(): string | null {
    const stream = ApplicationStreamingStore?.getCurrentUserActiveStream?.();
    const inChannel = stream == null
        ? undefined
        : SortedVoiceStateStore?.countVoiceStatesForChannel?.(stream.channelId);

    return describeMissingStreamPrecondition(stream, inChannel);
}

export const streamOnDesktopHandler: QuestHandler = {
    supports(taskName: string) {
        return taskName === "STREAM_ON_DESKTOP";
    },

    handle({ quest, questName, taskName, secondsNeeded, secondsDone, applicationId, applicationName, pid, configVersion, FluxDispatcher, completingQuest, controller, onQuestComplete }) {
        const metadata = { id: applicationId, pid, sourceName: null };

        let spoofing = false;
        /** Returns false when another stream quest already holds the stream. */
        const startSpoof = () => {
            if (spoofing) return true;
            spoofing = true;
            return addSpoofedStream(ApplicationStreamingStore, quest.id, metadata);
        };
        const stopSpoof = () => {
            if (!spoofing) return;
            spoofing = false;
            removeSpoofedStream(quest.id);
        };

        let cleaned = false;
        let waiting: ReturnType<typeof setTimeout> | undefined;

        const watchdog = new HeartbeatWatchdog({
            questName,
            onGiveUp: verdict => {
                console.error(verdict.message);
                setQuestRuntime(quest.id, { status: "skipped", why: verdict.reason });
                cleanup(false);
            },
        });

        const reportWaiting = () => {
            // Once Discord is counting, it has already decided the preconditions hold.
            if (cleaned || watchdog.beats > 0) return;

            setQuestRuntime(quest.id, { why: whatIsMissing() ?? undefined });
            waiting = setTimeout(reportWaiting, PRECONDITION_POLL_MS);
        };

        const unsubscribe = () => {
            try {
                FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
                FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_FAILURE", onHeartbeatFailure);
            } catch {

            }
        };

        const cleanup = (completed: boolean) => {
            if (cleaned) return;
            cleaned = true;

            watchdog.stop();
            clearTimeout(waiting);
            stopSpoof();
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

            if (watchdog.beats === 0) {
                clearTimeout(waiting);
                setQuestRuntime(quest.id, { why: undefined });
            }

            // Unlike the game quest, this one never arms before the first beat: starting a stream
            // has no time limit, so a from-start deadline would kill a slow setup. The
            // precondition poll covers that stretch instead.
            watchdog.beat();

            const progress = readTaskProgress(event.userStatus, taskName, configVersion);
            setQuestRuntime(quest.id, { value: progress, target: secondsNeeded });

            console.log(`Quest progress: ${progress}/${secondsNeeded}`);

            if (progress >= secondsNeeded) {
                cleanup(true);
            }
        };

        // Pausing drops the spoofed stream metadata, so Discord goes back to seeing whatever is
        // really being streamed and stops crediting the quest. The watchdog stands down with it,
        // because here the heartbeats stopping is what was asked for.
        controller.onPause = () => {
            watchdog.stop();
            clearTimeout(waiting);
            stopSpoof();
        };
        controller.onResume = () => {
            // Another stream quest may have taken the stream while this one was held.
            if (!startSpoof()) {
                console.warn(`[QuestMaster] Cannot resume "${questName}": another stream quest holds the stream.`);
                setQuestRuntime(quest.id, { status: "skipped", why: "another stream quest has the stream" });
                cleanup(false);
                return;
            }
            // Deliberately not re-armed here. Same reason it is not armed at the start: this quest
            // waits on you to start streaming, which has no time limit, so the watchdog only
            // arrives once heartbeats have. The explanation resumes in its place.
            reportWaiting();
        };
        controller.onCancel = () => cleanup(false);

        // A beat Discord tried and failed is not the same as Discord going quiet, and it does
        // not resend one: the next attempt is the tick already scheduled.
        const onHeartbeatFailure = (data: any) => {
            if (data?.questId !== quest.id) return;
            watchdog.fail(describeHeartbeatError(data));
        };

        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_FAILURE", onHeartbeatFailure);

        // Discord reports one stream, so a second stream quest has nothing it can say. Say that
        // out loud rather than leaving it at zero per cent with no explanation: this handler waits
        // on the user, so its watchdog never arms and nothing else would ever notice.
        if (!controller.paused && !startSpoof()) {
            console.warn(`[QuestMaster] Not starting "${questName}": another stream quest holds the stream.`);
            setQuestRuntime(quest.id, { status: "skipped", why: "another stream quest has the stream" });
            cleanup(false);
            return;
        }

        if (!controller.paused) reportWaiting();

        console.log(`Spoofed your stream to ${applicationName ?? "the quest game"}. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
        console.log("Remember that you need at least 1 other person to be in the vc!");
    }
};
