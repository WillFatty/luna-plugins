import { ReactiveStore } from "@luna/core";
import { LunaSettings, LunaTextSetting, LunaSwitchSetting } from "@luna/ui";
import { debounce } from "@mui/material";
import React from "react";
import { createRoom, joinRoom, leaveRoom, getRoomInfo } from "./index";

export const settings = await ReactiveStore.getPluginStorage("tidalsync", {
    serverUrl: "https://tidalsyncapi.hexium.cc/",
    displayName: "",
    autoConnect: false,
    showNotifications: true,
});

const buttonStyle: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "none",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.15s",
};

const primaryBtn: React.CSSProperties = {
    ...buttonStyle,
    background: "#1db954",
    color: "#000",
};

const dangerBtn: React.CSSProperties = {
    ...buttonStyle,
    background: "#e53935",
    color: "#fff",
};

const secondaryBtn: React.CSSProperties = {
    ...buttonStyle,
    background: "#333",
    color: "#ccc",
};

const roomCardStyle: React.CSSProperties = {
    background: "#1a1a2e",
    border: "1px solid #2a2a4a",
    borderRadius: "8px",
    padding: "12px 16px",
    marginBottom: "8px",
};

const roomCodeStyle: React.CSSProperties = {
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: "20px",
    fontWeight: 700,
    color: "#1db954",
    letterSpacing: "3px",
    background: "#0d0d1a",
    padding: "8px 16px",
    borderRadius: "6px",
    display: "inline-block",
    marginBottom: "8px",
    userSelect: "all",
};

const statusStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "#888",
    marginTop: "6px",
};

const labelStyle: React.CSSProperties = {
    fontSize: "14px",
    fontWeight: 600,
    color: "#e0e0e0",
    marginBottom: "6px",
};

const subLabelStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "#666",
    marginBottom: "8px",
};

const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: "8px",
    alignItems: "center",
};

const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "#0d0d1a",
    color: "#e0e0e0",
    fontSize: "13px",
    outline: "none",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    letterSpacing: "2px",
    textTransform: "uppercase",
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
                    prev.connected !== info.connected
                ) {
                    return info;
                }
                return prev;
            });
        }, 1000);
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
                desc="Automatically join your last room when TIDAL launches"
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

            {/* ── Room Status ── */}
            <div style={{ ...labelStyle, marginTop: "16px" }}>Room</div>

            {inRoom ? (
                <div style={roomCardStyle}>
                    <div>
                        <span style={{ color: "#888", fontSize: "12px" }}>
                            {roomInfo.role === "host" ? "Hosting" : "Joined"} room
                        </span>
                    </div>
                    <div style={roomCodeStyle}>{roomInfo.roomId}</div>
                    <div style={statusStyle}>
                        {roomInfo.role === "host"
                            ? `${roomInfo.guestCount} guest${roomInfo.guestCount !== 1 ? "s" : ""} connected`
                            : `Connected as guest`}
                    </div>
                    <div style={{ marginTop: "10px" }}>
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
                            style={{ ...primaryBtn, width: "100%" }}
                            onClick={handleCreate}
                            disabled={!connected}
                        >
                            {connected ? "Create Room" : "Connecting..."}
                        </button>
                    </div>

                    {/* Join */}
                    <div style={subLabelStyle}>Or join an existing room</div>
                    <div style={rowStyle}>
                        <input
                            style={inputStyle}
                            placeholder="ROOM CODE"
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                            maxLength={8}
                            disabled={!connected}
                        />
                        <button
                            style={secondaryBtn}
                            onClick={handleJoin}
                            disabled={!connected || !joinCode.trim()}
                        >
                            Join
                        </button>
                    </div>
                </>
            )}
        </LunaSettings>
    );
};
