/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Completing an activity achievement quest without playing the activity.
 *
 * Every other task type in this plugin lies to your own client and lets Discord draw its own
 * conclusions. This one does not, and the difference is worth being clear about before reading
 * further: Discord does not validate these quests itself. It delegates that to the activity's own
 * backend, so there is no client-side heartbeat to spoof and Discord answers spoofed ones with a
 * 403. The only way in is to authorize against that backend as you and report progress to it.
 *
 * That means a real OAuth2 authorization of a third party's application on your account, and a
 * forged progress report sent with it. It is off unless you turn it on, and the setting is the
 * consent: see `achievementBypass`.
 *
 * The grant is treated as something that must never outlive the attempt:
 *
 * - The grants that application already holds are snapshotted first, and that snapshot is a
 *   precondition rather than a nicety. If it cannot be read, nothing is authorized at all, because
 *   a grant we cannot later tell apart from yours is one we cannot safely revoke.
 * - Cleanup runs in a `finally` and revokes only grants that appeared after the snapshot, so a
 *   failed attempt leaves nothing behind and an authorization you made yourself is never touched.
 *
 * The one case it cannot tell apart is an authorization you make by hand, for the same app, while
 * this is running.
 */

import { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.QuestMaster as PluginNative<typeof import("../native")>;

/** Discord refuses a proxy ticket for these, and the activity will not launch by hand either. */
const AGE_GATED = 50165;

const SCOPES = "identify applications.commands applications.entitlements";

export interface BypassResult {
    ok: boolean;
    /** Why it did not work, phrased for the panel. Null on success. */
    reason: string | null;
}

function describe(err: any): string {
    const parts: string[] = [];

    if (err?.status) parts.push(`HTTP ${err.status}`);
    const code = err?.body?.code;
    if (code) parts.push(`code ${code}`);

    const message = err?.body?.message ?? err?.message;
    if (message) parts.push(String(message));

    return parts.join(", ") || "unknown error";
}

/** Every grant this application currently holds, by id. */
async function grantsFor(RestAPI: any, appId: string): Promise<Set<string>> {
    const res = await RestAPI.get({ url: "/oauth2/tokens" });
    return new Set(
        (res?.body ?? [])
            .filter((token: any) => token.application?.id === appId)
            .map((token: any) => token.id),
    );
}

export async function runAchievementBypass(
    quest: QuestValue,
    appId: string | undefined,
    target: number,
    RestAPI: any,
): Promise<BypassResult> {
    const questName = quest.config.messages.questName ?? quest.id;

    if (!appId) {
        return { ok: false, reason: "no application id, so there is nothing to authorize against" };
    }

    // The id goes into a hostname. The native side refuses a bad one too, but there is no reason
    // to have sent it.
    if (!/^\d+$/.test(String(appId))) {
        return { ok: false, reason: "the quest's application id is not numeric, so it was refused" };
    }

    if (typeof Native?.discordSaysAuthorize !== "function") {
        return { ok: false, reason: "restart Discord to load the part of the plugin that can reach the activity" };
    }

    let before: Set<string>;
    try {
        before = await grantsFor(RestAPI, appId);
    } catch (err) {
        console.warn("[QuestMaster] Could not read existing authorizations, so nothing was authorized:", err);
        return { ok: false, reason: "could not check existing authorizations, so none was created" };
    }

    try {
        console.log(`[QuestMaster] Authorizing application ${appId} to complete "${questName}". The grant is revoked when this finishes.`);

        const auth = await RestAPI.post({
            url: "/oauth2/authorize",
            query: { response_type: "code", client_id: appId, scope: SCOPES },
            body: {
                permissions: "0",
                authorize: true,
                integration_type: 1,
                location_context: { guild_id: "10000", channel_id: "10000", channel_type: 10000 },
            },
        });

        const location = auth?.body?.location;
        if (!location) throw new Error("Discord returned no location to read the code from");

        const authCode = new URL(location).searchParams.get("code");
        if (!authCode) throw new Error("Discord returned a location with no code in it");

        const ticket = await RestAPI.post({ url: `/applications/${appId}/proxy-tickets`, body: {} });
        const proxyTicket = ticket?.body?.ticket;
        if (!proxyTicket) throw new Error("Discord returned no proxy ticket");

        const referrer = `https://${appId}.discordsays.com/?instance_id=example-cl-instance&platform=desktop&discord_proxy_ticket=${encodeURIComponent(proxyTicket)}`;

        const authorized = await Native.discordSaysAuthorize({ appId, questId: quest.id, authCode, referrer });
        if (!authorized.ok) throw { status: authorized.status, body: safeJson(authorized.body) };

        const token = safeJson(authorized.body)?.token;
        if (!token) throw new Error("the activity returned no token");

        const progress = await Native.discordSaysProgress({ appId, questId: quest.id, token, target, referrer });
        if (!progress.ok) throw { status: progress.status, body: safeJson(progress.body) };

        console.log(`[QuestMaster] "${questName}" completed through the activity's own backend.`);
        return { ok: true, reason: null };
    } catch (err: any) {
        if (err?.body?.code === AGE_GATED) {
            return { ok: false, reason: "age-gated or delisted, so Discord refuses the ticket on this account" };
        }
        console.error(`[QuestMaster] Achievement bypass failed for "${questName}":`, err);
        return { ok: false, reason: `bypass failed (${describe(err)})` };
    } finally {
        // Deliberately not conditional on anything above having succeeded. A request that went out
        // before a later step threw may already have created the grant.
        try {
            const after = await grantsFor(RestAPI, appId);
            const created = [...after].filter(id => !before.has(id));

            for (const id of created) await RestAPI.del({ url: `/oauth2/tokens/${id}` });
            if (created.length) console.log(`[QuestMaster] Revoked ${created.length} authorization(s) created for ${appId}.`);
        } catch (err) {
            console.error(`[QuestMaster] Could not revoke the authorization for ${appId}. Remove it by hand in User Settings, Authorized Apps.`, err);
        }
    }
}

function safeJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
