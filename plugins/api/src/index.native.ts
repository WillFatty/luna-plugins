import { BrowserWindow } from "electron";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { ActionResult, ActionSchema, WsMessage, WsSubscription } from "./types";

type NativeActionHandler = (data: WsMessage) => ActionResult;

const ipcChannel = "api.playback.control";

const schemas: Record<string, ActionSchema> = {
    setRepeatMode: {
        param: "mode",
        validate: (v): v is number => typeof v === "number",
    },
    setShuffleMode: {
        param: "shuffle",
        validate: (v): v is boolean => typeof v === "boolean",
    },
    seek: {
        param: "time",
        validate: (v): v is number => typeof v === "number",
    },
    volume: {
        param: "volume",
        validate: (v): v is string | number =>
            (typeof v === "string" && /^[-+]\d+$/.test(v)) ||
            (typeof v === "number" && v >= 0 && v <= 100),
    },
    playNext: {
        param: "itemId",
        validate: (v): v is string => typeof v === "string" && v.length > 0,
    },
    addToQueue: {
        param: "itemId",
        validate: (v): v is string => typeof v === "string" && v.length > 0,
    },
    removeFromQueue: {
        param: "itemId",
        validate: (v): v is string => typeof v === "string" && v.length > 0,
    },
};

let server: Server | null = null;
let wss: WebSocketServer | null = null;
let serverPort: number | null = null;
const fields: Record<string, unknown> = {};
const wsSubscriptions = new Map<WebSocket, WsSubscription>();

/** Bump when shipping WS/debug fixes — appears on GET / and GET /debug. */
const API_BUILD = "2026-07-16-realtime";

/** Throttle noisy field update logs (playTime ticks every 250ms). */
const lastNotifyLogAt = new Map<string, number>();
const NOTIFY_LOG_COOLDOWN_MS = 2000;

const debugLog = (...args: unknown[]) => {
    console.log("[API:WS]", ...args);
};

const countOpenClients = () => {
    let open = 0;
    let subscribed = 0;
    for (const [ws, sub] of wsSubscriptions) {
        if (ws.readyState === WebSocket.OPEN) {
            open++;
            if (sub.all || sub.fields.size > 0) subscribed++;
        }
    }
    return { total: wsSubscriptions.size, open, subscribed };
};

const getDebugSnapshot = () => {
    const clients = [...wsSubscriptions.entries()].map(([ws, sub], i) => ({
        id: i + 1,
        readyState: ws.readyState,
        readyStateLabel:
            ws.readyState === WebSocket.OPEN
                ? "OPEN"
                : ws.readyState === WebSocket.CONNECTING
                  ? "CONNECTING"
                  : ws.readyState === WebSocket.CLOSING
                    ? "CLOSING"
                    : "CLOSED",
        all: sub.all,
        fields: Array.from(sub.fields),
    }));

    const playQueue = fields.playQueue as
        | {
              currentIndex?: number;
              elements?: Array<{
                  mediaItemId?: string | number;
                  title?: string | null;
                  artists?: string[] | null;
                  coverUrl?: string | null;
                  duration?: number | null;
              }>;
          }
        | undefined;
    const elements = playQueue?.elements ?? [];
    const currentIndex = playQueue?.currentIndex ?? -1;
    const songs = elements.map((el, i) => ({
        index: i,
        mediaItemId: el.mediaItemId ?? null,
        title: el.title ?? null,
        artists: el.artists ?? null,
        coverUrl: el.coverUrl ?? null,
        duration: el.duration ?? null,
    }));
    const withCover = songs.reduce((n, el) => n + (typeof el.coverUrl === "string" && el.coverUrl ? 1 : 0), 0);

    return {
        apiBuild: API_BUILD,
        serverRunning: !!server,
        port: serverPort,
        fieldKeys: Object.keys(fields),
        trackTitle: (fields.track as { title?: string } | undefined)?.title ?? null,
        playing: fields.playing ?? null,
        playTime: fields.playTime ?? null,
        coverUrl: typeof fields.coverUrl === "string" ? fields.coverUrl : null,
        queue: {
            currentIndex,
            length: songs.length,
            withCover,
            songs,
        },
        clients: countOpenClients(),
        connections: clients,
    };
};

const sendToRenderer = (data: Record<string, unknown>) => {
    const tidalWindow = BrowserWindow.fromId(1);
    if (!tidalWindow) {
        console.warn("sendToRenderer: No tidalWindow available");
        return;
    }
    tidalWindow.webContents.send(ipcChannel, data);
};

const invokeRenderer = async (data: Record<string, unknown>): Promise<{ success: boolean; response?: unknown }> => {
    const tidalWindow = BrowserWindow.fromId(1);
    if (!tidalWindow) {
        console.warn("invokeRenderer: No tidalWindow available");
        return { success: false };
    }
    try {
        const response = await tidalWindow.webContents.executeJavaScript(
            `window.__apiInvokeAction?.(${JSON.stringify(data)})`
        );
        return { success: true, response };
    } catch (e) {
        console.error("invokeRenderer error:", e);
        return { success: false };
    }
};


const sendWsResponse = (ws: WebSocket, payload: Record<string, unknown>) =>
    ws.send(JSON.stringify(payload));

const sendWsError = (ws: WebSocket, error: string) =>
    sendWsResponse(ws, { type: "error", error });


const createActionHandler = (schema: ActionSchema): NativeActionHandler => {
    return (data) => {
        const paramValue = data[schema.param as keyof WsMessage];
        if (!schema.validate(paramValue)) {
            return { success: false };
        }
        const payload = { action: data.action, [schema.param!]: paramValue };
        sendToRenderer(payload);
        return { success: true, response: { type: "ok", msgId: data.msgId, ...payload } };
    };
};

const actionHandlers: Record<string, NativeActionHandler> = Object.fromEntries(
    Object.entries(schemas).map(([action, schema]) => [action, createActionHandler(schema)])
);

const handleWsSubscribe = (ws: WebSocket, data: WsMessage): boolean => {
    const hasFields = Array.isArray(data.fields);
    const wantsAll = !!data.all;
    // Clients may subscribe with `{ all: true }` and no fields array.
    if (!hasFields && !wantsAll) {
        debugLog("subscribe REJECTED — need fields[] or all:true", data);
        return false;
    }

    const sub = wsSubscriptions.get(ws)!;
    sub.fields = hasFields ? new Set(data.fields) : new Set();
    sub.all = wantsAll;

    const counts = countOpenClients();
    debugLog(
        `subscribe OK all=${sub.all} fields=[${Array.from(sub.fields).join(",")}]`,
        `clients open=${counts.open} subscribed=${counts.subscribed}`,
        `snapshot keys=${Object.keys(fields).length}`,
    );

    sendWsResponse(ws, {
        type: "subscribed",
        msgId: data.msgId,
        fields: Array.from(sub.fields),
        all: sub.all,
    });

    // Push current snapshot so the client has state immediately.
    if (sub.all) {
        sendWsResponse(ws, { type: "update", all: true, fields });
        debugLog("sent initial full snapshot to subscriber");
    } else {
        let n = 0;
        for (const field of sub.fields) {
            if (field in fields) {
                sendWsResponse(ws, { type: "update", all: false, field, value: fields[field] });
                n++;
            }
        }
        debugLog(`sent initial ${n} field snapshot(s) to subscriber`);
    }
    return true;
};

const handleWsUnsubscribe = (ws: WebSocket, data: WsMessage): void => {
    const sub = wsSubscriptions.get(ws)!;
    sub.fields.clear();
    sub.all = false;
    sendWsResponse(ws, { type: "unsubscribed", msgId: data.msgId });
};


const handleWsMessage = async (ws: WebSocket, data: WsMessage) => {
    const { action } = data;
    debugLog(`← message action=${action}`, data.msgId != null ? `msgId=${data.msgId}` : "");

    if (action === "subscribe") {
        if (!handleWsSubscribe(ws, data)) {
            sendWsResponse(ws, { type: "error", msgId: data.msgId, error: "Malformed subscribe action" });
        }
        return;
    }

    if (action === "unsubscribe") {
        handleWsUnsubscribe(ws, data);
        debugLog("unsubscribe OK");
        return;
    }

    const handler = actionHandlers[action];
    if (handler) {
        const result = handler(data);
        if (result.success && result.response) {
            sendWsResponse(ws, result.response);
        } else {
            sendWsResponse(ws, { type: "error", msgId: data.msgId, error: `Malformed ${action} action` });
        }
        return;
    }

    const result = await invokeRenderer({ ...data });
    if (result.success) {
        sendWsResponse(ws, { type: "ok", msgId: data.msgId, action, data: result.response });
    } else {
        sendWsResponse(ws, { type: "error", msgId: data.msgId, error: `Action "${action}" failed or not found` });
    }
};

const sendHttpResponse = (res: ServerResponse, status: number, data: Record<string, unknown>) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
};

const parseRequestBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });

const handleHttpAction = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const action = url.pathname.slice(1);

    if (!action) {
        sendHttpResponse(res, 400, { type: "error", error: "No action specified" });
        return;
    }

    try {
        const body = await parseRequestBody(req);
        const data: WsMessage = { action, ...body };
        const handler = actionHandlers[action];
        if (handler) {
            const result = handler(data);
            if (result.success && result.response) {
                sendHttpResponse(res, 200, result.response);
            } else {
                sendHttpResponse(res, 400, { type: "error", error: `Malformed ${action} action` });
            }
            return;
        }
        const result = await invokeRenderer({ ...data });
        if (result.success) {
            sendHttpResponse(res, 200, { type: "ok", action, data: result.response });
        } else {
            sendHttpResponse(res, 400, { type: "error", error: `Action "${action}" failed or not found` });
        }
    } catch (e) {
        const message = e instanceof Error ? e.message : "Invalid request";
        sendHttpResponse(res, 400, { type: "error", error: message });
    }
};



const handleHttpRequest = (req: IncomingMessage, res: ServerResponse) => {
    Object.entries({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }).forEach(([key, value]) => res.setHeader(key, value));

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "POST") {
        handleHttpAction(req, res);
        return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === "/debug") {
        const snapshot = getDebugSnapshot();
        debugLog("GET /debug", snapshot.clients);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(snapshot, null, 2));
        return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ apiBuild: API_BUILD, ...fields }, null, 2));
};


const handleWsConnection = (ws: WebSocket, req: IncomingMessage) => {
    const remote = req.socket.remoteAddress ?? "unknown";
    wsSubscriptions.set(ws, { fields: new Set(), all: false });
    const counts = countOpenClients();
    debugLog(`CLIENT CONNECTED from ${remote} — open=${counts.open} total=${counts.total}`);

    ws.on("message", (message: WebSocket.RawData) => {
        try {
            const data = JSON.parse(message.toString()) as WsMessage;
            handleWsMessage(ws, data);
        } catch (e) {
            console.error("[API:WS] message parse error:", e);
            sendWsError(ws, "Invalid message format");
        }
    });

    ws.on("close", (code, reason) => {
        wsSubscriptions.delete(ws);
        const after = countOpenClients();
        debugLog(
            `CLIENT DISCONNECTED from ${remote} code=${code} reason=${reason?.toString() || "(none)"}`,
            `— open=${after.open} total=${after.total}`,
        );
    });

    ws.on("error", (err) => {
        debugLog(`CLIENT ERROR from ${remote}:`, err.message);
    });
};


const notifyWebSocketClients = (field: string, value: unknown) => {
    if (!wss) return;

    let notified = 0;
    let skippedUnsubscribed = 0;
    let skippedClosed = 0;
    const noisy = field === "playTime" || field === "currentTime";

    for (const [ws, sub] of wsSubscriptions) {
        if (ws.readyState !== WebSocket.OPEN) {
            skippedClosed++;
            continue;
        }

        if (sub.all) {
            // Progress ticks: send a tiny field update instead of the full snapshot
            // (queue can be hundreds of tracks — reserializing it at 60Hz is brutal).
            if (noisy) {
                sendWsResponse(ws, { type: "update", all: false, field, value });
            } else {
                sendWsResponse(ws, { type: "update", all: true, fields });
            }
            notified++;
        } else if (sub.fields.has(field)) {
            sendWsResponse(ws, { type: "update", all: false, field, value });
            notified++;
        } else {
            skippedUnsubscribed++;
        }
    }

    const now = Date.now();
    const last = lastNotifyLogAt.get(field) ?? 0;
    if (!noisy || now - last >= NOTIFY_LOG_COOLDOWN_MS) {
        lastNotifyLogAt.set(field, now);
        const preview =
            field === "track"
                ? (value as { title?: string } | null)?.title
                : field === "coverUrl"
                  ? String(value).slice(0, 60)
                  : value;
        debugLog(
            `→ push field=${field}`,
            `notified=${notified} unsubscribed=${skippedUnsubscribed} closed=${skippedClosed}`,
            `value=`,
            preview,
        );
        if (notified === 0 && wsSubscriptions.size === 0) {
            debugLog("NO CLIENTS CONNECTED — update not delivered");
        } else if (notified === 0) {
            debugLog("clients connected but none subscribed to this field");
        }
    }
};

const updateField = (field: string, value: unknown) => {
    if (!server) {
        console.warn(`[API:WS] Cannot update field "${field}": server not running`);
        return;
    }
    // Compare before assign — otherwise notify always sees equal values and never pushes.
    if (fields[field] === value) return;
    fields[field] = value;
    notifyWebSocketClients(field, value);
};


const startServer = async (port: number) => {
    if (server) {
        await stopServer();
    }

    serverPort = port;
    server = createServer(handleHttpRequest);
    server.listen(port, () => {
        debugLog(`HTTP+WS server listening on port ${port}`);
        debugLog(`Debug snapshot: http://127.0.0.1:${port}/debug`);
    });

    wss = new WebSocketServer({ server });
    wss.on("connection", handleWsConnection);
    wss.on("error", (err) => {
        debugLog("WebSocketServer error:", err.message);
    });
};

const stopServer = async () => {
    if (wss) {
        wss.clients.forEach((ws) => ws.close());
        wss.close();
        wss = null;
    }

    if (server) {
        server.close(() => {
            server = null;
            serverPort = null;
            debugLog("server stopped");
        });
    }
};

const updateFields = (recordedFields: Record<string, unknown>) => {
    Object.entries(recordedFields).forEach(([key, value]) => updateField(key, value));
};

export { startServer, stopServer, updateFields };

