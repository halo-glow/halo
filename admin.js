// The owner's feedback inbox. Signing in goes through Supabase Auth, and the database's row-level security
// only returns feedback to accounts listed in public.admins, so anyone else who opens this page sees nothing.
(function () {
  var cfg = window.HALO_FEEDBACK || {};
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "halo-admin-session", session = null, items = [], filter = "all";
  try { session = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) {}

  function save(s) {
    session = s;
    try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch (e) {}
  }
  function note(id, text, err) { $(id).textContent = text || ""; $(id).className = "status" + (err ? " err" : ""); }
  function show(view) { $("login").hidden = view !== "login"; $("inbox").hidden = view !== "inbox"; }

  async function auth(grant, body) {
    var res = await fetch(cfg.url + "/auth/v1/token?grant_type=" + grant, {
      method: "POST", headers: { apikey: cfg.key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    var d = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(d.error_description || d.msg || "Sign-in failed");
    return { token: d.access_token, refresh: d.refresh_token, expires: Date.now() + (d.expires_in - 60) * 1000 };
  }
  async function token() {
    if (!session) throw new Error("Signed out");
    if (Date.now() > session.expires) save(await auth("refresh_token", { refresh_token: session.refresh }));
    return session.token;
  }
  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ apikey: cfg.key, "Content-Type": "application/json", Authorization: "Bearer " + (await token()) }, opts.headers);
    var res = await fetch(cfg.url + path, { method: opts.method || "GET", headers: headers, body: opts.body });
    if (res.status === 401) { signOut(); throw new Error("Your session ended. Please sign in again."); }
    if (!res.ok) throw new Error("Something went wrong (" + res.status + ")");
    return res.status === 204 ? null : res.json();
  }

  async function load() {
    note("inboxStatus", "Loading…");
    try {
      items = await api("/rest/v1/feedback?select=id,created_at,message,email,is_read&order=created_at.desc");
      note("inboxStatus", ""); render();
    } catch (e) { note("inboxStatus", e.message, true); }
  }

  function button(text, kind, onclick) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "btn " + kind; b.textContent = text; b.onclick = onclick;
    return b;
  }
  // Everything visitors wrote is shown as plain text (textContent), never as HTML.
  function render() {
    var list = $("list"), unread = items.filter(function (f) { return !f.is_read; });
    var shown = filter === "all" ? items : unread;
    $("count").textContent = unread.length + " unread · " + items.length + " total";
    list.textContent = "";
    if (!shown.length) {
      var p = document.createElement("p");
      p.className = "empty"; p.textContent = filter === "all" ? "No feedback yet." : "Nothing unread.";
      return list.append(p);
    }
    shown.forEach(function (f) {
      var card = document.createElement("article"), meta = document.createElement("div");
      var when = document.createElement("time"), body = document.createElement("p"), actions = document.createElement("div");
      card.className = "card" + (f.is_read ? "" : " unread"); meta.className = "meta"; body.className = "msg"; actions.className = "actions";
      when.textContent = new Date(f.created_at).toLocaleString(); meta.append(when);
      if (f.email) { var a = document.createElement("a"); a.href = "mailto:" + f.email; a.textContent = f.email; meta.append(a); }
      body.textContent = f.message;
      actions.append(
        button(f.is_read ? "Mark unread" : "Mark read", "ghost", function () { setRead(f, !f.is_read); }),
        button("Delete", "danger", function () { remove(f); }));
      card.append(meta, body, actions); list.append(card);
    });
  }

  async function setRead(f, value) {
    try {
      await api("/rest/v1/feedback?id=eq." + encodeURIComponent(f.id), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ is_read: value }) });
      f.is_read = value; render();
    } catch (e) { note("inboxStatus", e.message, true); }
  }
  async function remove(f) {
    if (!confirm("Delete this feedback? This can't be undone.")) return;
    try {
      await api("/rest/v1/feedback?id=eq." + encodeURIComponent(f.id), { method: "DELETE", headers: { Prefer: "return=minimal" } });
      items = items.filter(function (x) { return x !== f; }); render();
    } catch (e) { note("inboxStatus", e.message, true); }
  }

  async function signOut() {
    var s = session;
    save(null); items = []; $("list").textContent = ""; show("login");
    if (s) try { await fetch(cfg.url + "/auth/v1/logout", { method: "POST", headers: { apikey: cfg.key, Authorization: "Bearer " + s.token } }); } catch (e) {}
  }

  $("loginForm").onsubmit = async function (e) {
    e.preventDefault();
    if (!cfg.url || cfg.url.indexOf("YOUR-") >= 0) return note("loginStatus", "Add your Supabase details to config.js first.", true);
    note("loginStatus", "Signing in…");
    try {
      save(await auth("password", { email: $("email").value.trim(), password: $("password").value }));
      $("password").value = "";
      if (!(await api("/rest/v1/rpc/is_admin", { method: "POST", body: "{}" }))) {
        await signOut();
        return note("loginStatus", "This account doesn't have access.", true);
      }
      note("loginStatus", ""); show("inbox"); load();
    } catch (err) { save(null); note("loginStatus", err.message, true); }
  };
  $("signOut").onclick = signOut;
  $("refresh").onclick = load;
  document.querySelectorAll("[data-filter]").forEach(function (b) {
    b.onclick = function () {
      filter = b.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach(function (x) { x.classList.toggle("on", x === b); });
      render();
    };
  });

  if (session) { show("inbox"); load(); } else show("login");
})();
