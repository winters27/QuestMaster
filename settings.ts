/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export default definePluginSettings({
    acceptQuestsAutomatically: {
        type: OptionType.BOOLEAN,
        description: "Whether to accept available quests automatically.",
        default: true,
    },
    autoClaimRewards: {
        type: OptionType.BOOLEAN,
        description: "Automatically claim rewards once a quest is completed.",
        default: true,
    },
    preferredRewardType: {
        type: OptionType.SELECT,
        description: "Only accept/complete quests that grant this reward type.",
        options: [
            { label: "Any reward", value: "any", default: true },
            { label: "Nitro / Nitro trials", value: "nitro" },
            { label: "Avatar decoration", value: "avatar_decoration" },
            { label: "In-game item / DLC", value: "game_item" },
            { label: "Shop currency / Orbs", value: "currency" },
        ],
    },
    showQuestsButtonTopBar: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the quests button in the top bar.",
        default: true,
        restartNeeded: true,
    },
    showQuestsButtonSettingsBar: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the quests button in the settings bar.",
        default: false,
        restartNeeded: true,
    },
    showQuestsButtonBadges: {
        type: OptionType.BOOLEAN,
        description: "Whether to show badges on the quests button.",
        default: true,
    },
    showQuestLauncher: {
        type: OptionType.BOOLEAN,
        description: "Show the QuestMaster button. Unlike the quests button above, this one is drawn by the plugin, so a Discord update cannot take it away.",
        default: true,
    },
    questLauncherPosition: {
        type: OptionType.SELECT,
        description: "Where to put the QuestMaster button. It falls back to floating on its own if Discord's toolbar cannot be found.",
        options: [
            { label: "In Discord's toolbar, next to the inbox", value: "toolbar", default: true },
            { label: "Floating, above the message box", value: "floating" },
        ],
    },
    questButtonAction: {
        type: OptionType.SELECT,
        description: "What clicking the quests button does.",
        options: [
            { label: "Open the QuestMaster panel", value: "panel", default: true },
            { label: "Open Discord's quest page", value: "questPage" },
        ],
    },
    checkForUpdates: {
        type: OptionType.BOOLEAN,
        description: "Check GitHub for a newer version and show a notice in the panel. Only reads a version number; it never downloads or installs anything.",
        default: true,
    },
    notifyOnClaimable: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when a quest reward becomes claimable. One per quest, not one per check.",
        default: true,
    },
    achievementBypass: {
        type: OptionType.BOOLEAN,
        description:
            "Complete activity achievement quests without playing them. This is the only setting here that acts on your account rather than on your client: it OAuth-authorizes each quest's application on your account, reports progress to that activity's own backend, then revokes the authorization. Forging progress with a logged-in account is what Discord has been enforcing against, and enforcement reaches the whole account. Off unless you turn it on.",
        default: false,
    },
    taskWatchVideo: {
        type: OptionType.BOOLEAN,
        description: "Run video quests. Fully automatic.",
        default: true,
    },
    taskWatchVideoOnMobile: {
        type: OptionType.BOOLEAN,
        description: "Run mobile video quests. They complete from the desktop client just fine.",
        default: true,
    },
    taskPlayOnDesktop: {
        type: OptionType.BOOLEAN,
        description: "Run play-a-game quests. Nothing is installed or launched; Discord is told the game is running.",
        default: true,
    },
    taskStreamOnDesktop: {
        type: OptionType.BOOLEAN,
        description: "Run stream-a-game quests. You still have to Go Live in a call with at least one other person.",
        default: true,
    },
    taskPlayActivity: {
        type: OptionType.BOOLEAN,
        description: "Run activity quests.",
        default: true,
    },
    skippedQuestIds: {
        type: OptionType.STRING,
        description: "Quests to leave alone, one id per line. The panel writes this when you skip or stop a quest.",
        default: "",
        placeholder: "Skipped quests appear here.",
    },
    questsPaused: {
        type: OptionType.BOOLEAN,
        description: "Pause every quest. Survives a restart on purpose: a pause that lifts itself is a pause you cannot trust.",
        default: false,
        hidden: true,
    },
    questPanelPosition: {
        type: OptionType.STRING,
        description: "Where the panel sits, as left,top. Written when you drag it.",
        default: "",
        hidden: true,
    },
    seenChangelogVersion: {
        type: OptionType.STRING,
        description: "Which version's changelog has been read.",
        default: "",
        hidden: true,
    },
    spoofingSpeedMode: {
        type: OptionType.SELECT,
        description: "Controls how quickly spoofed progress/heartbeats are sent.",
        options: [
            { label: "Balanced (default)", value: "balanced", default: true },
            { label: "Speedrun (fastest)", value: "speedrun" },
            { label: "Stealth (slower / realistic)", value: "stealth" },
        ],
    },
    disableUiRendering: {
        type: OptionType.BOOLEAN,
        description:
            "Disable rendering UI buttons/badges for this plugin. Only background logic will run.",
        default: false,
    },
    preferredVoiceChannelId: {
        type: OptionType.STRING,
        description:
            "Voice channel ID to use for quest streaming instead of picking a random channel.",
        placeholder: "123456789012345678",
    },
    autoJoinVoiceChannel: {
        type: OptionType.BOOLEAN,
        description:
            "Automatically join the configured voice channel when starting a streaming quest.",
        default: true,
    },
    autoInviteEnabled: {
        type: OptionType.BOOLEAN,
        description:
            "Automatically send a voice channel invite to the configured user ID when a quest stream starts.",
        default: false,
    },
    autoInviteUserId: {
        type: OptionType.STRING,
        description:
            "User ID to invite (e.g., your alt/bot) when a quest stream begins.",
        placeholder: "987654321098765432",
    },
    redeemCodes: {
        type: OptionType.STRING,
        description:
            "Stores redeem codes captured after claiming quest rewards (appended automatically).",
        placeholder: "Codes will appear here after rewards are claimed.",
        default: "",
    },
    autoCaptchaSolving: {
        type: OptionType.BOOLEAN,
        description:
            "WARNING: Automatically bypass captcha challenges. This may violate Discord ToS and risk account ban. Use at your own risk!",
        default: false,
    },
    captchaSolvingService: {
        type: OptionType.SELECT,
        description: "Captcha solving service to use (priority order if multiple keys configured)",
        options: [
            { label: "Auto (Try all available)", value: "auto", default: true },
            { label: "NopeCHA (100/day FREE)", value: "nopecha" },
            { label: "2Captcha", value: "2captcha" },
            { label: "CapSolver", value: "capsolver" },
            { label: "Fallback only (Free)", value: "fallback" },
        ],
    },
    nopchaApiKey: {
        type: OptionType.STRING,
        description:
            "NopeCHA API Key (100 solves/day FREE). Get at nopecha.com → Settings → API Key",
        placeholder: "pk_nopecha_xxxxxxxxxxxxxxxx",
        default: "",
    },
    twoCaptchaApiKey: {
        type: OptionType.STRING,
        description:
            "2Captcha API Key ($1-3 per 1000 solves). Get at 2captcha.com",
        placeholder: "32-char API key",
        default: "",
    },
    capsolverApiKey: {
        type: OptionType.STRING,
        description:
            "CapSolver API Key ($0.8 per 1000 solves). Get at capsolver.com",
        placeholder: "CAP-xxxxxxxxxxxxxxxx",
        default: "",
    },
    captchaBypassMethod: {
        type: OptionType.SELECT,
        description: "Fallback method when API services fail",
        options: [
            { label: "Auto-click checkbox", value: "auto", default: true },
            { label: "Manual only", value: "manual" },
        ],
    },
});
