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
  Users,
  MessageCircle,
  Send,
  Sparkles,
  LogOut,
  CheckCircle2,
  MapPin,
  Trash2,
} from "lucide-react";

const FIREBASE_CONFIG =
  typeof window !== "undefined" && window.__FIREBASE_CONFIG__
    ? window.__FIREBASE_CONFIG__
    : null;

const STORAGE_PREFIX = "yanimda_";
const DB_ROOT = "yanimda";

const STATUS_TAGS = [
  { id: "musait", label: "Yanındayım", badge: "Müsait" },
  { id: "sohbet", label: "Sohbete Açık", badge: "Sohbet" },
  { id: "destek", label: "Yardım / İstek", badge: "Destek" },
  { id: "mesgul", label: "Kısa Mola", badge: "Mola" },
];

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

  const [entered, setEntered] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem(`${STORAGE_PREFIX}nickname`) || "";
    const wasIn = window.localStorage.getItem(`${STORAGE_PREFIX}entered`) === "1";
    return Boolean(wasIn && saved.trim());
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
  const [onlineUsers, setOnlineUsers] = useState([]);
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
  const dbRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}nickname`, nickname);
    window.localStorage.setItem(`${STORAGE_PREFIX}city`, cityTag);
    window.localStorage.setItem(`${STORAGE_PREFIX}status`, statusTag);
    window.localStorage.setItem(`${STORAGE_PREFIX}entered`, entered ? "1" : "0");
  }, [nickname, cityTag, statusTag, entered]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}posts`, JSON.stringify(posts.slice(-60)));
  }, [posts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${STORAGE_PREFIX}chat`, JSON.stringify(chatMessages.slice(-80)));
  }, [chatMessages]);

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
    if (!entered) return;
    const cleanName = nickname.trim();
    if (!cleanName) return;

    if (dbRef.current) {
      const userRef = ref(dbRef.current, `${DB_ROOT}/users/${myId}`);
      set(userRef, {
        id: myId,
        name: cleanName,
        city: cityTag.trim() || "Genel",
        status: statusTag,
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
        setPosts(arr.slice(0, 60));
      });

      const unsubChat = onValue(ref(dbRef.current, `${DB_ROOT}/chat`), (snap) => {
        const val = snap.val() || {};
        const arr = Object.entries(val)
          .map(([id, item]) => ({ id, ...item }))
          .sort((a, b) => (a.ts || 0) - (b.ts || 0));
        setChatMessages(arr.slice(-80));
      });

      return () => {
        unsubUsers();
        unsubPosts();
        unsubChat();
      };
    }
  }, [entered, nickname, cityTag, statusTag, myId]);

  const currentStatusMeta = useMemo(
    () => STATUS_TAGS.find((s) => s.id === statusTag) || STATUS_TAGS[0],
    [statusTag]
  );

  function handleEnter(e) {
    if (e) e.preventDefault();
    if (!nickname.trim()) {
      setLoginError("Lütfen görünür bir ad veya takma ad gir.");
      return;
    }
    setLoginError("");
    setEntered(true);
  }

  function handleLogout() {
    if (dbRef.current) {
      remove(ref(dbRef.current, `${DB_ROOT}/users/${myId}`));
    }
    setEntered(false);
  }

  function handleCreatePost(e) {
    e.preventDefault();
    const clean = postText.trim();
    if (!clean) return;
    const item = {
      id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      authorId: myId,
      authorName: nickname.trim(),
      city: cityTag.trim() || "Genel",
      statusLabel: currentStatusMeta.label,
      text: clean,
      cheers: 0,
      createdAt: Date.now(),
    };
    setPostText("");
    if (dbRef.current) {
      push(ref(dbRef.current, `${DB_ROOT}/posts`), item);
    } else {
      setPosts((prev) => [item, ...prev.slice(0, 59)]);
    }
  }

  function handleCheerPost(postId) {
    if (dbRef.current) {
      const target = posts.find((p) => p.id === postId);
      if (target) {
        set(ref(dbRef.current, `${DB_ROOT}/posts/${postId}/cheers`), (target.cheers || 0) + 1);
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
  }

  function handleSendChat(e) {
    e.preventDefault();
    const clean = chatInput.trim();
    if (!clean) return;
    const msg = {
      id: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      senderId: myId,
      senderName: nickname.trim(),
      text: clean,
      ts: Date.now(),
    };
    setChatInput("");
    if (dbRef.current) {
      push(ref(dbRef.current, `${DB_ROOT}/chat`), msg);
    } else {
      setChatMessages((prev) => [...prev.slice(-79), msg]);
    }
  }

  if (!entered) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center p-5">
        <div className="max-w-md w-full mx-auto space-y-5">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400">
              <HeartHandshake className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Yanimda</h1>
            <p className="text-sm text-slate-400">
              Durumunu paylaş, çevrimiçi kişileri gör ve canlı sohbete katıl.
            </p>
          </div>

          <form
            onSubmit={handleEnter}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl"
          >
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Bölge / Etiket
              </label>
              <input
                type="text"
                maxLength={24}
                value={cityTag}
                onChange={(e) => setCityTag(e.target.value)}
                placeholder="Örn: Körfez, Kocaeli"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 text-sm"
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
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 font-extrabold text-sm text-white flex items-center justify-center gap-2 transition"
            >
              <Sparkles className="w-4 h-4" />
              Yanimda&apos;ya Giriş Yap
            </button>
          </form>

          <p className="text-center text-[11px] text-slate-500">
            {FIREBASE_CONFIG?.databaseURL
              ? "Firebase Realtime Database bağlı"
              : "Yerel tarayıcı modu aktif"}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-10">
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <HeartHandshake className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-base font-extrabold text-white truncate">Yanimda</h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-bold shrink-0">
                  {currentStatusMeta.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                {nickname.trim()} • {cityTag.trim() || "Genel"} • {onlineUsers.length + 1} kişi
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1 shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Çıkış
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Şu Anki Durumun
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {STATUS_TAGS.map((st) => {
              const active = statusTag === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusTag(st.id)}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold text-left transition ${
                    active
                      ? "bg-emerald-600/25 border-emerald-400 text-white"
                      : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
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
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Akış ({posts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("people")}
            className={`py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
              activeTab === "people"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Kişiler ({onlineUsers.length + 1})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
              activeTab === "chat"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Sohbet
          </button>
        </nav>

        {activeTab === "feed" && (
          <div className="space-y-3">
            <form
              onSubmit={handleCreatePost}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5"
            >
              <textarea
                rows={2}
                maxLength={240}
                value={postText}
                onChange={(e) => setPostText(e.target.value)}
                placeholder="Ne paylaşmak istersin? Bir duyuru, not veya durum yaz..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{postText.length}/240</span>
                <button
                  type="submit"
                  disabled={!postText.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-extrabold text-white flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  Paylaş
                </button>
              </div>
            </form>

            {posts.length === 0 ? (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
                Henüz paylaşım yok. İlk notu sen ekleyebilirsin.
              </div>
            ) : (
              <div className="space-y-2.5">
                {posts.map((p) => (
                  <article
                    key={p.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-extrabold text-white truncate">
                            {p.authorName}
                          </span>
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

                      {p.authorId === myId && (
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
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "people" && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between bg-slate-950 border border-emerald-500/30 rounded-xl px-3 py-2.5">
              <div>
                <div className="text-xs font-extrabold text-white">
                  {nickname.trim()} <span className="text-emerald-400">(Sen)</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {cityTag.trim() || "Genel"} • {currentStatusMeta.label}
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            </div>

            {onlineUsers.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                Şu an aktif başka kişi görünmüyor. Firebase bağlandığında diğer kullanıcılar burada listelenir.
              </p>
            ) : (
              onlineUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5"
                >
                  <div>
                    <div className="text-xs font-bold text-white">{u.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {u.city || "Genel"} • {u.status || "Müsait"}
                    </div>
                  </div>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "chat" && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="h-72 overflow-y-auto space-y-2 pr-1">
              {chatMessages.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-12">
                  Henüz sohbet mesajı yok. İlk mesajı sen yaz!
                </p>
              ) : (
                chatMessages.map((m) => {
                  const mine = m.senderId === myId;
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                    >
                      <span className="text-[10px] text-slate-500 px-1 mb-0.5">
                        {mine ? "Sen" : m.senderName}
                      </span>
                      <div
                        className={`px-3 py-2 rounded-2xl text-xs max-w-[82%] ${
                          mine
                            ? "bg-emerald-600 text-white rounded-br-sm"
                            : "bg-slate-800 text-slate-100 rounded-bl-sm"
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleSendChat} className="flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Yanimda sohbetine yaz..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
