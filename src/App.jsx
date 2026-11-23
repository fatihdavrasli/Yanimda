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
  update,
} from "firebase/database";
import {
  HeartHandshake,
  Users,
  MessageCircle,
  Send,
  Sparkles,
  LogOut,
  CheckCircle2,
  MapPin,
  Trash2,
  Flame,
  Radio,
  Search,
  Shuffle,
  Bell,
  X,
  Shield,
  Lock,
  Ban,
  Flag,
} from "lucide-react";

const FIREBASE_CONFIG =
  typeof window !== "undefined" && window.__FIREBASE_CONFIG__
    ? window.__FIREBASE_CONFIG__
    : null;

const STORAGE_PREFIX = "yanimda_";
const DB_ROOT = "yanimda";

const STATUS_TAGS = [
  { id: "musait", label: "Yanındayım", badge: "Müsait", dot: "bg-emerald-400" },
  { id: "sohbet", label: "Sohbete Açık", badge: "Sohbet", dot: "bg-sky-400" },
  { id: "destek", label: "Yardım / İstek", badge: "Destek", dot: "bg-amber-400" },
  { id: "mesgul", label: "Kısa Mola", badge: "Mola", dot: "bg-rose-400" },
];

const ROOM_CHANNELS = [
  { id: "genel", title: "Genel Meydan", tag: "Canlı", desc: "Türkiye & Dünya ortak sohbeti" },
  { id: "turkiye", title: "Türkiye Nabzı", tag: "TR", desc: "Gündem, şehirler ve sıcak muhabbet" },
  { id: "global", title: "Global Lounge", tag: "World", desc: "Uluslararası tanışma & sohbet" },
  { id: "gece_kusu", title: "Gece Kuşları", tag: "24/7", desc: "Uykusuzlar ve akşam sohbeti" },
];

const QUICK_REACTIONS = ["🔥", "👏", "❤️", "😂", "⚡"];

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

function formatTime(ts) {
  const n = Number(ts || 0);
  if (!n) return "Az önce";
  const diffSec = Math.max(0, Math.floor((Date.now() - n) / 1000));
  if (diffSec < 60) return "Az önce";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} sa önce`;
  return `${Math.floor(diffHr / 24)} gün önce`;
}

export default function App() {
  const [nickname, setNickname] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(`${STORAGE_PREFIX}nickname`) || "";
  });

  const [cityTag, setCityTag] = useState(() => {
    if (typeof window === "undefined") return "Körfez";
    return window.localStorage.getItem(`${STORAGE_PREFIX}city`) || "Körfez";
  });

  const [statusTag, setStatusTag] = useState(() => {
    if (typeof window === "undefined") return "musait";
    return window.localStorage.getItem(`${STORAGE_PREFIX}status`) || "musait";
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
  const [activeTab, setActiveTab] = useState("feed");
  const [activeRoom, setActiveRoom] = useState("genel");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pulseBanner, setPulseBanner] = useState(null);

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

  const [posts, setPosts] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}posts`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [postText, setPostText] = useState("");
  const [postCategory, setPostCategory] = useState("Genel");
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
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}nickname`, nickname);
    window.localStorage.setItem(`${STORAGE_PREFIX}city`, cityTag);
    window.localStorage.setItem(`${STORAGE_PREFIX}status`, statusTag);
    window.localStorage.setItem(`${STORAGE_PREFIX}entered`, entered ? "1" : "0");
    window.localStorage.setItem(`${STORAGE_PREFIX}fd_authed`, isFdAuthenticated ? "1" : "0");
  }, [nickname, cityTag, statusTag, entered, isFdAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}posts`, JSON.stringify(posts.slice(-80)));
  }, [posts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}chat`, JSON.stringify(chatMessages.slice(-120)));
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
    });

    const unsubReports = onValue(ref(dbRef.current, `${DB_ROOT}/reports`), (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val)
        .map(([id, item]) => ({ id, ...item }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
      setReportsList(arr.slice(0, 80));
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
        city: cityTag.trim() || "Genel",
        status: statusTag,
        room: activeRoom,
        isAdmin: isFdAdmin,
        updatedAt: Date.now(),
      });
      onDisconnect(userRef).remove();

      const unsubUsers = onValue(ref(dbRef.current, `${DB_ROOT}/users`), (snap) => {
        const val = snap.val() || {};
        setOnlineUsers(Object.values(val).filter((u) => u && u.id !== myId));
      });

      const unsubPosts = onValue(ref(dbRef.current, `${DB_ROOT}/posts`), (snap) => {
        const val = snap.val() || {};
        const arr = Object.entries(val)
          .map(([id, item]) => ({ id, ...item }))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setPosts(arr.slice(0, 80));
      });

      const unsubChat = onValue(ref(dbRef.current, `${DB_ROOT}/chat`), (snap) => {
        const val = snap.val() || {};
        const arr = Object.entries(val)
          .map(([id, item]) => ({ id, ...item }))
          .sort((a, b) => (a.ts || 0) - (b.ts || 0));
        setChatMessages(arr.slice(-120));
      });

      return () => {
        unsubUsers();
        unsubPosts();
        unsubChat();
      };
    }
  }, [entered, nickname, cityTag, statusTag, activeRoom, isFdAdmin, myId]);

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
        .map(([id, item]) => ({ id, ...item }))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setDmMessages(arr.slice(-100));
    });
  }, [entered, dmPeer, myId]);

  useEffect(() => {
    if (activeTab === "chat" && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, activeRoom, activeTab]);

  useEffect(() => {
    if (dmPeer && dmBottomRef.current) {
      dmBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [dmMessages, dmPeer]);

  const currentStatusMeta = useMemo(
    () => STATUS_TAGS.find((s) => s.id === statusTag) || STATUS_TAGS[0],
    [statusTag]
  );

  const realOnlineDirectory = useMemo(() => {
    const map = new Map();
    onlineUsers.forEach((u) => {
      if (u && u.id && u.id !== myId && !bannedUsers[u.id]) {
        map.set(u.id, u);
      }
    });
    return Array.from(map.values());
  }, [onlineUsers, myId, bannedUsers]);

  const filteredDirectory = useMemo(() => {
    const q = peopleQuery.trim().toLocaleLowerCase("tr");
    return realOnlineDirectory.filter((u) => {
      const matchesStatus = statusFilter === "all" || u.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return (
        String(u.name || "").toLocaleLowerCase("tr").includes(q) ||
        String(u.city || "").toLocaleLowerCase("tr").includes(q)
      );
    });
  }, [realOnlineDirectory, peopleQuery, statusFilter]);

  const roomMessages = useMemo(() => {
    return chatMessages.filter((m) => (m.room || "genel") === activeRoom);
  }, [chatMessages, activeRoom]);

  function triggerPulse(title, body) {
    setPulseBanner({ title, body, id: Date.now() });
  }

  function handleEnter(e) {
    if (e) e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setLoginError("Lütfen görünür bir ad veya takma ad gir.");
      return;
    }

    if (isMyBanned && !isReservedFdName(trimmed)) {
      setLoginError("Bu hesap yönetici tarafından engellenmiştir.");
      return;
    }

    if (isReservedFdName(trimmed)) {
      const pass = fdPasswordInput.trim();
      if (pass.length < 4) {
        setLoginError("FD hesabı için en az 4 karakterli parola girin.");
        return;
      }
      const incomingHash = hashSecret(pass);

      if (!storedFdAuth || !storedFdAuth.passwordHash) {
        if (fdPasswordConfirm.trim() !== pass) {
          setLoginError("FD parola tekrarı eşleşmiyor.");
          return;
        }
        const authRecord = {
          passwordHash: incomingHash,
          ownerId: myId,
          createdAt: Date.now(),
        };
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
        triggerPulse("FD Sınırsız Yetki Aktif", "Yönetici parolan oluşturuldu ve tam yetkiyle giriş yapıldı.");
        return;
      }

      if (incomingHash !== storedFdAuth.passwordHash) {
        setLoginError("FD kullanıcı adı korumalıdır. Girdiğiniz parola hatalı!");
        return;
      }

      setNickname("FD");
      setIsFdAuthenticated(true);
      setLoginError("");
      setEntered(true);
      triggerPulse("FD Sınırsız Yetki Aktif", "Yönetici girişi doğrulandı.");
      return;
    }

    setIsFdAuthenticated(false);
    setNickname(trimmed);
    setLoginError("");
    setEntered(true);
    triggerPulse("Yanimda Canlı", `${trimmed} olarak ${cityTag.trim() || "Genel"} odasına katıldın.`);
  }

  function handleLogout() {
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/users/${myId}`));
    }
    setDmPeer(null);
    setEntered(false);
  }

  function handleCreatePost(e) {
    e.preventDefault();
    const clean = postText.trim();
    if (!clean) return;
    const displayName = isFdAdmin ? "FD" : nickname.trim();
    const item = {
      id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      authorId: myId,
      authorName: displayName,
      isAdminPost: isFdAdmin,
      city: cityTag.trim() || "Genel",
      statusLabel: currentStatusMeta.label,
      category: postCategory,
      text: clean,
      cheers: 0,
      createdAt: Date.now(),
    };
    setPostText("");
    if (dbRef.current) {
      push(ref(dbRef.current, `${DB_ROOT}/posts`), item);
    } else {
      setPosts((prev) => [item, ...prev.slice(0, 79)]);
    }
    triggerPulse("Akışta Paylaşıldı", `${postCategory} kanalında yeni bir gönderin yayında.`);
  }

  function handleCheerPost(postId) {
    if (dbRef.current) {
      const target = posts.find((p) => p.id === postId);
      if (target) {
        update(ref(dbRef.current, `${DB_ROOT}/posts/${postId}`), {
          cheers: (target.cheers || 0) + 1,
        });
      }
      return;
    }
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, cheers: (p.cheers || 0) + 1 } : p))
    );
  }

  function handleDeletePost(postId) {
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/posts/${postId}`));
    }
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    if (isFdAdmin) {
      triggerPulse("FD Moderasyon", "Ortak akıştaki paylaşım silindi.");
    }
  }

  function handleDeleteChatMessage(msgId) {
    if (!isFdAdmin || !msgId) return;
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/chat/${msgId}`));
    }
    setChatMessages((prev) => prev.filter((m) => m.id !== msgId));
    triggerPulse("FD Moderasyon", "Sohbet odasındaki mesaj silindi.");
  }

  function handleSubmitReport(e) {
    e.preventDefault();
    if (!reportTargetUser) return;
    const reasonClean = reportReason.trim() || "Uygunsuz davranış / uygunsuz mesaj";
    const reportEntry = {
      id: "rep_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      targetId: reportTargetUser.id,
      targetName: reportTargetUser.name,
      reporterId: myId,
      reporterName: isFdAdmin ? "FD" : nickname.trim(),
      reason: reasonClean,
      ts: Date.now(),
    };
    if (dbRef.current) {
      push(ref(dbRef.current, `${DB_ROOT}/reports`), reportEntry);
    } else {
      setReportsList((prev) => [reportEntry, ...prev.slice(0, 79)]);
    }
    setReportTargetUser(null);
    setReportReason("");
    triggerPulse("Şikayet İletildi", `${reportTargetUser.name} hakkında şikayet FD yönetimine gönderildi.`);
  }

  function handleBanUser(targetUser, reportIdToClear = null) {
    if (!isFdAdmin || !targetUser || !targetUser.id || targetUser.id === myId) return;
    const banRecord = {
      id: targetUser.id,
      name: targetUser.name || "Kullanıcı",
      bannedBy: "FD",
      bannedAt: Date.now(),
    };
    setBannedUsers((prev) => ({ ...prev, [targetUser.id]: banRecord }));
    setOnlineUsers((prev) => prev.filter((u) => u.id !== targetUser.id));

    if (dbRef.current) {
      set(ref(dbRef.current, `${DB_ROOT}/banned_users/${targetUser.id}`), banRecord);
      remove(ref(dbRef.current, `${DB_ROOT}/users/${targetUser.id}`));
      if (reportIdToClear) {
        remove(ref(dbRef.current, `${DB_ROOT}/reports/${reportIdToClear}`));
      }
    }
    if (reportIdToClear) {
      setReportsList((prev) => prev.filter((r) => r.id !== reportIdToClear));
    }
    triggerPulse("FD Ban İşlemi", `${banRecord.name} sistemden banlandı.`);
  }

  function handleUnbanUser(userId) {
    if (!isFdAdmin || !userId) return;
    setBannedUsers((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/banned_users/${userId}`));
    }
    triggerPulse("Ban Kaldırıldı", "Kullanıcının banı kaldırıldı.");
  }

  function appendChatMessage(rawText, roomId = activeRoom) {
    const clean = String(rawText || "").trim();
    if (!clean) return;
    const displayName = isFdAdmin ? "FD" : nickname.trim();
    const msg = {
      id: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      room: roomId,
      senderId: myId,
      senderName: displayName,
      isAdminMsg: isFdAdmin,
      city: cityTag.trim() || "Genel",
      text: clean,
      ts: Date.now(),
    };
    if (dbRef.current) {
      push(ref(dbRef.current, `${DB_ROOT}/chat`), msg);
    } else {
      setChatMessages((prev) => [...prev.slice(-119), msg]);
    }
  }

  function handleSendChat(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const textToSend = chatInput;
    setChatInput("");
    appendChatMessage(textToSend, activeRoom);
  }

  function handleQuickMatch() {
    if (realOnlineDirectory.length === 0) {
      triggerPulse("Çevrimiçi Kişi Yok", "Şu an eşleşebileceğin başka aktif kullanıcı görünmüyor.");
      return;
    }
    const picked = realOnlineDirectory[Math.floor(Math.random() * realOnlineDirectory.length)];
    setDmPeer(picked);
    triggerPulse("Hızlı Eşleşme", `${picked.name} (${picked.city || "Genel"}) ile özel sohbet açıldı.`);
  }

  function handleSendDm(e) {
    e.preventDefault();
    if (!dmPeer || !dmPeer.id || !dmInput.trim()) return;
    const clean = dmInput.trim();
    setDmInput("");
    const outgoing = {
      senderId: myId,
      senderName: isFdAdmin ? "FD" : nickname.trim(),
      recipientId: dmPeer.id,
      text: clean,
      ts: Date.now(),
    };

    if (dbRef.current) {
      const threadKey = buildDmThreadKey(myId, dmPeer.id);
      push(ref(dbRef.current, `${DB_ROOT}/dms/${threadKey}`), outgoing);
    } else {
      setDmMessages((prev) => [
        ...prev.slice(-99),
        { id: "dm_" + Date.now(), ...outgoing },
      ]);
    }
  }

  if (!entered) {
    const needsFirstTimeFdSetup = typingFdName && (!storedFdAuth || !storedFdAuth.passwordHash);

    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex flex-col justify-center p-5">
        <div className="max-w-md w-full mx-auto space-y-5">
          <div className="text-center space-y-2.5">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-400 shadow-lg shadow-emerald-950/60">
              <HeartHandshake className="w-9 h-9" />
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              Global & Türkiye Canlı Sohbet Ağı
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">Yanimda</h1>
            <p className="text-sm text-slate-400">
              Anlık durumunu paylaş, çevrimiçi toplulukla bağlan ve odalarda hemen sohbete başla.
            </p>
          </div>

          <form
            onSubmit={handleEnter}
            className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl"
          >
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Adın / Takma Adın
              </label>
              <input
                type="text"
                maxLength={20}
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  if (loginError) setLoginError("");
                }}
                placeholder="Örn: Emirhan"
                className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 text-sm"
              />
            </div>

            {typingFdName && (
              <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/40 space-y-3">
                <div className="flex items-center gap-2 text-xs font-extrabold text-amber-300">
                  <Lock className="w-4 h-4" />
                  {needsFirstTimeFdSetup
                    ? "FD Sınırsız Yönetici Parolası Oluştur"
                    : "FD Korumalı Yönetici Girişi"}
                </div>
                <input
                  type="password"
                  value={fdPasswordInput}
                  onChange={(e) => {
                    setFdPasswordInput(e.target.value);
                    if (loginError) setLoginError("");
                  }}
                  placeholder={needsFirstTimeFdSetup ? "Yeni FD parolası belirle" : "FD parolanı gir"}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-amber-500/40 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-sm"
                />
                {needsFirstTimeFdSetup && (
                  <input
                    type="password"
                    value={fdPasswordConfirm}
                    onChange={(e) => {
                      setFdPasswordConfirm(e.target.value);
                      if (loginError) setLoginError("");
                    }}
                    placeholder="FD parolasını tekrar gir"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-amber-500/40 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-sm"
                  />
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Şehir / Bölge
              </label>
              <input
                type="text"
                maxLength={24}
                value={cityTag}
                onChange={(e) => setCityTag(e.target.value)}
                placeholder="Örn: Körfez, İstanbul, Londra"
                className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 text-sm"
              />
            </div>

            {loginError && (
              <p className="text-xs font-semibold text-rose-400 bg-rose-950/50 border border-rose-500/40 rounded-xl px-3 py-2">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              disabled={!nickname.trim()}
              className="w-full py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 font-black text-sm text-slate-950 flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-500/20"
            >
              <Sparkles className="w-4 h-4" />
              Yanimda&apos;ya Giriş Yap
            </button>
          </form>

          <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-slate-400">
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-2.5">
              <div className="font-extrabold text-white">4 Canlı Oda</div>
              <div>TR & Global</div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-2.5">
              <div className="font-extrabold text-white">Hızlı Eşleşme</div>
              <div>Tek dokunuş</div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-2.5">
              <div className="font-extrabold text-white">
                {FIREBASE_CONFIG?.databaseURL ? "Canlı DB" : "Yerel Mod"}
              </div>
              <div>Anlık akış</div>
            </div>
          </div>
        </div>
      </div>
    );
  }  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-12">
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shrink-0">
              <HeartHandshake className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-base font-black text-white truncate">Yanimda</h1>
                {isFdAdmin ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 font-extrabold flex items-center gap-0.5 shrink-0">
                    <Shield className="w-3 h-3" />
                    FD YETKİ
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-bold shrink-0">
                    {currentStatusMeta.label}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                {isFdAdmin ? "FD (Sınırsız Yetki)" : nickname.trim()} • {cityTag.trim() || "Genel"} • {realOnlineDirectory.length + 1} aktif
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleQuickMatch}
              title="Hızlı Eşleş"
              className="p-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 transition"
            >
              <Shuffle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              Çıkış
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        {pulseBanner && (
          <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Bell className="w-4 h-4 text-emerald-300 shrink-0" />
              <div className="text-xs truncate">
                <strong className="text-emerald-200">{pulseBanner.title}:</strong>{" "}
                <span className="text-slate-200">{pulseBanner.body}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPulseBanner(null)}
              className="text-slate-400 hover:text-white shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {isFdAdmin && (
          <section className="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <Shield className="w-4 h-4" />
                FD Sınırsız Yönetim ({reportsList.length} Şikayet)
              </h2>
            </div>

            {reportsList.length === 0 ? (
              <p className="text-xs text-slate-400">Şikayet edilen kullanıcı bulunmuyor.</p>
            ) : (
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {reportsList.map((rep) => (
                  <div
                    key={rep.id}
                    className="bg-slate-950/95 border border-amber-500/25 rounded-xl p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        Hedef: <span className="text-rose-400">{rep.targetName}</span>{" "}
                        <span className="text-[10px] text-slate-400 font-normal">
                          (Bildiren: {rep.reporterName})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 truncate">Sebep: {rep.reason}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          handleBanUser(
                            { id: rep.targetId, name: rep.targetName },
                            rep.id
                          )
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-[11px] font-extrabold text-white flex items-center gap-1"
                      >
                        <Ban className="w-3 h-3" />
                        Banla
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReportsList((prev) => prev.filter((x) => x.id !== rep.id));
                          if (dbRef.current) remove(ref(dbRef.current, `${DB_ROOT}/reports/${rep.id}`));
                        }}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                        title="Şikayeti kapat"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {Object.keys(bannedUsers).length > 0 && (
              <div className="pt-2 border-t border-amber-500/20 space-y-1.5">
                <div className="text-[11px] font-bold text-amber-200">Banlanan Kullanıcılar:</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.values(bannedUsers).map((b) => (
                    <span
                      key={b.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300"
                    >
                      {b.name}
                      <button
                        type="button"
                        onClick={() => handleUnbanUser(b.id)}
                        className="text-emerald-400 hover:text-emerald-300 font-bold"
                      >
                        Banı Kaldır
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Canlı Durumun
            </span>
            <span className="text-[10px] text-emerald-400 font-bold">● Anlık Görünür</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {STATUS_TAGS.map((st) => {
              const active = statusTag === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusTag(st.id)}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold text-left flex items-center gap-2 transition ${
                    active
                      ? "bg-emerald-500/20 border-emerald-400 text-white"
                      : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                  {st.label}
                </button>
              );
            })}
          </div>
        </section>

        <nav className="grid grid-cols-3 gap-1.5 bg-slate-900 border border-slate-800 rounded-2xl p-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("feed")}
            className={`py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
              activeTab === "feed"
                ? "bg-emerald-500 text-slate-950"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            Akış ({posts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("people")}
            className={`py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
              activeTab === "people"
                ? "bg-emerald-500 text-slate-950"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Kişiler ({filteredDirectory.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
              activeTab === "chat"
                ? "bg-emerald-500 text-slate-950"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Odalar
          </button>
        </nav>

        {activeTab === "feed" && (
          <div className="space-y-3">
            <form
              onSubmit={handleCreatePost}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5"
            >
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {["Genel", "Türkiye", "Global", "Destek"].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setPostCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 border transition ${
                      postCategory === cat
                        ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                        : "bg-slate-950 border-slate-800 text-slate-400"
                    }`}
                  >
                    #{cat}
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                maxLength={240}
                value={postText}
                onChange={(e) => setPostText(e.target.value)}
                placeholder="Ne paylaşmak istersin? Anlık bir durum veya sohbet çağrısı yaz..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{postText.length}/240</span>
                <button
                  type="submit"
                  disabled={!postText.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-xs font-black text-slate-950 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  Paylaş
                </button>
              </div>
            </form>

            {posts.length === 0 ? (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
                Henüz akış paylaşımı yok. İlk mesajı sen bırak ve topluluğu başlat!
              </div>
            ) : (
              <div className="space-y-2.5">
                {posts.map((p) => {
                  const canDeletePost = isFdAdmin || p.authorId === myId;
                  return (
                    <article
                      key={p.id}
                      className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-extrabold text-white truncate">
                              {p.authorName}
                            </span>
                            {p.isAdminPost && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-extrabold">
                                FD
                              </span>
                            )}
                            {p.category && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-bold">
                                #{p.category}
                              </span>
                            )}
                            {p.statusLabel && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold">
                                {p.statusLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-slate-500" />
                            {p.city || "Genel"} • {formatTime(p.createdAt)}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {p.authorId !== myId && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportTargetUser({ id: p.authorId, name: p.authorName });
                                setReportReason("");
                              }}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-950/70 text-amber-300"
                              title="Şikayet Et"
                            >
                              <Flag className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isFdAdmin && p.authorId !== myId && (
                            <button
                              type="button"
                              onClick={() => handleBanUser({ id: p.authorId, name: p.authorName })}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-rose-300 hover:text-white"
                              title="Kullanıcıyı Banla"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDeletePost && (
                            <button
                              type="button"
                              onClick={() => handleDeletePost(p.id)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300"
                              title="Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-slate-100 whitespace-pre-line">{p.text}</p>

                      <div className="pt-1 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => handleCheerPost(p.id)}
                          className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-emerald-300 flex items-center gap-1"
                        >
                          <HeartHandshake className="w-3.5 h-3.5" />
                          Yanındayım ({p.cheers || 0})
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "people" && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={peopleQuery}
                onChange={(e) => setPeopleQuery(e.target.value)}
                placeholder="İsim veya şehir ara..."
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 ${
                  statusFilter === "all"
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-slate-950 text-slate-400 border border-slate-800"
                }`}
              >
                Tümü
              </button>
              {STATUS_TAGS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 ${
                    statusFilter === st.id
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-950 text-slate-400 border border-slate-800"
                  }`}
                >
                  {st.badge}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between bg-slate-950 border border-emerald-500/30 rounded-xl px-3 py-2.5">
              <div>
                <div className="text-xs font-extrabold text-white">
                  {isFdAdmin ? "FD" : nickname.trim()} <span className="text-emerald-400">(Sen)</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {cityTag.trim() || "Genel"} • {isFdAdmin ? "Sınırsız Yetki" : currentStatusMeta.label}
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            </div>

            {filteredDirectory.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                Şu an aktif başka gerçek kullanıcı yok. İkinci bir sekme veya cihazdan giriş yaptığında burada görünür.
              </p>
            ) : (
              filteredDirectory.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{u.name}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {u.city || "Genel"} • {u.status || "Müsait"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDmPeer(u)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-xs font-bold text-emerald-300 transition"
                    >
                      Mesaj
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReportTargetUser(u);
                        setReportReason("");
                      }}
                      className="p-1.5 rounded-xl bg-slate-800 hover:bg-amber-950/70 text-amber-300"
                      title="Şikayet Et"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                    {isFdAdmin && (
                      <button
                        type="button"
                        onClick={() => handleBanUser(u)}
                        className="p-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40"
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
        )}

        {activeTab === "chat" && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {ROOM_CHANNELS.map((rm) => {
                const isSelected = activeRoom === rm.id;
                return (
                  <button
                    key={rm.id}
                    type="button"
                    onClick={() => setActiveRoom(rm.id)}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      isSelected
                        ? "bg-emerald-500/20 border-emerald-400 text-white"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-extrabold">
                      <span>{rm.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300">
                        {rm.tag}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">{rm.desc}</div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {QUICK_REACTIONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => appendChatMessage(em, activeRoom)}
                  className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-sm shrink-0"
                >
                  {em}
                </button>
              ))}
            </div>

            <div className="h-64 overflow-y-auto space-y-2 pr-1">
              {roomMessages.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-12">
                  Bu odada henüz mesaj yok. İlk mesajı sen yaz!
                </p>
              ) : (
                roomMessages.map((m) => {
                  const mine = m.senderId === myId;
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                    >
                      <div className="flex items-center gap-1.5 px-1 mb-0.5">
                        <span className="text-[10px] text-slate-500">
                          {mine ? "Sen" : `${m.senderName} (${m.city || "Genel"})`}
                        </span>
                        {isFdAdmin && !mine && (
                          <button
                            type="button"
                            onClick={() => handleDeleteChatMessage(m.id)}
                            className="p-0.5 rounded text-rose-400 hover:bg-rose-950/70"
                            title="Mesajı Sil"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        {isFdAdmin && !mine && (
                          <button
                            type="button"
                            onClick={() => handleBanUser({ id: m.senderId, name: m.senderName })}
                            className="p-0.5 rounded text-amber-300 hover:bg-rose-950/70"
                            title="Göndereni Banla"
                          >
                            <Ban className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <div
                        className={`px-3 py-2 rounded-2xl text-xs max-w-[82%] ${
                          mine
                            ? "bg-emerald-500 text-slate-950 font-semibold rounded-br-sm"
                            : "bg-slate-800 text-slate-100 rounded-bl-sm"
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

            <form onSubmit={handleSendChat} className="flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={`${ROOM_CHANNELS.find((r) => r.id === activeRoom)?.title || "Oda"} sohbetine yaz...`}
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
              />
              <button
                type="submit"
                className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </main>

      {reportTargetUser && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitReport}
            className="bg-slate-900 border border-slate-700 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-white flex items-center gap-1.5">
                <Flag className="w-4 h-4 text-amber-400" />
                {reportTargetUser.name} Şikayet Et
              </h3>
              <button
                type="button"
                onClick={() => setReportTargetUser(null)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Şikayetiniz FD yönetimine iletilir. Gerekirse kullanıcı banlanır.
            </p>
            <input
              type="text"
              maxLength={120}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Şikayet sebebi (örn: uygunsuz mesaj, spam)..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReportTargetUser(null)}
                className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold"
              >
                Şikayeti Gönder
              </button>
            </div>
          </form>
        </div>
      )}

      {dmPeer && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-4 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h3 className="text-sm font-extrabold text-white">{dmPeer.name}</h3>
                <p className="text-[11px] text-slate-400">
                  {dmPeer.city || "Genel"} • Özel Sohbet
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDmPeer(null)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="h-60 overflow-y-auto space-y-2 pr-1">
              {dmMessages.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-10">
                  {dmPeer.name} ile özel sohbeti başlatmak için ilk mesajı yaz.
                </p>
              ) : (
                dmMessages.map((m) => {
                  const mine = m.senderId === myId;
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`px-3 py-2 rounded-2xl text-xs max-w-[82%] ${
                          mine
                            ? "bg-emerald-500 text-slate-950 font-semibold rounded-br-sm"
                            : "bg-slate-800 text-slate-100 rounded-bl-sm"
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
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
              />
              <button
                type="submit"
                className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold"
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

