import React from "react";
import { getRoomInfo, leaveRoom, createRoom, joinRoom, setVisible, connectToServer, disconnectFromServer } from "./index";
import { settings } from "./Settings";

export const PlaybarButton: React.FC = () => {
    const [info, setInfo] = React.useState(() => getRoomInfo());
    const [showPopup, setShowPopup] = React.useState(false);
    const [joinCode, setJoinCode] = React.useState("");
    const popupRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const interval = setInterval(() => {
            const fresh = getRoomInfo();
            setInfo((prev) =>
                prev.roomId !== fresh.roomId ||
                prev.role !== fresh.role ||
                prev.guestCount !== fresh.guestCount ||
                prev.connected !== fresh.connected ||
                prev.connecting !== fresh.connecting ||
                prev.pendingActionType !== fresh.pendingActionType ||
                prev.visible !== fresh.visible ||
                prev.hostDisplayName !== fresh.hostDisplayName ||
                JSON.stringify(prev.guestNames) !== JSON.stringify(fresh.guestNames)
                    ? fresh
                    : prev,
            );
        }, 500);
        return () => clearInterval(interval);
    }, []);

    React.useEffect(() => {
        if (!showPopup) return;
        const handleClick = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                setShowPopup(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [showPopup]);

    const inRoom = !!info.roomId;
    const connected = info.connected;
    const isConnecting = info.connecting;
    const pendingType = info.pendingActionType;

    const btnStyle: React.CSSProperties = {
        background: "none",
        border: "none",
        padding: "6px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "4px",
        position: "relative",
    };

    const iconColor = inRoom ? "#00ffff" : "#727272";
    const popupStyle: React.CSSProperties = {
        position: "absolute",
        bottom: "48px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "#121212",
        border: "1px solid #282828",
        borderRadius: "8px",
        padding: "14px",
        minWidth: "210px",
        color: "#fff",
        fontSize: "12px",
        zIndex: 9999,
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    };

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "8px 10px",
        borderRadius: "4px",
        border: "1px solid #333",
        background: "#1a1a1a",
        color: "#fff",
        fontSize: "13px",
        outline: "none",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        letterSpacing: "3px",
        textTransform: "uppercase",
        boxSizing: "border-box",
    };

    const btnBase: React.CSSProperties = {
        padding: "8px 14px",
        borderRadius: "4px",
        border: "none",
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.5px",
        cursor: "pointer",
        width: "100%",
        textTransform: "uppercase" as const,
    };

    return (
        <>
            <button
                style={btnStyle}
                title={inRoom ? `TidalSync: ${info.roomId}` : "TidalSync: Not connected"}
                onClick={() => setShowPopup(!showPopup)}
            >
                <svg viewBox="0 0 24 24" width="20" height="20">
                    {inRoom ? (
                        <>
                            <circle cx="8" cy="12" r="4" fill={iconColor} />
                            <circle cx="16" cy="12" r="4" fill={iconColor} opacity="0.5" />
                        </>
                    ) : (
                        <>
                            <circle cx="12" cy="12" r="9" fill="none" stroke={iconColor} strokeWidth="1.5" />
                            <line x1="12" y1="8" x2="12" y2="16" stroke={iconColor} strokeWidth="1.5" />
                            <line x1="8" y1="12" x2="16" y2="12" stroke={iconColor} strokeWidth="1.5" />
                        </>
                    )}
                </svg>
            </button>

            {showPopup && (
                <div ref={popupRef} style={popupStyle} onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "10px", color: "#00ffff", letterSpacing: "0.5px" }}>
                        TIDALSYNC
                    </div>

                    {inRoom ? (
                        <>
                            <div style={{ color: "#b3b3b3", marginBottom: "4px", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>
                                {info.role === "host" ? "Hosting" : "Joined"} room
                            </div>
                            <div
                                style={{
                                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                                    fontSize: "18px",
                                    fontWeight: 700,
                                    color: "#00ffff",
                                    letterSpacing: "4px",
                                    background: "#1a1a1a",
                                    padding: "8px 12px",
                                    borderRadius: "4px",
                                    textAlign: "center",
                                    marginBottom: "8px",
                                    userSelect: "all",
                                    border: "1px solid #282828",
                                }}
                            >
                                {info.roomId}
                            </div>
                            <div style={{ color: "#727272", marginBottom: "6px", fontSize: "11px" }}>
                                {info.role === "host"
                                    ? `${info.guestCount} guest${info.guestCount !== 1 ? "s" : ""}`
                                    : "Connected as guest"}
                            </div>
                            {(() => {
                                const people: { name: string; isHost?: boolean }[] = [];
                                if (info.role !== "host" && info.hostDisplayName) {
                                    people.push({ name: info.hostDisplayName, isHost: true });
                                }
                                if (info.guestNames) {
                                    for (const name of info.guestNames) {
                                        people.push({ name });
                                    }
                                }
                                if (people.length === 0) return null;
                                return (
                                    <div style={{
                                        marginBottom: "10px",
                                        background: "#1a1a1a",
                                        borderRadius: "4px",
                                        padding: "6px 8px",
                                        border: "1px solid #282828",
                                    }}>
                                        {people.map((p, i) => (
                                            <div key={i} style={{
                                                fontSize: "11px",
                                                color: "#fff",
                                                padding: "3px 0",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                            }}>
                                                <span style={{
                                                    width: "6px",
                                                    height: "6px",
                                                    borderRadius: "50%",
                                                    background: p.isHost ? "#e85d7a" : "#00ffff",
                                                    flexShrink: 0,
                                                }} />
                                                {p.name}
                                                {p.isHost && (
                                                    <span style={{ fontSize: "9px", color: "#727272", textTransform: "uppercase" as const }}>host</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                            {info.role === "host" && (
                                <label style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    marginBottom: "10px",
                                    cursor: "pointer",
                                    fontSize: "11px",
                                    color: "#b3b3b3",
                                }}>
                                    <div
                                        onClick={() => setVisible(!info.visible)}
                                        style={{
                                            width: "32px",
                                            height: "18px",
                                            borderRadius: "9px",
                                            background: info.visible ? "#00ffff" : "#333",
                                            position: "relative",
                                            transition: "background 0.2s",
                                            cursor: "pointer",
                                            flexShrink: 0,
                                        }}
                                    >
                                        <div style={{
                                            width: "14px",
                                            height: "14px",
                                            borderRadius: "50%",
                                            background: "#fff",
                                            position: "absolute",
                                            top: "2px",
                                            left: info.visible ? "16px" : "2px",
                                            transition: "left 0.2s",
                                        }} />
                                    </div>
                                    Show on website
                                </label>
                            )}
                            <button
                                style={{ ...btnBase, background: "transparent", color: "#e53935", border: "1px solid #e53935" }}
                                onClick={() => {
                                    leaveRoom();
                                    setShowPopup(false);
                                }}
                            >
                                Leave Room
                            </button>
                        </>
                    ) : (
                        <>
                            {connected ? (
                                <button
                                    style={{ ...btnBase, background: "transparent", color: "#e53935", border: "1px solid #e53935", marginBottom: "8px" }}
                                    onClick={() => {
                                        disconnectFromServer();
                                        setShowPopup(false);
                                    }}
                                >
                                    Disconnect
                                </button>
                            ) : (
                                <button
                                    style={{ ...btnBase, background: "#00ffff", color: "#000", marginBottom: "8px", opacity: isConnecting ? 0.6 : 1 }}
                                    disabled={isConnecting}
                                    onClick={() => {
                                        connectToServer();
                                    }}
                                >
                                    {isConnecting ? "Connecting..." : "Connect"}
                                </button>
                            )}
                            <div style={{ color: "#727272", marginBottom: "6px", fontSize: "10px", textAlign: "center", letterSpacing: "0.3px" }}>
                                {connected ? "Connected to server" : isConnecting ? "Connecting..." : "Disconnected"}
                            </div>
                            {connected && (
                                <>
                                    <button
                                        style={{ ...btnBase, background: "#282828", color: "#fff", marginBottom: "8px" }}
                                        disabled={!!pendingType}
                                        onClick={() => {
                                            createRoom();
                                        }}
                                    >
                                        {pendingType === "create" ? "Creating..." : "Create Room"}
                                    </button>
                                    <div style={{ color: "#727272", marginBottom: "6px", fontSize: "10px" }}>Or join existing</div>
                                    <div style={{ display: "flex", gap: "4px" }}>
                                        <input
                                            style={inputStyle}
                                            placeholder="CODE"
                                            value={joinCode}
                                            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && joinCode.trim() && !pendingType) {
                                                    joinRoom(joinCode.trim());
                                                    setJoinCode("");
                                                    setTimeout(() => setShowPopup(false), 300);
                                                }
                                            }}
                                            maxLength={8}
                                            disabled={!!pendingType}
                                        />
                                        <button
                                            style={{ ...btnBase, background: "#282828", color: "#fff", width: "auto", padding: "8px 12px", opacity: !joinCode.trim() || pendingType ? 0.6 : 1 }}
                                            disabled={!joinCode.trim() || !!pendingType}
                                            onClick={() => {
                                                if (joinCode.trim()) {
                                                    joinRoom(joinCode.trim());
                                                    setJoinCode("");
                                                    setTimeout(() => setShowPopup(false), 300);
                                                }
                                            }}
                                        >
                                            {pendingType === "join" ? "..." : "Join"}
                                        </button>
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </>
    );
};
