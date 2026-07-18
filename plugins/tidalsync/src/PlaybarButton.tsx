import React from "react";
import { getRoomInfo, leaveRoom, createRoom, joinRoom, setVisible } from "./index";
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
                prev.visible !== fresh.visible ||
                prev.hostDisplayName !== fresh.hostDisplayName ||
                JSON.stringify(prev.guestNames) !== JSON.stringify(fresh.guestNames)
                    ? fresh
                    : prev,
            );
        }, 1000);
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

    const iconColor = inRoom ? "#1db954" : "#666";
    const popupStyle: React.CSSProperties = {
        position: "absolute",
        bottom: "48px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "#1a1a2e",
        border: "1px solid #2a2a4a",
        borderRadius: "8px",
        padding: "12px",
        minWidth: "200px",
        color: "#e0e0e0",
        fontSize: "12px",
        zIndex: 9999,
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    };

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "6px 8px",
        borderRadius: "4px",
        border: "1px solid #333",
        background: "#0d0d1a",
        color: "#e0e0e0",
        fontSize: "12px",
        outline: "none",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        letterSpacing: "2px",
        textTransform: "uppercase",
        boxSizing: "border-box",
    };

    const btnBase: React.CSSProperties = {
        padding: "6px 12px",
        borderRadius: "4px",
        border: "none",
        fontSize: "11px",
        fontWeight: 600,
        cursor: "pointer",
        width: "100%",
    };

    return (
        <>
            <button
                style={btnStyle}
                title={inRoom ? `TidalSync: ${info.roomId}` : "TidalSync: Not connected"}
                onClick={() => setShowPopup(!showPopup)}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" fill={iconColor}>
                    {inRoom ? (
                        <>
                            <circle cx="8" cy="12" r="3" />
                            <circle cx="16" cy="12" r="3" />
                            <line x1="11" y1="12" x2="13" y2="12" stroke={iconColor} strokeWidth="2" />
                        </>
                    ) : (
                        <>
                            <circle cx="12" cy="12" r="3" fill="none" stroke={iconColor} strokeWidth="2" />
                            <circle cx="12" cy="12" r="8" fill="none" stroke={iconColor} strokeWidth="1.5" strokeDasharray="3 3" />
                        </>
                    )}
                </svg>
            </button>

            {showPopup && (
                <div ref={popupRef} style={popupStyle} onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "8px", color: "#1db954" }}>
                        TidalSync
                    </div>

                    {inRoom ? (
                        <>
                            <div style={{ color: "#888", marginBottom: "4px" }}>
                                {info.role === "host" ? "Hosting" : "Joined"} room
                            </div>
                            <div
                                style={{
                                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                                    fontSize: "18px",
                                    fontWeight: 700,
                                    color: "#1db954",
                                    letterSpacing: "3px",
                                    background: "#0d0d1a",
                                    padding: "6px 12px",
                                    borderRadius: "4px",
                                    textAlign: "center",
                                    marginBottom: "6px",
                                    userSelect: "all",
                                }}
                            >
                                {info.roomId}
                            </div>
                            <div style={{ color: "#666", marginBottom: "4px" }}>
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
                                        background: "rgba(255,255,255,0.03)",
                                        borderRadius: "6px",
                                        padding: "6px 8px",
                                    }}>
                                        {people.map((p, i) => (
                                            <div key={i} style={{
                                                fontSize: "11px",
                                                color: "#e0e0e0",
                                                padding: "2px 0",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                            }}>
                                                <span style={{
                                                    width: "6px",
                                                    height: "6px",
                                                    borderRadius: "50%",
                                                    background: p.isHost ? "#e85d7a" : "#1db954",
                                                    flexShrink: 0,
                                                }} />
                                                {p.name}
                                                {p.isHost && (
                                                    <span style={{ fontSize: "9px", color: "#666" }}>host</span>
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
                                    color: "#888",
                                }}>
                                    <div
                                        onClick={() => setVisible(!info.visible)}
                                        style={{
                                            width: "32px",
                                            height: "18px",
                                            borderRadius: "9px",
                                            background: info.visible ? "#1db954" : "#333",
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
                                style={{ ...btnBase, background: "#e53935", color: "#fff" }}
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
                            <button
                                style={{ ...btnBase, background: "#1db954", color: "#000", marginBottom: "8px" }}
                                disabled={!connected}
                                onClick={() => {
                                    createRoom();
                                }}
                            >
                                {connected ? "Create Room" : "Connecting..."}
                            </button>
                            <div style={{ color: "#666", marginBottom: "4px" }}>Or join existing</div>
                            <div style={{ display: "flex", gap: "4px" }}>
                                <input
                                    style={inputStyle}
                                    placeholder="CODE"
                                    value={joinCode}
                                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && joinCode.trim()) {
                                            joinRoom(joinCode.trim());
                                            setJoinCode("");
                                            setTimeout(() => setShowPopup(false), 300);
                                        }
                                    }}
                                    maxLength={8}
                                    disabled={!connected}
                                />
                                <button
                                    style={{ ...btnBase, background: "#333", color: "#ccc", width: "auto", padding: "6px 10px" }}
                                    disabled={!connected || !joinCode.trim()}
                                    onClick={() => {
                                        if (joinCode.trim()) {
                                            joinRoom(joinCode.trim());
                                            setJoinCode("");
                                            setTimeout(() => setShowPopup(false), 300);
                                        }
                                    }}
                                >
                                    Join
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </>
    );
};
