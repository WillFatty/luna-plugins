import { ReactiveStore } from "@luna/core";
import { LunaSettings, LunaTextSetting, LunaSwitchSetting } from "@luna/ui";
import { debounce } from "@mui/material";
import React from "react";
import { createRoom, joinRoom, leaveRoom, getRoomInfo, connectToServer, disconnectFromServer } from "./index";

export const settings = await ReactiveStore.getPluginStorage("tidalsync", {
    serverUrl: "https://tidalsyncapi.hexium.cc/",
    displayName: "",
    autoConnect: false,
    showNotifications: true,
});

const buttonStyle: React.CSSProperties = {
    padding: "10px 20px",
    borderRadius: "4px",
    border: "none",
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.5px",
    cursor: "pointer",
    transition: "all 0.15s",
    textTransform: "uppercase" as const,
};

const primaryBtn: React.CSSProperties = {
    ...buttonStyle,
    background: "#00ffff",
    color: "#000",
};

const dangerBtn: React.CSSProperties = {
    ...buttonStyle,
    background: "transparent",
    color: "#e53935",
    border: "1px solid #e53935",
};

const secondaryBtn: React.CSSProperties = {
    ...buttonStyle,
    background: "#282828",
    color: "#fff",
};

const roomCardStyle: React.CSSProperties = {
    background: "#121212",
    border: "1px solid #282828",
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "8px",
};

const roomCodeStyle: React.CSSProperties = {
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: "22px",
    fontWeight: 700,
    color: "#00ffff",
    letterSpacing: "4px",
    background: "#1a1a1a",
    padding: "10px 16px",
    borderRadius: "4px",
    display: "inline-block",
    margin: "10px 0",
    userSelect: "all",
    border: "1px solid #282828",
};

const statusStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "#b3b3b3",
    marginTop: "6px",
    letterSpacing: "0.3px",
};

const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 700,
    color: "#fff",
    marginBottom: "8px",
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
};

const subLabelStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "#727272",
    marginBottom: "8px",
};

const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: "8px",
    alignItems: "center",
};

const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "10px 12px",
    borderRadius: "4px",
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#fff",
    fontSize: "14px",
    outline: "none",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    letterSpacing: "3px",
    textTransform: "uppercase",
    transition: "border-color 0.15s",
};

export const Settings: React.FC = () => {
    const [serverUrl, setServerUrl] = React.useState(settings.serverUrl);
    const [displayName, setDisplayName] = React.useState(settings.displayName);
    const [autoConnect, setAutoConnect] = React.useState(settings.autoConnect);
    const [showNotifications, setShowNotifications] = React.useState(settings.showNotifications);
    const [joinCode, setJoinCode] = React.useState("");
    const [roomInfo, setRoomInfo] = React.useState(() => getRoomInfo());
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        const interval = setInterval(() => {
            const info = getRoomInfo();
            setRoomInfo((prev) => {
                if (
                    prev.roomId !== info.roomId ||
                    prev.role !== info.role ||
                    prev.guestCount !== info.guestCount ||
                    prev.connected !== info.connected ||
                    prev.connecting !== info.connecting ||
                    prev.pendingActionType !== info.pendingActionType ||
                    prev.visible !== info.visible ||
                    prev.hostDisplayName !== info.hostDisplayName ||
                    JSON.stringify(prev.guestNames) !== JSON.stringify(info.guestNames)
                ) {
                    return info;
                }
                return prev;
            });
        }, 500);
        return () => clearInterval(interval);
    }, []);

    const debouncedUrl = React.useMemo(() => {
        return debounce((val: string) => {
            settings.serverUrl = val;
        }, 500);
    }, []);

    const debouncedName = React.useMemo(() => {
        return debounce((val: string) => {
            settings.displayName = val;
        }, 500);
    }, []);

    const handleCreate = () => {
        createRoom();
        setTimeout(() => forceUpdate(), 500);
    };

    const handleJoin = () => {
        if (!joinCode.trim()) return;
        joinRoom(joinCode.trim().toUpperCase());
        setJoinCode("");
        setTimeout(() => forceUpdate(), 500);
    };

    const handleLeave = () => {
        leaveRoom();
        setTimeout(() => forceUpdate(), 100);
    };

    const connected = roomInfo.connected;
    const isConnecting = roomInfo.connecting;
    const pendingType = roomInfo.pendingActionType;
    const inRoom = !!roomInfo.roomId;

    return (
        <LunaSettings>
            {/* ── Connection ── */}
            <div style={labelStyle}>Connection</div>
            <div style={subLabelStyle}>Configure the sync server</div>

            <LunaTextSetting
                title="Server URL"
                desc="WebSocket server address"
                value={serverUrl}
                onChange={(e) => {
                    setServerUrl(e.target.value);
                    debouncedUrl(e.target.value);
                }}
            />
            <LunaTextSetting
                title="Display Name"
                desc="Your name shown to other participants"
                value={displayName}
                onChange={(e) => {
                    setDisplayName(e.target.value);
                    debouncedName(e.target.value);
                }}
            />
            <LunaSwitchSetting
                title="Auto-connect on startup"
                desc="Automatically connect when TIDAL launches"
                value={autoConnect}
                onChange={(_, checked) => {
                    setAutoConnect(checked);
                    settings.autoConnect = checked;
                }}
            />
            <LunaSwitchSetting
                title="Show notifications"
                desc="Display popup notifications for sync events"
                value={showNotifications}
                onChange={(_, checked) => {
                    setShowNotifications(checked);
                    settings.showNotifications = checked;
                }}
            />

            {/* ── Connect / Disconnect ── */}
            <div style={{ ...labelStyle, marginTop: "16px" }}>Server</div>
            <div style={{ marginBottom: "12px" }}>
                {connected ? (
                    <button
                        style={{ ...dangerBtn, width: "100%" }}
                        onClick={() => {
                            disconnectFromServer();
                            setTimeout(() => forceUpdate(), 100);
                        }}
                    >
                        Disconnect
                    </button>
                ) : (
                    <button
                        style={{ ...primaryBtn, width: "100%", opacity: isConnecting ? 0.6 : 1 }}
                        disabled={isConnecting}
                        onClick={() => {
                            connectToServer();
                            setTimeout(() => forceUpdate(), 500);
                        }}
                    >
                        {isConnecting ? "Connecting..." : "Connect"}
                    </button>
                )}
                <div style={statusStyle}>
                    {connected ? "Connected" : isConnecting ? "Connecting to server..." : "Disconnected"}
                </div>
            </div>

            {/* ── Room Status ── */}
            <div style={{ ...labelStyle, marginTop: "20px" }}>Room</div>

            {inRoom ? (
                <div style={roomCardStyle}>
                    <div>
                        <span style={{ color: "#b3b3b3", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>
                            {roomInfo.role === "host" ? "Hosting" : "Joined"} room
                        </span>
                    </div>
                    <div style={roomCodeStyle}>{roomInfo.roomId}</div>
                    <div style={statusStyle}>
                        {roomInfo.role === "host"
                            ? `${roomInfo.guestCount} guest${roomInfo.guestCount !== 1 ? "s" : ""} connected`
                            : `Connected as guest`}
                    </div>
                    <div style={{ marginTop: "12px" }}>
                        <button style={dangerBtn} onClick={handleLeave}>
                            Leave Room
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Create */}
                    <div style={{ marginBottom: "12px" }}>
                        <button
                            style={{ ...primaryBtn, width: "100%", opacity: !connected || pendingType ? 0.6 : 1 }}
                            onClick={handleCreate}
                            disabled={!connected || !!pendingType}
                        >
                            {pendingType === "create"
                                ? "Creating..."
                                : connected
                                ? "Create Room"
                                : "Connect to server first"}
                        </button>
                    </div>

                    {/* Join */}
                    <div style={{ ...subLabelStyle, marginTop: "4px" }}>Or join an existing room</div>
                    <div style={rowStyle}>
                        <input
                            style={inputStyle}
                            placeholder="ROOM CODE"
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                            maxLength={8}
                            disabled={!connected || !!pendingType}
                        />
                        <button
                            style={{ ...secondaryBtn, opacity: !connected || !joinCode.trim() || pendingType ? 0.6 : 1 }}
                            onClick={handleJoin}
                            disabled={!connected || !joinCode.trim() || !!pendingType}
                        >
                            {pendingType === "join" ? "Joining..." : "Join"}
                        </button>
                    </div>
                </>
            )}
        </LunaSettings>
    );
};
