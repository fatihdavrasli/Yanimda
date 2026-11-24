import React, { useState, useEffect, useRef, useMemo } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  onDisconnect,
  remove,
} from "firebase/database";
import {
  HeartHandshake,
  Shuffle,
  Users,
  MessageCircle,
  Send,
  X,
  Trash2,
  Shield,
  Lock,
  Ban,
  Flag,
  LogOut,
  Trophy,
  Landmark,
  Newspaper,
  Coffee,
  Gamepad2,
} from "lucide-react";

const FIREBASE_CONFIG =
  typeof window !== "undefined" && window.__FIREBASE_CONFIG__
    ? window.__FIREBASE_CONFIG__
    : null;

const STORAGE_PREFIX = "yanimda_";
const DB_ROOT = "yanimda";

const SIMPLE_ROOMS = [
  { id: "futbol", title: "Futbol", icon: "trophy", badge: "Maç & Lig" },
  { id: "siyaset", title: "Siyaset", icon: "landmark", badge: "Tartışma" },
  { id: "gundem", title: "Gündem", icon: "newspaper", badge: "Canlı" },
  { id: "sohbet", title: "Sohbet", icon: "coffee", badge: "Serbest" },
  { id: "oyun", title: "Oyun", icon: "gamepad", badge: "Eğlence" },
];

const RANDOM_NICKS = [
  "Meraklı Kurt",
  "Sessiz Dalga",
  "Gece Yolcusu",
  "Hızlı Bakış",
  "Kuzey Rüzgarı",
  "Bilinmeyen Yıldız",
  "Derin Nefes",
  "Sakin Liman",
];

const WHEEL_COLORS = [
  "#2d4939",
  "#3f624d",
  "#4f6f5b",
  "#1f3529",
  "#5f7f6a",
  "#263e30",
];

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function buildSlicePath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function buildDmThreadKey(uidA, uidB) {
  return [String(uidA || ""), String(uidB || "")].sort().join("__");
}

function isReservedFdName(rawName) {
  return String(rawName || "").trim().toLocaleUpperCase("tr") === "FD";
}

function hashSecret(secret) {
  const input = `yanimda_fd_salt::${String(secret || "")}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function RoomIcon({ name, className = "w-4 h-4" }) {
  if (name === "trophy") return <Trophy className={className} />;
  if (name === "landmark") return <Landmark className={className} />;
  if (name === "newspaper") return <Newspaper className={className} />;
  if (name === "gamepad") return <Gamepad2 className={className} />;
  return <Coffee className={className} />;
}

export default function App() {
  const [nickname, setNickname] = useState(() => {
    if (typeof window === "undefined") return "Meraklı Kurt";
    return window.localStorage.getItem(`${STORAGE_PREFIX}nickname`) || "Meraklı Kurt";
  });

  const [fdPasswordInput, setFdPasswordInput] = useState("");
  const [fdPasswordConfirm, setFdPasswordConfirm] = useState("");
  const [storedFdAuth, setStoredFdAuth] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}fd_auth`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [isFdAuthenticated, setIsFdAuthenticated] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`${STORAGE_PREFIX}fd_authed`) === "1";
  });

  const [entered, setEntered] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem(`${STORAGE_PREFIX}nickname`) || "";
    const wasIn = window.localStorage.getItem(`${STORAGE_PREFIX}entered`) === "1";
    if (!wasIn || !saved.trim()) return false;
    if (isReservedFdName(saved) && window.localStorage.getItem(`${STORAGE_PREFIX}fd_authed`) !== "1") {
      return false;
    }
    return true;
  });

  const [myId] = useState(() => {
    if (typeof window === "undefined") return "ynm_guest";
    const existing = window.localStorage.getItem(`${STORAGE_PREFIX}uid`);
    if (existing) return existing;
    const created = "ynm_" + Math.random().toString(36).slice(2, 9);
    window.localStorage.setItem(`${STORAGE_PREFIX}uid`, created);
    return created;
  });

  const [loginError, setLoginError] = useState("");
  const [activeRoom, setActiveRoom] = useState("futbol");
  const [viewMode, setViewMode] = useState("room");
  const [statusNotice, setStatusNotice] = useState("");

  const [wheelOpen, setWheelOpen] = useState(false);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelWinner, setWheelWinner] = useState(null);
  const wheelTimerRef = useRef(null);

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [bannedUsers, setBannedUsers] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}banned_users`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [reportsList, setReportsList] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}reports`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [reportTargetUser, setReportTargetUser] = useState(null);
  const [reportReason, setReportReason] = useState("");

  const [chatMessages, setChatMessages] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}chat`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [chatInput, setChatInput] = useState("");

  const [dmPeer, setDmPeer] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [dmInput, setDmInput] = useState("");

  const dbRef = useRef(null);
  const chatBottomRef = useRef(null);
  const dmBottomRef = useRef(null);

  const typingFdName = isReservedFdName(nickname);
  const isFdAdmin = entered && isReservedFdName(nickname) && isFdAuthenticated;
  const isMyBanned = Boolean(bannedUsers && bannedUsers[myId]);

  useEffect(() => {
    return () => {
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}nickname`, nickname);
    window.localStorage.setItem(`${STORAGE_PREFIX}entered`, entered ? "1" : "0");
    window.localStorage.setItem(`${STORAGE_PREFIX}fd_authed`, isFdAuthenticated ? "1" : "0");
  }, [nickname, entered, isFdAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}chat`, JSON.stringify(chatMessages.slice(-150)));
  }, [chatMessages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}banned_users`, JSON.stringify(bannedUsers));
  }, [bannedUsers]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}reports`, JSON.stringify(reportsList.slice(-80)));
  }, [reportsList]);

  useEffect(() => {
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL) return;
    try {
      const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
      dbRef.current = getDatabase(app);
    } catch (err) {
      console.error("Yanimda Firebase başlatılamadı:", err);
    }
  }, []);

  useEffect(() => {
    if (!dbRef.current) return;
    const unsubFdAuth = onValue(ref(dbRef.current, `${DB_ROOT}/admin_config/fd`), (snap) => {
      const val = snap.val();
      if (val && val.passwordHash) {
        setStoredFdAuth(val);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(`${STORAGE_PREFIX}fd_auth`, JSON.stringify(val));
        }
      }
    });

    const unsubBans = onValue(ref(dbRef.current, `${DB_ROOT}/banned_users`), (snap) => {
      const val = snap.val() || {};
      setBannedUsers(val);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`${STORAGE_PREFIX}banned_users`, JSON.stringify(val));
      }
    });

    const unsubReports = onValue(ref(dbRef.current, `${DB_ROOT}/reports`), (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val)
        .map(([fbKey, item]) => ({ id: item?.id || fbKey, fbKey, ...item }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 80);
      setReportsList(arr);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`${STORAGE_PREFIX}reports`, JSON.stringify(arr));
      }
    });

    return () => {
      unsubFdAuth();
      unsubBans();
      unsubReports();
    };
  }, []);

  useEffect(() => {
    if (!isMyBanned || isFdAdmin) return;
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/users/${myId}`));
    }
    setDmPeer(null);
    setWheelOpen(false);
    setEntered(false);
    setLoginError("Yönetici (FD) tarafından sistemden uzaklaştırıldınız.");
  }, [isMyBanned, isFdAdmin, myId]);

  useEffect(() => {
    if (!entered) return;
    const cleanName = isReservedFdName(nickname) ? "FD" : nickname.trim();
    if (!cleanName) return;

    if (dbRef.current) {
      const userRef = ref(dbRef.current, `${DB_ROOT}/users/${myId}`);
      set(userRef, {
        id: myId,
        name: cleanName,
        room: activeRoom,
        isAdmin: isFdAdmin,
        updatedAt: Date.now(),
      });
      onDisconnect(userRef).remove();

      const unsubUsers = onValue(ref(dbRef.current, `${DB_ROOT}/users`), (snap) => {
        const val = snap.val() || {};
        setOnlineUsers(Object.values(val).filter((u) => u && u.id));
      });

      const unsubChat = onValue(ref(dbRef.current, `${DB_ROOT}/chat`), (snap) => {
        const val = snap.val() || {};
        const arr = Object.entries(val)
          .map(([fbKey, item]) => ({ id: item?.id || fbKey, fbKey, ...item }))
          .sort((a, b) => (a.ts || 0) - (b.ts || 0))
          .slice(-150);
        setChatMessages(arr);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(`${STORAGE_PREFIX}chat`, JSON.stringify(arr));
        }
      });

      return () => {
        unsubUsers();
        unsubChat();
      };
    }
  }, [entered, nickname, activeRoom, isFdAdmin, myId]);

  useEffect(() => {
    if (!entered || !dmPeer || !dmPeer.id) {
      setDmMessages([]);
      return;
    }
    if (!dbRef.current) return;
    const threadKey = buildDmThreadKey(myId, dmPeer.id);
    const threadRef = ref(dbRef.current, `${DB_ROOT}/dms/${threadKey}`);
    return onValue(threadRef, (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val)
        .map(([fbKey, item]) => ({ id: item?.id || fbKey, fbKey, ...item }))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setDmMessages(arr.slice(-100));
    });
  }, [entered, dmPeer, myId]);

  useEffect(() => {
    if (viewMode === "room" && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, activeRoom, viewMode]);

  useEffect(() => {
    if (dmPeer && dmBottomRef.current) {
      dmBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [dmMessages, dmPeer]);

  const activeRealUsers = useMemo(() => {
    const map = new Map();
    onlineUsers.forEach((u) => {
      if (u && u.id && !bannedUsers[u.id]) {
        map.set(u.id, u);
      }
    });
    if (entered && !isMyBanned) {
      map.set(myId, {
        id: myId,
        name: isFdAdmin ? "FD" : nickname.trim() || "Misafir",
        room: activeRoom,
        isAdmin: isFdAdmin,
      });
    }
    return Array.from(map.values());
  }, [onlineUsers, bannedUsers, entered, isMyBanned, myId, isFdAdmin, nickname, activeRoom]);

  const otherRealUsers = useMemo(() => {
    return activeRealUsers.filter((u) => u.id !== myId);
  }, [activeRealUsers, myId]);

  const realOnlineCount = activeRealUsers.length;

  const currentRoomObj = useMemo(
    () => SIMPLE_ROOMS.find((r) => r.id === activeRoom) || SIMPLE_ROOMS[0],
    [activeRoom]
  );

  const currentRoomMessages = useMemo(() => {
    return chatMessages.filter((m) => (m.room || "futbol") === activeRoom);
  }, [chatMessages, activeRoom]);

  function handleRandomNick() {
    if (isReservedFdName(nickname)) return;
    const candidates = RANDOM_NICKS.filter((n) => n !== nickname.trim());
    const picked = candidates[Math.floor(Math.random() * candidates.length)] || RANDOM_NICKS[0];
    setNickname(picked);
  }

  function handleEnter(e) {
    if (e) e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setLoginError("Lütfen bir takma ad gir.");
      return;
    }
    if (isMyBanned && !isReservedFdName(trimmed)) {
      setLoginError("Bu hesap yönetici tarafından engellenmiştir.");
      return;
    }
    if (isReservedFdName(trimmed)) {
      const pass = fdPasswordInput.trim();
      if (pass.length < 4) {
        setLoginError("FD hesabı için en az 4 karakterli parola gir.");
        return;
      }
      const incomingHash = hashSecret(pass);
      if (!storedFdAuth || !storedFdAuth.passwordHash) {
        if (fdPasswordConfirm.trim() !== pass) {
          setLoginError("FD parola tekrarı eşleşmiyor.");
          return;
        }
        const authRecord = { passwordHash: incomingHash, ownerId: myId, createdAt: Date.now() };
        setStoredFdAuth(authRecord);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(`${STORAGE_PREFIX}fd_auth`, JSON.stringify(authRecord));
        }
        if (dbRef.current) {
          set(ref(dbRef.current, `${DB_ROOT}/admin_config/fd`), authRecord);
        }
        setNickname("FD");
        setIsFdAuthenticated(true);
        setLoginError("");
        setEntered(true);
        setStatusNotice("FD sınırsız yetki aktif.");
        return;
      }
      if (incomingHash !== storedFdAuth.passwordHash) {
        setLoginError("FD kullanıcı adı korumalıdır. Parola hatalı.");
        return;
      }
      setNickname("FD");
      setIsFdAuthenticated(true);
      setLoginError("");
      setEntered(true);
      setStatusNotice("FD sınırsız yetki aktif.");
      return;
    }
    setIsFdAuthenticated(false);
    setNickname(trimmed);
    setLoginError("");
    setEntered(true);
    setStatusNotice("");
  }

  function handleLogout() {
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/users/${myId}`));
    }
    setDmPeer(null);
    setWheelOpen(false);
    setEntered(false);
  }

  function spinWheelWithCandidates(candidates) {
    if (!candidates || candidates.length === 0 || wheelSpinning) return;
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);

    setWheelWinner(null);
    setWheelSpinning(true);

    const sliceDeg = 360 / candidates.length;
    const winIdx = Math.floor(Math.random() * candidates.length);
    const chosen = candidates[winIdx];

    const sliceCenterDeg = winIdx * sliceDeg + sliceDeg / 2;
    const targetMod = (360 - (sliceCenterDeg % 360) + 360) % 360;
    const currentMod = ((wheelRotation % 360) + 360) % 360;
    const deltaToTarget = (targetMod - currentMod + 360) % 360;
    const fullSpins = 5 * 360;
    const nextRotation = wheelRotation + fullSpins + deltaToTarget;

    setWheelRotation(nextRotation);

    wheelTimerRef.current = setTimeout(() => {
      setWheelSpinning(false);
      setWheelWinner(chosen);
      setStatusNotice(`${chosen.name} ile eşleşildi.`);
    }, 3400);
  }

  function handleQuickMatch() {
    if (!entered) {
      const trimmed = nickname.trim();
      if (!trimmed) {
        setLoginError("Lütfen bir takma ad gir.");
        return;
      }
      if (isReservedFdName(trimmed) && !isFdAuthenticated) {
        handleEnter();
        return;
      }
      setEntered(true);
    }

    if (otherRealUsers.length === 0) {
      setWheelWinner(null);
      setWheelOpen(true);
      setStatusNotice("Şu an çevrimiçi başka kullanıcı yok.");
      return;
    }

    setWheelOpen(true);
    spinWheelWithCandidates(otherRealUsers);
  }

  function handleSendRoomMessage(e) {
    e.preventDefault();
    const clean = chatInput.trim();
    if (!clean) return;
    setChatInput("");
    const msg = {
      id: "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      room: activeRoom,
      senderId: myId,
      senderName: isFdAdmin ? "FD" : nickname.trim(),
      isAdminMsg: isFdAdmin,
      text: clean,
      ts: Date.now(),
    };
    if (dbRef.current) {
      push(ref(dbRef.current, `${DB_ROOT}/chat`), msg);
    } else {
      setChatMessages((prev) => {
        const next = [...prev.slice(-149), msg];
        if (typeof window !== "undefined") {
          window.localStorage.setItem(`${STORAGE_PREFIX}chat`, JSON.stringify(next));
        }
        return next;
      });
    }
  }

  function handleDeleteRoomMessage(msg) {
    if (!isFdAdmin || !msg) return;
    const next = chatMessages.filter((m) => m.id !== msg.id && m.fbKey !== msg.fbKey);
    setChatMessages(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${STORAGE_PREFIX}chat`, JSON.stringify(next));
    }
    if (dbRef.current) {
      const keyToDelete = msg.fbKey || msg.id;
      if (keyToDelete) remove(ref(dbRef.current, `${DB_ROOT}/chat/${keyToDelete}`));
    }
    setStatusNotice("Mesaj silindi.");
  }

  function handleDismissReport(rep) {
    if (!rep) return;
    const next = reportsList.filter((x) => x.id !== rep.id && x.fbKey !== rep.fbKey);
    setReportsList(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${STORAGE_PREFIX}reports`, JSON.stringify(next));
    }
    if (dbRef.current) {
      const keyToDelete = rep.fbKey || rep.id;
      if (keyToDelete) remove(ref(dbRef.current, `${DB_ROOT}/reports/${keyToDelete}`));
    }
  }

  function handleSubmitReport(e) {
    e.preventDefault();
    if (!reportTargetUser) return;
    const entry = {
      id: "rep_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      targetId: reportTargetUser.id,
      targetName: reportTargetUser.name,
      reporterId: myId,
      reporterName: isFdAdmin ? "FD" : nickname.trim(),
      reason: reportReason.trim() || "Uygunsuz mesaj / davranış",
      ts: Date.now(),
    };
    if (dbRef.current) {
      push(ref(dbRef.current, `${DB_ROOT}/reports`), entry);
    } else {
      setReportsList((prev) => {
        const next = [entry, ...prev.slice(0, 79)];
        if (typeof window !== "undefined") {
          window.localStorage.setItem(`${STORAGE_PREFIX}reports`, JSON.stringify(next));
        }
        return next;
      });
    }
    setReportTargetUser(null);
    setReportReason("");
    setStatusNotice(`${reportTargetUser.name} şikayet edildi.`);
  }

  function handleBanUser(targetUser, repToClear = null) {
    if (!isFdAdmin || !targetUser || !targetUser.id || targetUser.id === myId) return;
    const banRec = {
      id: targetUser.id,
      name: targetUser.name || "Kullanıcı",
      bannedBy: "FD",
      bannedAt: Date.now(),
    };
    const nextBans = { ...bannedUsers, [targetUser.id]: banRec };
    setBannedUsers(nextBans);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${STORAGE_PREFIX}banned_users`, JSON.stringify(nextBans));
    }
    if (dbRef.current) {
      set(ref(dbRef.current, `${DB_ROOT}/banned_users/${targetUser.id}`), banRec);
      remove(ref(dbRef.current, `${DB_ROOT}/users/${targetUser.id}`));
    }
    if (repToClear) handleDismissReport(repToClear);
    setStatusNotice(`${banRec.name} banlandı.`);
  }

  function handleUnbanUser(userId) {
    if (!isFdAdmin || !userId) return;
    setBannedUsers((prev) => {
      const next = { ...prev };
      delete next[userId];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`${STORAGE_PREFIX}banned_users`, JSON.stringify(next));
      }
      return next;
    });
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/banned_users/${userId}`));
    }
    setStatusNotice("Ban kaldırıldı.");
  }

  function handleSendDm(e) {
    e.preventDefault();
    if (!dmPeer || !dmPeer.id || !dmInput.trim()) return;
    const clean = dmInput.trim();
    setDmInput("");
    const msg = {
      id: "dm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      senderId: myId,
      senderName: isFdAdmin ? "FD" : nickname.trim(),
      recipientId: dmPeer.id,
      text: clean,
      ts: Date.now(),
    };
    if (dbRef.current) {
      push(ref(dbRef.current, `${DB_ROOT}/dms/${buildDmThreadKey(myId, dmPeer.id)}`), msg);
    } else {
      setDmMessages((prev) => [...prev.slice(-99), msg]);
    }
  }  function renderWheelModal() {
    if (!wheelOpen) return null;
    const count = otherRealUsers.length;
    const sliceDeg = count > 0 ? 360 / count : 360;

    return (
      <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-[#f5f5f0] border border-[#e2e4dc] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-[#1c2420]">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-[#18201c]">Rastgele Eşleşme Çarkı</h3>
            <button
              type="button"
              disabled={wheelSpinning}
              onClick={() => {
                setWheelOpen(false);
                setWheelWinner(null);
              }}
              className="p-1.5 rounded-xl bg-white border border-[#e2e4dc] text-[#4a5a51] disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {count === 0 ? (
            <div className="bg-white border border-[#e2e4dc] rounded-2xl p-6 text-center space-y-2">
              <p className="text-xs font-bold text-[#18201c]">
                Çarkta gösterilecek başka çevrimiçi kişi yok.
              </p>
              <p className="text-[11px] text-[#6d7a72]">
                Başka bir tarayıcı veya cihazdan giriş yapıldığında isimler çarkta görünür.
              </p>
            </div>
          ) : (
            <>
              <div className="relative w-64 h-64 mx-auto flex items-center justify-center">
                <div
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[18px] border-t-[#18201c]"
                />

                <div
                  className="w-full h-full rounded-full overflow-hidden border-4 border-white shadow-lg"
                  style={{
                    transform: `rotate(${wheelRotation}deg)`,
                    transition: wheelSpinning
                      ? "transform 3.4s cubic-bezier(0.14, 0.85, 0.22, 1)"
                      : "none",
                  }}
                >
                  <svg viewBox="0 0 240 240" className="w-full h-full">
                    {otherRealUsers.map((u, idx) => {
                      const startDeg = idx * sliceDeg;
                      const endDeg = (idx + 1) * sliceDeg;
                      const midDeg = startDeg + sliceDeg / 2;
                      const labelPos = polarToCartesian(120, 120, 74, midDeg);
                      const shortName = String(u.name || "Üye").slice(0, 11);
                      return (
                        <g key={u.id}>
                          <path
                            d={buildSlicePath(120, 120, 116, startDeg, endDeg)}
                            fill={WHEEL_COLORS[idx % WHEEL_COLORS.length]}
                            stroke="#f5f5f0"
                            strokeWidth="1.5"
                          />
                          <text
                            x={labelPos.x}
                            y={labelPos.y}
                            fill="#ffffff"
                            fontSize={count > 8 ? "8" : "10"}
                            fontWeight="700"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            transform={`rotate(${midDeg - 90}, ${labelPos.x}, ${labelPos.y})`}
                          >
                            {shortName}
                          </text>
                        </g>
                      );
                    })}
                    <circle cx="120" cy="120" r="18" fill="#ffffff" stroke="#2d4939" strokeWidth="3" />
                  </svg>
                </div>
              </div>

              <div className="text-center min-h-11 flex flex-col items-center justify-center">
                {wheelSpinning ? (
                  <p className="text-xs font-bold text-[#2d4939]">Çark dönüyor, kişi seçiliyor...</p>
                ) : wheelWinner ? (
                  <div className="space-y-2 w-full">
                    <p className="text-xs font-extrabold text-[#18201c]">
                      Eşleşme: <span className="text-[#2d4939]">{wheelWinner.name}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => spinWheelWithCandidates(otherRealUsers)}
                        className="py-2.5 rounded-xl bg-white border border-[#dce0d8] text-xs font-bold text-[#1c2420]"
                      >
                        Tekrar Çevir
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const target = wheelWinner;
                          setWheelOpen(false);
                          setWheelWinner(null);
                          setDmPeer(target);
                        }}
                        className="py-2.5 rounded-xl bg-[#2d4939] text-white text-xs font-bold"
                      >
                        Sohbete Başla →
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => spinWheelWithCandidates(otherRealUsers)}
                    className="w-full py-2.5 rounded-xl bg-[#2d4939] text-white text-xs font-bold"
                  >
                    Çarkı Çevir
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!entered) {
    const needsFirstTimeFdSetup = typingFdName && (!storedFdAuth || !storedFdAuth.passwordHash);

    return (
      <div className="min-h-screen bg-[#f5f5f0] text-[#1c2420] flex flex-col justify-between p-5">
        <header className="max-w-md w-full mx-auto flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <HeartHandshake className="w-6 h-6 text-[#2f4d3b]" />
            <span className="text-xl font-extrabold tracking-tight text-[#1c2420]">Yanimda</span>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#e2e4dc] text-xs font-semibold text-[#3a4940]">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {realOnlineCount} çevrimiçi
          </span>
        </header>

        <main className="max-w-md w-full mx-auto space-y-5 my-auto py-6">
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#e2e4dc] shadow-sm">
              <input
                type="text"
                maxLength={22}
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  if (loginError) setLoginError("");
                }}
                placeholder="Takma adın..."
                className="bg-transparent text-sm font-bold text-[#1c2420] focus:outline-none w-36 text-center"
              />
              {!typingFdName && (
                <button
                  type="button"
                  onClick={handleRandomNick}
                  title="Rasgele takma ad seç"
                  className="p-1 rounded-lg text-[#5a6960] hover:bg-[#f0f1eb]"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="text-center space-y-2.5">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[#18201c] leading-tight">
              Önce oda,
              <br />
              sonra sohbet.
            </h1>
            <p className="text-sm text-[#56635c] max-w-xs mx-auto leading-relaxed">
              Her şey <strong className="text-[#18201c]">Yanimda</strong>&apos;yla başlar. Rastgele biriyle eşleş ya da futbol, siyaset veya gündem odasına gir.
            </p>
          </div>

          {typingFdName && (
            <div className="bg-white border border-amber-300 rounded-2xl p-4 space-y-2.5 shadow-sm">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-800">
                <Lock className="w-4 h-4" />
                {needsFirstTimeFdSetup ? "FD Yönetici Parolası Oluştur" : "FD Parola Girişi"}
              </div>
              <input
                type="password"
                value={fdPasswordInput}
                onChange={(e) => {
                  setFdPasswordInput(e.target.value);
                  if (loginError) setLoginError("");
                }}
                placeholder={needsFirstTimeFdSetup ? "Yeni FD parolası..." : "FD parolan..."}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f8f8f4] border border-[#dce0d8] text-sm text-[#18201c] focus:outline-none focus:border-[#2f4d3b]"
              />
              {needsFirstTimeFdSetup && (
                <input
                  type="password"
                  value={fdPasswordConfirm}
                  onChange={(e) => {
                    setFdPasswordConfirm(e.target.value);
                    if (loginError) setLoginError("");
                  }}
                  placeholder="FD parolasını tekrar gir..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f8f8f4] border border-[#dce0d8] text-sm text-[#18201c] focus:outline-none focus:border-[#2f4d3b]"
                />
              )}
            </div>
          )}

          {loginError && (
            <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-2.5 text-center">
              {loginError}
            </p>
          )}

          <button
            type="button"
            onClick={handleQuickMatch}
            disabled={!nickname.trim()}
            className="w-full py-4 rounded-2xl bg-[#2d4939] hover:bg-[#243c2e] disabled:opacity-40 text-white font-bold text-base flex items-center justify-center gap-2 shadow-sm transition"
          >
            <span>Rastgele Eşleş</span>
            <span>→</span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={(e) => {
                setViewMode("people");
                handleEnter(e);
              }}
              className="py-3.5 px-4 rounded-2xl bg-white hover:bg-[#fafaf7] border border-[#e2e4dc] text-sm font-bold text-[#1c2420] flex items-center justify-center gap-2 shadow-sm transition"
            >
              <Users className="w-4 h-4 text-[#4a5a51]" />
              <span>Kişiler</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                setViewMode("room");
                handleEnter(e);
              }}
              className="py-3.5 px-4 rounded-2xl bg-white hover:bg-[#fafaf7] border border-[#e2e4dc] text-sm font-bold text-[#1c2420] flex items-center justify-center gap-2 shadow-sm transition"
            >
              <MessageCircle className="w-4 h-4 text-[#4a5a51]" />
              <span>Odalar</span>
            </button>
          </div>

          <div className="pt-2 space-y-2.5">
            <div className="flex items-center gap-3 text-[11px] font-bold tracking-widest uppercase text-[#7a867f]">
              <span className="h-px flex-1 bg-[#e0e2da]" />
              <span>Sohbet Odaları</span>
              <span className="h-px flex-1 bg-[#e0e2da]" />
            </div>

            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {SIMPLE_ROOMS.map((rm) => (
                <button
                  key={rm.id}
                  type="button"
                  onClick={(e) => {
                    setActiveRoom(rm.id);
                    setViewMode("room");
                    handleEnter(e);
                  }}
                  className="bg-white hover:bg-[#fafaf7] border border-[#e2e4dc] rounded-2xl px-4 py-3 flex items-center gap-2.5 shrink-0 shadow-sm transition"
                >
                  <span className="w-8 h-8 rounded-xl bg-[#f1f3ec] text-[#2d4939] flex items-center justify-center">
                    <RoomIcon name={rm.icon} className="w-4 h-4" />
                  </span>
                  <div className="text-left">
                    <div className="text-xs font-extrabold text-[#18201c]">{rm.title}</div>
                    <div className="text-[10px] text-[#6d7a72]">{rm.badge}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </main>

        <footer className="max-w-md w-full mx-auto text-center text-[11px] text-[#78847d]">
          Yanimda • Gerçek çevrimiçi topluluk
        </footer>

        {renderWheelModal()}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1c2420] flex flex-col justify-between pb-6">
      <div className="max-w-md w-full mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 min-w-0">
            <HeartHandshake className="w-6 h-6 text-[#2f4d3b] shrink-0" />
            <span className="text-lg font-black tracking-tight text-[#18201c] truncate">
              Yanimda
            </span>
            {isFdAdmin && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-[10px] font-extrabold text-amber-900 shrink-0">
                <Shield className="w-3 h-3" />
                FD
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#e2e4dc] text-xs font-semibold text-[#3a4940]">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {realOnlineCount} çevrimiçi
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="p-2 rounded-full bg-white hover:bg-[#fafaf7] border border-[#e2e4dc] text-[#4a5a51]"
              title="Çıkış"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {statusNotice && (
          <div className="bg-white border border-[#dce0d8] rounded-2xl px-3.5 py-2 flex items-center justify-between text-xs text-[#28352e] shadow-sm">
            <span>{statusNotice}</span>
            <button
              type="button"
              onClick={() => setStatusNotice("")}
              className="text-[#6d7a72] hover:text-[#18201c]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {isFdAdmin && (
          <section className="bg-white border border-amber-300 rounded-2xl p-3.5 space-y-2.5 shadow-sm">
            <div className="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
              <Shield className="w-4 h-4" />
              FD Yönetim ({reportsList.length} Şikayet)
            </div>
            {reportsList.length === 0 ? (
              <p className="text-xs text-[#6d7a72]">Aktif şikayet yok.</p>
            ) : (
              <div className="space-y-2 max-h-36 overflow-y-auto">
                {reportsList.map((rep) => (
                  <div
                    key={rep.fbKey || rep.id}
                    className="bg-[#f8f8f4] border border-[#e4e6de] rounded-xl p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#18201c] truncate">
                        {rep.targetName}{" "}
                        <span className="font-normal text-[#6d7a72]">({rep.reporterName})</span>
                      </div>
                      <div className="text-[11px] text-[#4f5d55] truncate">{rep.reason}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleBanUser({ id: rep.targetId, name: rep.targetName }, rep)}
                        className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-[11px] font-bold text-white flex items-center gap-1"
                      >
                        <Ban className="w-3 h-3" />
                        Banla
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismissReport(rep)}
                        className="p-1 rounded-lg bg-[#e9ece5] text-[#3a4940]"
                        title="Kapat"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(bannedUsers).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[#eceee7]">
                {Object.values(bannedUsers).map((b) => (
                  <span
                    key={b.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#f5f5f0] text-[11px] text-[#3a4940]"
                  >
                    {b.name}
                    <button
                      type="button"
                      onClick={() => handleUnbanUser(b.id)}
                      className="font-bold text-[#2d4939] underline"
                    >
                      Kaldır
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="text-center space-y-2 py-1">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-[#e2e4dc] text-xs font-bold text-[#1c2420] shadow-sm">
            <span>{isFdAdmin ? "FD" : nickname.trim()}</span>
            <span className="text-[#8a968f]">•</span>
            <span className="text-[#2d4939]">{currentRoomObj.title}</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-[#18201c]">
            {currentRoomObj.title} Odası
          </h2>
        </div>

        <button
          type="button"
          onClick={handleQuickMatch}
          className="w-full py-3.5 rounded-2xl bg-[#2d4939] hover:bg-[#243c2e] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition"
        >
          <Shuffle className="w-4 h-4" />
          <span>Rastgele Eşleş</span>
          <span>→</span>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setViewMode("people")}
            className={`py-3 px-4 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-2 transition ${
              viewMode === "people"
                ? "bg-[#18201c] text-white border-[#18201c]"
                : "bg-white text-[#1c2420] border-[#e2e4dc]"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Kişiler ({otherRealUsers.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("room")}
            className={`py-3 px-4 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-2 transition ${
              viewMode === "room"
                ? "bg-[#18201c] text-white border-[#18201c]"
                : "bg-white text-[#1c2420] border-[#e2e4dc]"
            }`}
          >
            <MessageCircle className="w-4 h-4" />
            <span>Oda Sohbeti</span>
          </button>
        </div>

        {viewMode === "people" ? (
          <div className="bg-white border border-[#e2e4dc] rounded-2xl p-3.5 space-y-2.5 shadow-sm">
            {otherRealUsers.length === 0 ? (
              <p className="text-xs text-[#6d7a72] text-center py-8">
                Şu an aktif başka kişi yok. Başka bir giriş yaptığında burada görünür.
              </p>
            ) : (
              otherRealUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-2 bg-[#f8f8f4] border border-[#e7e9e2] rounded-xl px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-[#18201c] truncate">{u.name}</div>
                    <div className="text-[11px] text-[#6d7a72]">Çevrimiçi</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDmPeer(u)}
                      className="px-3 py-1.5 rounded-xl bg-[#2d4939] text-white text-xs font-bold"
                    >
                      Mesaj
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReportTargetUser(u);
                        setReportReason("");
                      }}
                      className="p-1.5 rounded-xl bg-white border border-[#dce0d8] text-amber-700"
                      title="Şikayet Et"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                    {isFdAdmin && (
                      <button
                        type="button"
                        onClick={() => handleBanUser(u)}
                        className="p-1.5 rounded-xl bg-rose-600 text-white"
                        title="Banla"
                      >
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="bg-white border border-[#e2e4dc] rounded-2xl p-3.5 space-y-3 shadow-sm">
            <div className="h-64 overflow-y-auto space-y-2 pr-1">
              {currentRoomMessages.length === 0 ? (
                <p className="text-xs text-[#78847d] text-center py-12">
                  {currentRoomObj.title} odasında henüz mesaj yok. İlk mesajı yaz!
                </p>
              ) : (
                currentRoomMessages.map((m) => {
                  const mine = m.senderId === myId;
                  return (
                    <div
                      key={m.fbKey || m.id}
                      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                    >
                      <div className="flex items-center gap-1.5 px-1 mb-0.5">
                        <span className="text-[10px] font-semibold text-[#6d7a72]">
                          {mine ? "Sen" : m.senderName}
                        </span>
                        {!mine && (
                          <button
                            type="button"
                            onClick={() => {
                              setReportTargetUser({ id: m.senderId, name: m.senderName });
                              setReportReason("");
                            }}
                            className="p-0.5 text-amber-700"
                            title="Şikayet Et"
                          >
                            <Flag className="w-3 h-3" />
                          </button>
                        )}
                        {isFdAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDeleteRoomMessage(m)}
                            className="p-0.5 text-rose-600"
                            title="Mesajı Sil"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        {isFdAdmin && !mine && (
                          <button
                            type="button"
                            onClick={() => handleBanUser({ id: m.senderId, name: m.senderName })}
                            className="p-0.5 text-rose-700"
                            title="Banla"
                          >
                            <Ban className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <div
                        className={`px-3.5 py-2 rounded-2xl text-xs max-w-[82%] ${
                          mine
                            ? "bg-[#2d4939] text-white font-medium rounded-br-sm"
                            : "bg-[#f2f3ed] text-[#18201c] rounded-bl-sm"
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            <form onSubmit={handleSendRoomMessage} className="flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={`${currentRoomObj.title} odasına yaz...`}
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#f8f8f4] border border-[#dce0d8] text-xs text-[#18201c] focus:outline-none focus:border-[#2d4939]"
              />
              <button
                type="submit"
                className="p-2.5 rounded-xl bg-[#2d4939] hover:bg-[#243c2e] text-white"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        <div className="pt-1 space-y-2">
          <div className="flex items-center gap-3 text-[11px] font-bold tracking-widest uppercase text-[#7a867f]">
            <span className="h-px flex-1 bg-[#e0e2da]" />
            <span>Sohbet Odaları</span>
            <span className="h-px flex-1 bg-[#e0e2da]" />
          </div>

          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {SIMPLE_ROOMS.map((rm) => {
              const selected = activeRoom === rm.id;
              return (
                <button
                  key={rm.id}
                  type="button"
                  onClick={() => {
                    setActiveRoom(rm.id);
                    setViewMode("room");
                  }}
                  className={`rounded-2xl px-4 py-3 flex items-center gap-2.5 shrink-0 border transition ${
                    selected
                      ? "bg-[#2d4939] text-white border-[#2d4939]"
                      : "bg-white text-[#18201c] border-[#e2e4dc]"
                  }`}
                >
                  <RoomIcon name={rm.icon} className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-extrabold">{rm.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {renderWheelModal()}

      {reportTargetUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitReport}
            className="bg-white border border-[#e2e4dc] rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#18201c]">
                {reportTargetUser.name} Şikayet Et
              </h3>
              <button type="button" onClick={() => setReportTargetUser(null)}>
                <X className="w-4 h-4 text-[#6d7a72]" />
              </button>
            </div>
            <input
              type="text"
              maxLength={120}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Şikayet sebebi..."
              className="w-full px-3.5 py-2 rounded-xl bg-[#f8f8f4] border border-[#dce0d8] text-xs text-[#18201c]"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReportTargetUser(null)}
                className="py-2 rounded-xl bg-[#f0f1eb] text-xs font-bold text-[#3a4940]"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="py-2 rounded-xl bg-[#2d4939] text-xs font-bold text-white"
              >
                Gönder
              </button>
            </div>
          </form>
        </div>
      )}

      {dmPeer && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white border border-[#e2e4dc] rounded-2xl max-w-md w-full p-4 space-y-3 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#eceee7] pb-2">
              <h3 className="text-sm font-extrabold text-[#18201c]">{dmPeer.name}</h3>
              <button
                type="button"
                onClick={() => setDmPeer(null)}
                className="p-1 rounded-lg bg-[#f0f1eb] text-[#3a4940]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="h-56 overflow-y-auto space-y-2 pr-1">
              {dmMessages.length === 0 ? (
                <p className="text-xs text-[#78847d] text-center py-10">
                  {dmPeer.name} ile özel sohbeti başlat.
                </p>
              ) : (
                dmMessages.map((m) => {
                  const mine = m.senderId === myId;
                  return (
                    <div
                      key={m.fbKey || m.id}
                      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`px-3 py-2 rounded-2xl text-xs max-w-[82%] ${
                          mine
                            ? "bg-[#2d4939] text-white rounded-br-sm"
                            : "bg-[#f2f3ed] text-[#18201c] rounded-bl-sm"
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={dmBottomRef} />
            </div>

            <form onSubmit={handleSendDm} className="flex items-center gap-2">
              <input
                type="text"
                value={dmInput}
                onChange={(e) => setDmInput(e.target.value)}
                placeholder={`${dmPeer.name} kişisine mesaj yaz...`}
                className="flex-1 px-3.5 py-2 rounded-xl bg-[#f8f8f4] border border-[#dce0d8] text-xs text-[#18201c]"
              />
              <button
                type="submit"
                className="p-2 rounded-xl bg-[#2d4939] text-white"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

