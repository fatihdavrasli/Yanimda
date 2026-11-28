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
  MapPin,
  Heart,
  X,
  MessageCircle,
  Send,
  LogOut,
  Shield,
  Lock,
  Ban,
  Flag,
  ChevronRight,
  Sparkles,
} from "lucide-react";

const FIREBASE_CONFIG =
  typeof window !== "undefined" && window.__FIREBASE_CONFIG__
    ? window.__FIREBASE_CONFIG__
    : null;

const STORAGE_PREFIX = "yanimda_helal_";
const DB_ROOT = "yanimda";

const AGE_RANGES = [
  "18–22",
  "23–27",
  "28–34",
  "35–44",
  "45+",
];

const GENDERS = ["Kadın", "Erkek"];

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

export default function App() {
  const [nickname, setNickname] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(`${STORAGE_PREFIX}nickname`) || "";
  });

  const [city, setCity] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(`${STORAGE_PREFIX}city`) || "";
  });

  const [gender, setGender] = useState(() => {
    if (typeof window === "undefined") return "Kadın";
    return window.localStorage.getItem(`${STORAGE_PREFIX}gender`) || "Kadın";
  });

  const [ageRange, setAgeRange] = useState(() => {
    if (typeof window === "undefined") return "23–27";
    return window.localStorage.getItem(`${STORAGE_PREFIX}age_range`) || "23–27";
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
    const savedNick = window.localStorage.getItem(`${STORAGE_PREFIX}nickname`) || "";
    const savedCity = window.localStorage.getItem(`${STORAGE_PREFIX}city`) || "";
    const wasIn = window.localStorage.getItem(`${STORAGE_PREFIX}entered`) === "1";
    if (!wasIn || !savedNick.trim() || !savedCity.trim()) return false;
    if (isReservedFdName(savedNick) && window.localStorage.getItem(`${STORAGE_PREFIX}fd_authed`) !== "1") {
      return false;
    }
    return true;
  });

  const [myId] = useState(() => {
    if (typeof window === "undefined") return "hd_guest";
    const existing = window.localStorage.getItem(`${STORAGE_PREFIX}uid`);
    if (existing) return existing;
    const created = "hd_" + Math.random().toString(36).slice(2, 9);
    window.localStorage.setItem(`${STORAGE_PREFIX}uid`, created);
    return created;
  });

  const [loginError, setLoginError] = useState("");
  const [statusNotice, setStatusNotice] = useState("");
  const [activeTab, setActiveTab] = useState("discover"); // discover | matches

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [skippedIds, setSkippedIds] = useState([]);
  const [likedIds, setLikedIds] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}liked_ids`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [incomingLikes, setIncomingLikes] = useState({});
  const [matchedUser, setMatchedUser] = useState(null);

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

  const [dmPeer, setDmPeer] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [dmInput, setDmInput] = useState("");

  const dbRef = useRef(null);
  const dmBottomRef = useRef(null);

  const typingFdName = isReservedFdName(nickname);
  const isFdAdmin = entered && isReservedFdName(nickname) && isFdAuthenticated;
  const isMyBanned = Boolean(bannedUsers && bannedUsers[myId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}nickname`, nickname);
    window.localStorage.setItem(`${STORAGE_PREFIX}city`, city);
    window.localStorage.setItem(`${STORAGE_PREFIX}gender`, gender);
    window.localStorage.setItem(`${STORAGE_PREFIX}age_range`, ageRange);
    window.localStorage.setItem(`${STORAGE_PREFIX}entered`, entered ? "1" : "0");
    window.localStorage.setItem(`${STORAGE_PREFIX}fd_authed`, isFdAuthenticated ? "1" : "0");
  }, [nickname, city, gender, ageRange, entered, isFdAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}liked_ids`, JSON.stringify(likedIds));
  }, [likedIds]);

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
      console.error("Helal Date Firebase başlatılamadı:", err);
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
    setEntered(false);
    setLoginError("Yönetici (FD) tarafından sistemden uzaklaştırıldınız.");
  }, [isMyBanned, isFdAdmin, myId]);

  useEffect(() => {
    if (!entered) return;
    const cleanNick = isReservedFdName(nickname) ? "FD" : nickname.trim();
    const cleanCity = city.trim();
    if (!cleanNick || !cleanCity) return;

    if (dbRef.current) {
      const userRef = ref(dbRef.current, `${DB_ROOT}/users/${myId}`);
      set(userRef, {
        id: myId,
        name: cleanNick,
        city: cleanCity,
        gender,
        ageRange,
        isAdmin: isFdAdmin,
        updatedAt: Date.now(),
      });
      onDisconnect(userRef).remove();

      const unsubUsers = onValue(ref(dbRef.current, `${DB_ROOT}/users`), (snap) => {
        const val = snap.val() || {};
        setOnlineUsers(Object.values(val).filter((u) => u && u.id));
      });

      const unsubMyLikes = onValue(ref(dbRef.current, `${DB_ROOT}/likes/${myId}`), (snap) => {
        setIncomingLikes(snap.val() || {});
      });

      return () => {
        unsubUsers();
        unsubMyLikes();
      };
    }
  }, [entered, nickname, city, gender, ageRange, isFdAdmin, myId]);

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
    if (dmPeer && dmBottomRef.current) {
      dmBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [dmMessages, dmPeer]);

  const activeUsersMap = useMemo(() => {
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
        city: city.trim() || "Türkiye",
        gender,
        ageRange,
        isAdmin: isFdAdmin,
      });
    }
    return map;
  }, [onlineUsers, bannedUsers, entered, isMyBanned, myId, isFdAdmin, nickname, city, gender, ageRange]);

  const onlineCount = activeUsersMap.size;

  const candidateCards = useMemo(() => {
    return Array.from(activeUsersMap.values()).filter((u) => {
      if (u.id === myId) return false;
      if (skippedIds.includes(u.id)) return false;
      if (likedIds.includes(u.id)) return false;
      return true;
    });
  }, [activeUsersMap, myId, skippedIds, likedIds]);

  const currentCard = candidateCards[0] || null;

  const mutualMatches = useMemo(() => {
    return Array.from(activeUsersMap.values()).filter((u) => {
      if (u.id === myId) return false;
      const iLikedThem = likedIds.includes(u.id);
      const theyLikedMe = Boolean(incomingLikes && incomingLikes[u.id]);
      return iLikedThem && theyLikedMe;
    });
  }, [activeUsersMap, myId, likedIds, incomingLikes]);

  function handleEnter(e) {
    if (e) e.preventDefault();
    const trimmedNick = nickname.trim();
    const trimmedCity = city.trim();

    if (!trimmedNick) {
      setLoginError("Lütfen bir nick gir.");
      return;
    }
    if (!trimmedCity) {
      setLoginError("Lütfen şehir bilgisini gir.");
      return;
    }
    if (!gender) {
      setLoginError("Lütfen cinsiyet seç.");
      return;
    }
    if (!ageRange) {
      setLoginError("Lütfen yaş aralığı seç.");
      return;
    }

    if (isMyBanned && !isReservedFdName(trimmedNick)) {
      setLoginError("Bu hesap yönetici tarafından engellenmiştir.");
      return;
    }

    if (isReservedFdName(trimmedNick)) {
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
        setCity(trimmedCity);
        setIsFdAuthenticated(true);
        setLoginError("");
        setEntered(true);
        setStatusNotice("FD yönetici yetkisi aktif.");
        return;
      }
      if (incomingHash !== storedFdAuth.passwordHash) {
        setLoginError("FD kullanıcı adı korumalıdır. Parola hatalı.");
        return;
      }
      setNickname("FD");
      setCity(trimmedCity);
      setIsFdAuthenticated(true);
      setLoginError("");
      setEntered(true);
      setStatusNotice("FD yönetici yetkisi aktif.");
      return;
    }

    setIsFdAuthenticated(false);
    setNickname(trimmedNick);
    setCity(trimmedCity);
    setLoginError("");
    setEntered(true);
    setStatusNotice(`${trimmedNick} (${trimmedCity}, ${ageRange}) olarak giriş yapıldı.`);
  }

  function handleLogout() {
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/users/${myId}`));
    }
    setDmPeer(null);
    setMatchedUser(null);
    setEntered(false);
  }

  function handlePassCard(target) {
    if (!target) return;
    setSkippedIds((prev) => [...prev, target.id]);
  }

  function handleLikeCard(target) {
    if (!target) return;
    setLikedIds((prev) => (prev.includes(target.id) ? prev : [...prev, target.id]));

    if (dbRef.current) {
      set(ref(dbRef.current, `${DB_ROOT}/likes/${target.id}/${myId}`), {
        fromId: myId,
        fromName: isFdAdmin ? "FD" : nickname.trim(),
        ts: Date.now(),
      });
    }

    if (incomingLikes && incomingLikes[target.id]) {
      setMatchedUser(target);
      setStatusNotice(`${target.name} ile karşılıklı eşleştiniz.`);
    } else {
      setStatusNotice(`${target.name} beğenildi.`);
    }
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
      reason: reportReason.trim() || "Uygunsuz davranış",
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
  }

  if (!entered) {
    const needsFirstTimeFdSetup = typingFdName && (!storedFdAuth || !storedFdAuth.passwordHash);

    return (
      <div className="min-h-screen bg-[#f5f5f0] text-[#1c2420] flex flex-col justify-between p-5">
        <header className="max-w-md w-full mx-auto flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <HeartHandshake className="w-6 h-6 text-[#2d4939]" />
            <span className="text-xl font-black tracking-tight text-[#18201c]">Helal Date</span>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#e2e4dc] text-xs font-semibold text-[#3a4940]">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {onlineCount} çevrimiçi
          </span>
        </header>

        <main className="max-w-md w-full mx-auto my-auto py-5 space-y-5">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#e2e4dc] text-[11px] font-bold text-[#2d4939]">
              <Sparkles className="w-3.5 h-3.5" />
              Fotoğrafsız • Sade Tanışma
            </div>
            <h1 className="text-3xl font-black tracking-tight text-[#18201c]">
              Önce niyet,
              <br />
              sonra sohbet.
            </h1>
            <p className="text-xs text-[#5d6b63] max-w-xs mx-auto leading-relaxed">
              Fotoğraf yok. Sadece nick, şehir, cinsiyet ve yaş aralığını yazarak kartları kaydırabilirsin.
            </p>
          </div>

          <form
            onSubmit={handleEnter}
            className="bg-white border border-[#e2e4dc] rounded-3xl p-5 space-y-4 shadow-sm"
          >
            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#18201c]">Nick</label>
              <input
                type="text"
                maxLength={20}
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  if (loginError) setLoginError("");
                }}
                placeholder="Örn: Sakin Yolcu"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f8f8f4] border border-[#dce0d8] text-sm text-[#18201c] focus:outline-none focus:border-[#2d4939]"
              />
            </div>

            {typingFdName && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-900">
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
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-amber-300 text-sm text-[#18201c]"
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
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-amber-300 text-sm text-[#18201c]"
                  />
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#18201c]">Şehir</label>
              <input
                type="text"
                maxLength={24}
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  if (loginError) setLoginError("");
                }}
                placeholder="Örn: Kocaeli, İstanbul, Ankara"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f8f8f4] border border-[#dce0d8] text-sm text-[#18201c] focus:outline-none focus:border-[#2d4939]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-extrabold text-[#18201c]">Cinsiyet</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {GENDERS.map((g) => {
                    const active = gender === g;
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGender(g)}
                        className={`py-2.5 rounded-xl text-xs font-bold border transition ${
                          active
                            ? "bg-[#2d4939] text-white border-[#2d4939]"
                            : "bg-[#f8f8f4] text-[#1c2420] border-[#dce0d8]"
                        }`}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-extrabold text-[#18201c]">Yaş Aralığı</label>
                <select
                  value={ageRange}
                  onChange={(e) => setAgeRange(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#f8f8f4] border border-[#dce0d8] text-sm font-bold text-[#18201c] focus:outline-none focus:border-[#2d4939]"
                >
                  {AGE_RANGES.map((ar) => (
                    <option key={ar} value={ar}>
                      {ar}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loginError && (
              <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2 text-center">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              className="w-full py-3.5 rounded-2xl bg-[#2d4939] hover:bg-[#243c2e] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition"
            >
              <span>Giriş Yap ve Kartlara Başla</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </form>
        </main>

        <footer className="max-w-md w-full mx-auto text-center text-[11px] text-[#78847d]">
          Helal Date • Fotoğrafsız sade eşleşme alanı
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1c2420] flex flex-col justify-between pb-6">
      <div className="max-w-md w-full mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 min-w-0">
            <HeartHandshake className="w-6 h-6 text-[#2d4939] shrink-0" />
            <span className="text-lg font-black tracking-tight text-[#18201c] truncate">
              Helal Date
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
              {onlineCount} çevrimiçi
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

        <div className="flex items-center justify-between bg-white border border-[#e2e4dc] rounded-2xl px-3.5 py-2.5 text-xs shadow-sm">
          <div className="truncate font-bold text-[#18201c]">
            {isFdAdmin ? "FD" : nickname.trim()}{" "}
            <span className="font-normal text-[#6d7a72]">
              • {city.trim()} • {gender} • {ageRange}
            </span>
          </div>
        </div>

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

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("discover")}
            className={`py-3 px-4 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-2 transition ${
              activeTab === "discover"
                ? "bg-[#18201c] text-white border-[#18201c]"
                : "bg-white text-[#1c2420] border-[#e2e4dc]"
            }`}
          >
            <Heart className="w-4 h-4" />
            <span>Kartlar ({candidateCards.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("matches")}
            className={`py-3 px-4 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-2 transition ${
              activeTab === "matches"
                ? "bg-[#18201c] text-white border-[#18201c]"
                : "bg-white text-[#1c2420] border-[#e2e4dc]"
            }`}
          >
            <MessageCircle className="w-4 h-4" />
            <span>Eşleşmeler ({mutualMatches.length})</span>
          </button>
        </div>

        {activeTab === "discover" ? (
          currentCard ? (
            <div className="bg-white border border-[#e2e4dc] rounded-3xl p-6 space-y-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f4f5ef] text-[11px] font-bold text-[#2d4939]">
                  <span>{currentCard.gender || "Üye"}</span>
                  <span>•</span>
                  <span>{currentCard.ageRange || "23–27"}</span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setReportTargetUser(currentCard);
                      setReportReason("");
                    }}
                    className="p-2 rounded-xl bg-[#f8f8f4] border border-[#e2e4dc] text-amber-700"
                    title="Şikayet Et"
                  >
                    <Flag className="w-3.5 h-3.5" />
                  </button>
                  {isFdAdmin && (
                    <button
                      type="button"
                      onClick={() => handleBanUser(currentCard)}
                      className="p-2 rounded-xl bg-rose-600 text-white"
                      title="Banla"
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="py-6 text-center space-y-2 border-y border-[#eceee7]">
                <h2 className="text-2xl font-black tracking-tight text-[#18201c]">
                  {currentCard.name}
                </h2>
                <p className="text-xs font-semibold text-[#56635c] inline-flex items-center justify-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-[#2d4939]" />
                  {currentCard.city || "Türkiye"} • {currentCard.ageRange || "23–27"} yaş aralığı
                </p>
                <p className="text-xs text-[#78847d] pt-1">
                  Fotoğraf paylaşılmaz. Karşılıklı eşleşmede sohbet açılır.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => handlePassCard(currentCard)}
                  className="py-3.5 rounded-2xl bg-[#f5f5f0] hover:bg-[#ebece5] border border-[#dce0d8] text-sm font-extrabold text-[#3a4940] flex items-center justify-center gap-2 transition"
                >
                  <X className="w-4 h-4" />
                  <span>Geç</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleLikeCard(currentCard)}
                  className="py-3.5 rounded-2xl bg-[#2d4939] hover:bg-[#243c2e] text-white text-sm font-extrabold flex items-center justify-center gap-2 transition"
                >
                  <Heart className="w-4 h-4" />
                  <span>Beğen</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-[#e2e4dc] rounded-3xl p-8 text-center space-y-3 shadow-sm">
              <p className="text-sm font-extrabold text-[#18201c]">
                Şu an gösterilecek yeni kart yok.
              </p>
              <p className="text-xs text-[#6d7a72]">
                Yeni kullanıcılar giriş yaptıkça kartlar burada görünür.
              </p>
              {skippedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSkippedIds([])}
                  className="px-4 py-2 rounded-xl bg-[#f5f5f0] border border-[#dce0d8] text-xs font-bold text-[#1c2420]"
                >
                  Geçilen Kartları Sıfırla
                </button>
              )}
            </div>
          )
        ) : (
          <div className="bg-white border border-[#e2e4dc] rounded-2xl p-3.5 space-y-2.5 shadow-sm">
            {mutualMatches.length === 0 ? (
              <p className="text-xs text-[#6d7a72] text-center py-8">
                Henüz karşılıklı eşleşme yok. Kartlardan beğendiğin kişi de seni beğendiğinde burada görünür.
              </p>
            ) : (
              mutualMatches.map((mUser) => (
                <div
                  key={mUser.id}
                  className="flex items-center justify-between gap-2 bg-[#f8f8f4] border border-[#e7e9e2] rounded-xl px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-[#18201c] truncate">
                      {mUser.name}
                    </div>
                    <div className="text-[11px] text-[#6d7a72] truncate">
                      {mUser.city} • {mUser.gender} • {mUser.ageRange}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDmPeer(mUser)}
                    className="px-3 py-1.5 rounded-xl bg-[#2d4939] text-white text-xs font-bold shrink-0"
                  >
                    Sohbet
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <footer className="max-w-md w-full mx-auto text-center text-[11px] text-[#78847d]">
        Helal Date • Yanimda altyapısı
      </footer>

      {matchedUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#e2e4dc] rounded-3xl max-w-xs w-full p-5 text-center space-y-4 shadow-xl">
            <h3 className="text-lg font-black text-[#18201c]">Karşılıklı Eşleşme</h3>
            <p className="text-xs text-[#56635c]">
              <strong className="text-[#18201c]">{matchedUser.name}</strong> ({matchedUser.city}) ile eşleştiniz.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMatchedUser(null)}
                className="py-2.5 rounded-xl bg-[#f5f5f0] text-xs font-bold text-[#3a4940]"
              >
                Devam Et
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = matchedUser;
                  setMatchedUser(null);
                  setDmPeer(target);
                }}
                className="py-2.5 rounded-xl bg-[#2d4939] text-white text-xs font-bold"
              >
                Mesaj At
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div>
                <h3 className="text-sm font-extrabold text-[#18201c]">{dmPeer.name}</h3>
                <p className="text-[11px] text-[#6d7a72]">
                  {dmPeer.city} • {dmPeer.gender} • {dmPeer.ageRange}
                </p>
              </div>
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
                  {dmPeer.name} ile sohbeti başlat.
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
