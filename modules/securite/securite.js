/* Module Cockpit « Sécurité et tâches » (thème partagé ../studio).
 * Tout passe par l'assistant /usr/local/libexec/cockpit-securite (via sudo, règle limitée à ce seul script),
 * qui revalide chaque paramètre. Tout texte venant du serveur (journaux, whois, noms…) est inséré avec
 * textContent (jamais innerHTML) : une ligne de log ou une réponse whois piégée ne peut rien exécuter.
 * L'onglet ouvert suit l'URL Cockpit : /securite/jails, /securite/certs, /securite/ip/<adresse>… */
"use strict";
(() => {
    const { h, svg, icon, toast: stToast, skeleton, countUp, slashFocus, searchBox, labelize, rise } = Studio;
    const HELPER = ["sudo", "-n", "/usr/local/libexec/cockpit-securite"];
    const HOST = "hôte";
    const $ = (sel, root = document) => root.querySelector(sel);

    const S = { data: {}, loading: {}, tab: "overview", histDays: 30, histQ: "", histJail: "" };

    /* ------------------------------------------------------------ utilitaires */
    const nf = new Intl.NumberFormat("fr-FR");
    const fmtN = n => (n === null || n === undefined) ? "–" : nf.format(n);
    function fmtSize(n) {
        if (n >= 1073741824) return (n / 1073741824).toFixed(1).replace(".", ",") + " Go";
        if (n >= 1048576) return (n / 1048576).toFixed(1).replace(".", ",") + " Mo";
        if (n >= 1024) return Math.round(n / 1024) + " Ko";
        return n + " o";
    }
    const dtf = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    const df = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
    const dshort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
    const parseT = iso => new Date(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
    function fmtTime(iso) {
        if (!iso) return "–";
        const d = parseT(iso);
        return isNaN(d) ? iso : dtf.format(d);
    }
    function rel(iso) {
        if (!iso) return "–";
        const s = (parseT(iso) - Date.now()) / 1000;
        if (!isFinite(s)) return "–";
        const a = Math.abs(s), fut = s > 0;
        const v = a < 60 ? "moins d'1 min" : a < 3600 ? Math.round(a / 60) + " min" : a < 86400 ? Math.round(a / 3600) + " h"
            : Math.round(a / 86400) + " j";
        return fut ? "dans " + v : "il y a " + v;
    }
    function dur(sec) {
        if (sec === null || sec === undefined) return "–";
        if (sec < 0) return "permanent";
        if (sec % 86400 === 0) return sec / 86400 + " j";
        if (sec % 3600 === 0) return sec / 3600 + " h";
        if (sec % 60 === 0) return sec / 60 + " min";
        return sec + " s";
    }
    const badge = (cls, txt) => h("span", { class: "st " + cls }, txt);
    const ipBtn = ip => h("button", { class: "ipbtn", type: "button", title: "Rechercher cette IP", onclick: () => lookup(ip) }, ip);
    const table = (heads, rows, cls) => {
        const t = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, heads.map(x => h("th", {}, x)))), h("tbody", {}, rows));
        labelize(t);
        return h("div", { class: "tbl-wrap " + (cls || "") }, t);
    };
    const empty = txt => h("p", { class: "empty" }, txt);
    const card = (title, extra, ...body) => h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h2", {}, title), extra || null), body);
    const withIcon = (btn, name) => { btn.prepend(icon(name)); return btn; };

    function showAlert(msg) {
        const a = $("#alert");
        a.hidden = !msg;
        a.textContent = msg || "";
    }
    const toast = (msg, err) => stToast(msg, err ? "err" : "ok");

    /* ------------------------------------------------------------ appels à l'assistant */
    function friendly(e) {
        const m = (e && (e.message || e.problem)) || String(e);
        if (/password is required|not allowed|may not run sudo|not in the sudoers/i.test(m))
            return "Droit manquant : ce compte n'est pas autorisé à lancer l'assistant de sécurité.\n" +
                   "En root sur l'hôte : visudo -cf /root/cockpit-securite.sudoers && install -m 440 -o root -g root " +
                   "/root/cockpit-securite.sudoers /etc/sudoers.d/cockpit-securite && visudo -c";
        if (/not-found|No such file/i.test(m)) return "Assistant introuvable : /usr/local/libexec/cockpit-securite.";
        return m;
    }
    async function api(...args) {
        let raw;
        try { raw = await cockpit.spawn([...HELPER, ...args.map(String)], { err: "message" }); }
        catch (e) { throw new Error(friendly(e)); }
        return JSON.parse(raw);
    }
    async function load(key, args, force) {
        if (S.data[key] && !force) return S.data[key];
        if (S.loading[key]) return S.loading[key];
        // --fresh : contourne le cache court de l'assistant (bouton Actualiser, après une action)
        S.loading[key] = api(...(force ? ["--fresh", ...args] : args)).then(d => { S.data[key] = d; return d; })
            .finally(() => { delete S.loading[key]; });
        return S.loading[key];
    }
    const SOURCES = {
        jails: ["jails"], history: () => ["history", "--days", S.histDays], tasks: ["tasks"],
        certs: ["certs"], system: ["system"],
    };
    const argsOf = k => typeof SOURCES[k] === "function" ? SOURCES[k]() : SOURCES[k];

    function confirmDlg(title, body, okLabel, danger) {
        const dlg = $("#dlg");
        $("#dlg-title").textContent = title;
        const b = $("#dlg-body");
        b.textContent = "";
        b.append(...[].concat(body));
        const ok = $("#dlg-ok");
        ok.textContent = okLabel || "Confirmer";
        ok.className = "btn " + (danger ? "danger solid" : "primary");
        return new Promise(res => {
            dlg.addEventListener("close", () => res(dlg.returnValue === "ok" ? $("#dlg-form") : null), { once: true });
            dlg.returnValue = "";
            dlg.showModal();
        });
    }

    /* ------------------------------------------------------------ onglets ⇄ URL Cockpit */
    const RENDER = {};
    const TABS = ["overview", "jails", "history", "ip", "tasks", "certs", "system"];
    function locPath() { try { return cockpit.location.path || []; } catch (e) { return []; } }
    function setTab(tab, opts = {}) {
        if (!RENDER[tab]) tab = "overview";
        S.tab = tab;
        document.querySelectorAll(".tab").forEach(t => {
            const on = t.dataset.tab === tab;
            t.setAttribute("aria-selected", String(on));
            t.tabIndex = on ? 0 : -1;
            if (on && t.scrollIntoView && !opts.initial) t.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
        });
        document.querySelectorAll(".panel").forEach(p => { p.hidden = p.id !== "p-" + tab; });
        try { sessionStorage.setItem("securite:tab", tab); } catch (e) { /* ignoré */ }
        if (!opts.fromLocation) {
            const want = tab === "overview" ? [] : tab === "ip" && opts.ip ? ["ip", opts.ip] : [tab];
            const cur = locPath();
            if (cur.join("/") !== want.join("/")) {
                try { if (opts.initial) cockpit.location.replace(want); else cockpit.location.go(want); } catch (e) { /* hors Cockpit */ }
            }
        }
        RENDER[tab]();
    }
    document.querySelectorAll(".tab").forEach(t => {
        t.addEventListener("click", () => setTab(t.dataset.tab));
        t.addEventListener("keydown", e => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const i = TABS.indexOf(S.tab) + (e.key === "ArrowRight" ? 1 : -1);
            const next = TABS[(i + TABS.length) % TABS.length];
            setTab(next);
            $(`.tab[data-tab="${next}"]`).focus();
        });
    });
    function fromLocation() {
        const p = locPath();
        const tab = TABS.includes(p[0]) ? p[0] : "overview";
        if (tab === "ip" && p[1]) {
            if ($("#ip-q").value.trim() !== p[1]) { $("#ip-q").value = p[1]; setTab("ip", { fromLocation: true }); runLookup(); return; }
        }
        if (tab !== S.tab || !document.querySelector(".panel:not([hidden])")) setTab(tab, { fromLocation: true });
    }
    try { cockpit.addEventListener("locationchanged", fromLocation); } catch (e) { /* hors Cockpit */ }

    async function withPanel(tab, keys, draw, force) {
        const p = $("#p-" + tab);
        if (keys.some(k => !S.data[k]) || force) {
            if (!p.firstChild || force) { p.textContent = ""; p.append(h("section", { class: "card" }, skeleton(5)), h("section", { class: "card" }, skeleton(4))); }
        }
        try {
            const res = await Promise.all(keys.map(k => load(k, argsOf(k), force)));
            showAlert("");
            if (S.tab !== tab && tab !== "overview") return;
            p.textContent = "";
            draw(p, ...res);
        } catch (e) {
            p.textContent = "";
            showAlert(e.message);
        }
    }

    /* ------------------------------------------------------------ compte à rebours des bans */
    // début du ban = dernier événement Ban / Restore Ban / Increase Ban de l'historique pour (machine, prison, IP)
    function banStart(hist, inst, jail, ip) {
        if (!hist) return null;
        const e = hist.events.find(x => x.ip === ip && x.i === inst && x.j === jail && x.a !== "Unban");
        return e ? parseT(e.t).getTime() : null;
    }
    function cdText(ms) {
        if (ms <= 0) return "levée imminente";
        const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
        const p2 = n => String(n).padStart(2, "0");
        return (d ? d + " j " : "") + p2(hh) + ":" + p2(mm) + ":" + p2(ss);
    }
    function countdown(start, bantime) {
        if (bantime < 0) return h("span", { class: "cd perm" }, "ban permanent");
        if (!start) return h("span", { class: "cd unk", title: "Début du ban absent de l'historique (archives tournées)" }, "durée " + dur(bantime) + " · début inconnu");
        const end = start + bantime * 1000;
        const fill = h("i");
        const txt = h("span", { class: "cd-t tnum" }, "");
        const el = h("span", { class: "cd", dataset: { end, len: bantime * 1000 }, title: "Fin du ban : " + dtf.format(new Date(end)) },
            icon("clock"), txt, h("span", { class: "meter cd-m", "aria-hidden": "true" }, fill));
        tickOne(el);
        return el;
    }
    function tickOne(el) {
        const left = Number(el.dataset.end) - Date.now(), len = Number(el.dataset.len);
        el.querySelector(".cd-t").textContent = cdText(left);
        el.querySelector(".cd-m > i").style.width = Math.max(0, Math.min(100, left / len * 100)).toFixed(2) + "%";
        el.setAttribute("aria-label", "Fin du ban dans " + cdText(left));
    }
    setInterval(() => { if (!document.hidden) document.querySelectorAll(".cd[data-end]").forEach(tickOne); }, 1000);

    /* ------------------------------------------------------------ graphique SVG des bans par jour */
    function banChart(perDay, days) {
        const map = Object.fromEntries(perDay.map(d => [d.d, d]));
        const out = [];
        const today = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today.getTime() - i * 86400e3).toISOString().slice(0, 10);
            out.push({ d, ban: (map[d] || {}).ban || 0, found: (map[d] || {}).found || 0 });
        }
        const page = $(".page"), pad = page ? parseFloat(getComputedStyle(page).paddingLeft) || 16 : 16;
        const W = Math.round(Math.max(290, Math.min(1180, (page ? page.clientWidth : 760) - 2 * pad - (window.innerWidth <= 720 ? 30 : 38))));
        const H = window.innerWidth <= 720 ? 170 : 200, L = 34, R = 34, T = 10, B = 24;
        const maxB = Math.max(1, ...out.map(o => o.ban)), maxF = Math.max(1, ...out.map(o => o.found));
        const stepB = maxB <= 4 ? 1 : Math.ceil(maxB / 4);
        const topB = Math.ceil(maxB / stepB) * stepB;
        const y = v => T + (H - T - B) * (1 - v / topB);
        const yf = v => T + (H - T - B) * (1 - v / maxF);
        const cw = (W - L - R) / out.length, bw = Math.max(2, Math.min(cw * .62, 16));
        const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "banchart", role: "img", width: W, height: H,
            "aria-label": `Bans par jour sur ${days} jours : ${out.reduce((a, o) => a + o.ban, 0)} au total, maximum ${maxB} par jour` });
        const defs = svg("defs", {}, svg("linearGradient", { id: "bc-f", x1: 0, x2: 0, y1: 0, y2: 1 },
            svg("stop", { offset: "0", class: "bc-f0" }), svg("stop", { offset: "1", class: "bc-f1" })));
        g.append(defs);
        for (let v = 0; v <= topB; v += stepB) {
            g.append(svg("line", { class: "grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
            g.append(svg("text", { class: "axis", x: L - 6, y: y(v) + 4, "text-anchor": "end" }, String(v)));
        }
        g.append(svg("text", { class: "axis f", x: W - R + 6, y: yf(maxF) + 4 }, maxF >= 1000 ? Math.round(maxF / 100) / 10 + "k" : String(maxF)));
        // tentatives relevées : aire discrète (échelle de droite)
        const pts = out.map((o, i) => [L + i * cw + cw / 2, yf(o.found)]);
        const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
        g.append(svg("path", { class: "bc-area", d: line + ` L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z` }));
        g.append(svg("path", { class: "bc-line", d: line }));
        const every = Math.max(1, Math.round(out.length / (W < 520 ? 3 : 6)));
        out.forEach((o, i) => {
            const x = L + i * cw + (cw - bw) / 2;
            const col = svg("g", { class: "col", tabindex: "0", role: "img", "aria-label": `${df.format(new Date(o.d))} : ${o.ban} ban(s), ${o.found} tentative(s)` });
            col.style.setProperty("--i", i);
            col.append(svg("rect", { class: "hit", x: L + i * cw, y: T, width: cw, height: H - T - B, rx: 4 }));
            if (o.ban) {
                const hh = y(0) - y(o.ban), r = Math.min(4, bw / 2, hh);
                col.append(svg("path", { class: "bc-bar" + (i === out.length - 1 ? " today" : ""),
                    d: `M${x},${y(0)} V${y(o.ban) + r} Q${x},${y(o.ban)} ${x + r},${y(o.ban)} H${x + bw - r} Q${x + bw},${y(o.ban)} ${x + bw},${y(o.ban) + r} V${y(0)} Z` }));
            }
            const show = ev => showTip(ev, h("b", {}, df.format(new Date(o.d))),
                h("div", {}, h("i", { class: "sw sw-ban" }), o.ban + " ban" + (o.ban > 1 ? "s" : "")),
                h("div", {}, h("i", { class: "sw sw-found" }), fmtN(o.found) + " tentative" + (o.found > 1 ? "s" : "") + " relevée" + (o.found > 1 ? "s" : "")));
            col.addEventListener("mousemove", show);
            col.addEventListener("focus", show);
            col.addEventListener("mouseleave", hideTip);
            col.addEventListener("blur", hideTip);
            g.append(col);
            if (i % every === 0 || i === out.length - 1)
                g.append(svg("text", { class: "axis", x: L + i * cw + cw / 2, y: H - 6, "text-anchor": i === out.length - 1 ? "end" : "middle" },
                    i === out.length - 1 ? "auj." : dshort.format(new Date(o.d))));
        });
        const total = out.reduce((a, o) => a + o.ban, 0);
        return h("div", { class: "bc-wrap" }, h("div", { class: "bc-legend" },
            h("span", {}, h("i", { class: "sw sw-ban" }), "Bans (échelle de gauche)"),
            h("span", {}, h("i", { class: "sw sw-found" }), "Tentatives relevées (échelle de droite)"),
            h("span", { class: "muted" }, `${total} ban${total > 1 ? "s" : ""} · max ${maxB} / jour`)), g);
    }
    function showTip(ev, ...kids) {
        const t = $("#tip");
        t.replaceChildren(...kids);
        t.hidden = false;
        const r = ev.clientX !== undefined && ev.type !== "focus" ? { x: ev.clientX, y: ev.clientY } : (() => { const b = ev.currentTarget.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top }; })();
        t.style.left = Math.max(8, Math.min(r.x + 14, window.innerWidth - t.offsetWidth - 8)) + "px";
        t.style.top = Math.max(8, r.y - t.offsetHeight - 10) + "px";
    }
    function hideTip() { $("#tip").hidden = true; }

    /* ------------------------------------------------------------ vue d'ensemble */
    function tile(name, ic, val, fmt, small, tab, cls) {
        const big = h("span", { class: "big" }, "0");
        const t = h("button", { class: "tile" + (cls ? " " + cls : ""), type: "button", onclick: () => setTab(tab) },
            h("span", { class: "nm" }, icon(ic), name), big, h("span", { class: "small" }, small));
        if (typeof val === "number") countUp(big, val, fmt); else big.textContent = val;
        return t;
    }
    RENDER.overview = force => withPanel("overview", ["jails", "history", "tasks", "certs"], (p, jails, hist, tasks, certs) => {
        const nJails = jails.instances.reduce((a, i) => a + i.jails.length, 0);
        const banned = jails.instances.reduce((a, i) => a + i.jails.reduce((b, j) => b + j.banned, 0), 0);
        const down = jails.instances.filter(i => !i.running).map(i => i.instance);
        const since24 = Date.now() - 86400e3;
        const bans24 = hist.events.filter(e => e.a === "Ban" && parseT(e.t) > since24).length;
        const failedT = [], deadCron = [];
        for (const i of tasks.instances) {
            for (const t of i.timers) if (t.result && t.result !== "success") failedT.push(i.instance + " : " + t.unit);
            if (i.cron.entries.length && i.cron.daemon && !i.cron.running) deadCron.push(i.instance);
        }
        const le = certs.certs.filter(c => c.renewal && c.renewal.authenticator);
        const minDays = le.length ? Math.min(...le.map(c => c.days)) : null;
        const mismatch = le.filter(c => Object.values(c.served).some(s => s && s !== c.serial));
        setBannedCount(jails);

        const probs = [];
        if (down.length) probs.push(["err", "fail2ban arrêté sur : " + down.join(", "), "jails"]);
        if (failedT.length) probs.push(["err", "Tâches en échec : " + failedT.join(", "), "tasks"]);
        if (minDays !== null && minDays < 20) probs.push(["err", `Un certificat expire dans ${minDays} jours`, "certs"]);
        if (mismatch.length) probs.push(["warn", "Certificat servi différent du fichier (nginx à recharger ?) : " +
            mismatch.map(c => c.name).join(", "), "certs"]);
        if (deadCron.length) probs.push(["warn", "Démon cron arrêté (ses tâches ne s'exécutent plus) : " +
            deadCron.join(", "), "tasks"]);

        const tiles = [
            tile("IP bannies en ce moment", "ban", banned, null, `${nJails} prisons sur ${jails.instances.length} machines`, "jails", banned ? "hot" : ""),
            tile("Bans sur 24 h", "shield", bans24, null, `${fmtN(hist.events.filter(e => e.a === "Ban").length)} sur ${hist.days} jours`, "history"),
            tile("Tâches planifiées", "clock", tasks.instances.reduce((a, i) => a + i.timers.length, 0), null,
                failedT.length ? `${failedT.length} en échec` : "aucune en échec", "tasks", failedT.length ? "bad" : ""),
            tile("Certificats", "cert", minDays === null ? "–" : minDays, v => Math.round(v) + " j", "avant la prochaine expiration", "certs", minDays !== null && minDays < 20 ? "bad" : ""),
        ];
        tiles.forEach((t, i) => rise(t, i));
        p.append(card("État", null,
            h("div", { class: "tiles" }, tiles),
            h("h3", { style: "margin-top:18px" }, "Points d'attention"),
            probs.length ? h("ul", { class: "probs" }, probs.map(([c, t, tab]) => h("li", {},
                badge(c === "err" ? "st-err" : "st-quiet", c === "err" ? "Problème" : "À vérifier"), " ",
                h("button", { class: "ipbtn", type: "button", onclick: () => setTab(tab) }, t))))
                : h("p", { class: "allgood" }, badge("st-ok", "OK"), " Rien à signaler.")));

        p.append(card(`Bans sur ${Math.min(hist.days, 30)} jours`, withIcon(h("button", { class: "btn small", type: "button", onclick: () => setTab("history") }, "Historique"), "arrow"),
            banChart(hist.per_day, Math.min(hist.days, 30))));

        const recent = hist.events.filter(e => e.a === "Ban").slice(0, 10);
        p.append(card("Derniers bannissements", withIcon(h("button", { class: "btn small", type: "button", onclick: () => setTab("history") }, "Tout l'historique"), "arrow"),
            recent.length ? table(["Quand", "Machine", "Prison", "IP", "Fin du ban"], recent.map(e => {
                const jl = jails.instances.find(i => i.instance === e.i);
                const j = jl && jl.jails.find(x => x.name === e.j);
                const still = j && j.ips.includes(e.ip);
                return h("tr", { class: still ? "warnrow" : "" },
                    h("td", { class: "nw", title: fmtTime(e.t) }, rel(e.t)), h("td", {}, e.i), h("td", {}, e.j), h("td", {}, ipBtn(e.ip)),
                    h("td", {}, still ? countdown(parseT(e.t).getTime(), j.bantime) : h("span", { class: "muted small" }, "levé")));
            })) : empty("Aucun bannissement sur la période.")));
    }, force);

    function setBannedCount(jails) {
        const n = jails.instances.reduce((a, i) => a + i.jails.reduce((b, j) => b + j.banned, 0), 0);
        const el = $("#n-banned");
        el.hidden = !n;
        el.textContent = n;
    }

    /* ------------------------------------------------------------ prisons */
    async function doBan(inst, jail, ip, unban) {
        try {
            await api(unban ? "unban" : "ban", inst, jail, ip);
            toast(unban ? `${ip} débannie (${inst} / ${jail === "--all" ? "toutes les prisons" : jail})`
                : `${ip} bannie (${inst} / ${jail}) pour la durée de la prison`);
            delete S.data.history;
            RENDER.jails(true);
        } catch (e) { toast(e.message, true); }
    }
    async function askUnban(inst, jail, ip) {
        if (await confirmDlg("Débannir " + ip + " ?", h("p", {}, `L'adresse pourra de nouveau accéder aux services surveillés par la prison « ${jail} » sur ${inst}.`), "Débannir"))
            doBan(inst, jail, ip, true);
    }
    async function askBan(preset) {
        const jails = await load("jails", ["jails"]);
        const sel = h("select", { name: "target", required: true, id: "ban-target" },
            jails.instances.flatMap(i => i.jails.map(j => h("option", { value: i.instance + "\u0001" + j.name,
                selected: preset && preset.i === i.instance && preset.j === j.name }, `${i.instance} / ${j.name} (${dur(j.bantime)})`))));
        const ipIn = h("input", { name: "ip", required: true, value: (preset && preset.ip) || "", placeholder: "ex. 203.0.113.7", spellcheck: false, id: "ban-ip" });
        const f = await confirmDlg("Bannir une IP manuellement", [
            h("label", { for: "ban-ip" }, "Adresse IP", ipIn),
            h("label", { for: "ban-target" }, "Prison (le ban dure le « bantime » de la prison : 30 jours)", sel),
            h("p", { class: "hint" }, "Les adresses privées et celles des containers (10.0.3.0/24) sont refusées.")], "Bannir", true);
        if (!f) return;
        const [inst, jail] = sel.value.split("\u0001");
        doBan(inst, jail, ipIn.value.trim(), false);
    }

    RENDER.jails = force => withPanel("jails", ["jails", "history"], (p, d, hist) => {
        setBannedCount(d);
        p.append(h("div", { class: "row", style: "margin-bottom:14px" },
            withIcon(h("button", { class: "btn primary", type: "button", onclick: () => askBan() }, "Bannir une IP…"), "ban"),
            h("span", { class: "muted small" }, "Cliquer sur une IP pour tout savoir d'elle ; ✕ pour la débannir. Compte à rebours = fin du ban (bantime de la prison).")));
        d.instances.forEach((inst, k) => {
            const rows = inst.jails.map(j => h("tr", { class: j.banned ? "warnrow" : "" },
                h("td", { class: "nw" }, h("strong", {}, j.name)),
                h("td", { class: "num" }, j.banned ? h("span", { class: "st st-err" }, fmtN(j.banned)) : "0"),
                h("td", { class: "num" }, fmtN(j.total_banned)),
                h("td", { class: "num" }, fmtN(j.failed)),
                h("td", { class: "num" }, fmtN(j.total_failed)),
                h("td", { class: "nw", title: "Ban de cette durée après maxretry échecs en findtime" },
                    `${j.maxretry} en ${dur(j.findtime)} → ${dur(j.bantime)}`),
                h("td", { class: "wrap hide-sm small muted mono" }, j.files.join(" ")),
                h("td", { class: "ips" }, j.ips.length ? h("div", { class: "chips" }, j.ips.map(ip => h("span", { class: "chip" },
                    h("span", { class: "chip-top" }, ipBtn(ip),
                        h("button", { type: "button", class: "x", title: "Débannir " + ip, "aria-label": "Débannir " + ip,
                            onclick: () => askUnban(inst.instance, j.name, ip) }, "✕")),
                    countdown(banStart(hist, inst.instance, j.name, ip), j.bantime)))) : h("span", { class: "muted" }, "—"))));
            p.append(rise(h("section", { class: "card inst" },
                h("div", { class: "inst-h" }, h("span", { class: "dot " + (inst.running ? "ok live" : "err"), "aria-hidden": "true" }),
                    h("h3", {}, inst.instance === HOST ? "Hôte (Portfolio)" : "Container " + inst.instance),
                    inst.running ? badge("st-ok", "fail2ban actif") : badge("st-err", "fail2ban arrêté"),
                    inst.error ? h("span", { class: "muted small" }, inst.error) : null),
                inst.jails.length ? table(["Prison", "Bannies", "Total bans", "Échecs en cours", "Total échecs", "Règle", "Surveille", "IP bannies"], rows)
                    : empty("Aucune prison active.")), k));
        });
    }, force);

    /* ------------------------------------------------------------ historique */
    RENDER.history = force => withPanel("history", ["history"], (p, d) => {
        const daysSel = h("select", { "aria-label": "Période", onchange: e => { S.histDays = +e.target.value; delete S.data.history; RENDER.history(true); } },
            [7, 30, 90, 365].map(n => h("option", { value: n, selected: n === S.histDays }, n + " jours")));
        p.append(card(`Bans par jour`, daysSel, banChart(d.per_day, Math.min(d.days, 90)),
            h("p", { class: "hint" }, "Sources : fail2ban.log (et ses archives) de l'hôte et de chaque container. " +
                "La rotation garde ~4 semaines d'historique. Survolez une barre pour le détail.")));

        const top = d.top.length ? Math.max(...d.top.map(t => t.n)) : 1;
        const g2 = h("div", { class: "grid2" },
            card("IP les plus bannies", null, d.top.length ? table(["IP", "Bans"], d.top.map(t => h("tr", {},
                h("td", {}, ipBtn(t.ip)), h("td", { class: "num" }, h("span", { class: "hbar" }, h("i", { style: `width:${t.n / top * 100}%` }), h("b", {}, t.n)))))) : empty("Aucune.")),
            card("Tentatives relevées par prison", null, d.found.length ? table(["Machine", "Prison", "Tentatives"], d.found.map(f => h("tr", {},
                h("td", {}, f.i), h("td", {}, f.j), h("td", { class: "num" }, fmtN(f.n))))) : empty("Aucune.")));
        p.append(g2);

        const jailsL = [...new Set(d.events.map(e => e.i + " / " + e.j))].sort();
        const q = h("input", { type: "search", placeholder: "Filtrer par IP…", value: S.histQ, spellcheck: false, id: "hist-q", "aria-label": "Filtrer par IP" });
        const js = h("select", { "aria-label": "Prison" }, h("option", { value: "" }, "Toutes les prisons"),
            jailsL.map(j => h("option", { value: j, selected: j === S.histJail }, j)));
        const body = h("tbody");
        const meta = h("p", { class: "meta" });
        const draw = () => {
            S.histQ = q.value.trim(); S.histJail = js.value;
            const rows = d.events.filter(e => (!S.histQ || e.ip.includes(S.histQ)) && (!S.histJail || e.i + " / " + e.j === S.histJail));
            body.textContent = "";
            for (const e of rows.slice(0, 1000)) {
                const cls = e.a === "Unban" ? "" : "bad";
                body.append(h("tr", { class: cls },
                    h("td", { class: "nw", "data-label": "Date" }, fmtTime(e.t)),
                    h("td", { "data-label": "Action" }, e.a === "Unban" ? badge("st-ok", "Débanni") : e.a === "Restore Ban" ? badge("st-info", "Ban restauré")
                        : badge("st-err", e.a === "Increase Ban" ? "Ban prolongé" : "Banni")),
                    h("td", { "data-label": "IP" }, ipBtn(e.ip)), h("td", { "data-label": "Machine" }, e.i), h("td", { "data-label": "Prison" }, e.j)));
            }
            meta.textContent = `${fmtN(rows.length)} événement(s)` + (rows.length > 1000 ? " — 1000 premiers affichés" : "");
        };
        q.addEventListener("input", draw);
        js.addEventListener("change", draw);
        const t = table(["Date", "Action", "IP", "Machine", "Prison"], []);
        t.querySelector("tbody").replaceWith(body);
        t.classList.add("scroll");
        p.append(card("Journal des bans / débans", h("div", { class: "row" }, searchBox(q), js), meta, t));
        draw();
    }, force);

    /* ------------------------------------------------------------ recherche IP */
    function lookup(ip) {
        $("#ip-q").value = ip;
        setTab("ip", { ip });
        runLookup();
    }
    async function runLookup() {
        const ip = $("#ip-q").value.trim();
        const out = $("#ip-out");
        if (!ip) return;
        const p = locPath();
        if (S.tab === "ip" && (p[0] !== "ip" || p[1] !== ip)) { try { cockpit.location.go(["ip", ip]); } catch (e) { /* hors Cockpit */ } }
        out.textContent = "";
        out.append(h("section", { class: "card" }, h("p", { class: "loading" }, `Recherche de ${ip} (whois compris, quelques secondes)…`), skeleton(5)));
        $("#ip-go").classList.add("spin");
        let d;
        try { d = await api("ip", ip); showAlert(""); }
        catch (e) { out.textContent = ""; showAlert(e.message); return; }
        finally { $("#ip-go").classList.remove("spin"); }
        out.textContent = "";
        const w = d.whois || {};
        const verdict = d.bans.length ? badge("st-err", "Bannie en ce moment") : d.history.length ? badge("st-quiet", "Déjà bannie") : badge("st-ok", "Jamais bannie");
        const actions = h("div", { class: "row" },
            d.bans.length ? h("button", { class: "btn", type: "button", onclick: async () => {
                if (await confirmDlg(`Débannir ${d.ip} partout ?`, h("p", {}, "Retire l'adresse de toutes les prisons où elle est bannie."), "Débannir")) {
                    for (const b of d.bans) await doBan(b.i, b.j, d.ip, true);
                    runLookup();
                }
            } }, "Débannir partout") : null,
            !d.private ? withIcon(h("button", { class: "btn danger", type: "button", onclick: () => askBan({ ip: d.ip, i: "nginx", j: "nginx-404" }) }, "Bannir…"), "ban") : null);
        const hist = S.data.history;
        out.append(card(d.ip, verdict,
            h("div", { class: "grid2" },
                h("dl", { class: "kv" },
                    h("dt", {}, "DNS inverse"), h("dd", { class: "mono" }, d.rdns || "—"),
                    h("dt", {}, "Pays"), h("dd", {}, w.pays || (d.private ? "adresse privée" : "—")),
                    h("dt", {}, "Organisation"), h("dd", {}, w.organisation || w.description || "—"),
                    h("dt", {}, "Réseau"), h("dd", { class: "mono" }, [w.réseau, w.plage || w.route].filter(Boolean).join(" · ") || "—"),
                    h("dt", {}, "AS"), h("dd", { class: "mono" }, (w.AS || "").trim() || "—"),
                    h("dt", {}, "Contact abus"), h("dd", { class: "mono" }, w.abus || "—"),
                    w.error ? [h("dt", {}, "whois"), h("dd", {}, w.error)] : null),
                h("dl", { class: "kv" },
                    h("dt", {}, "Bans en cours"), h("dd", {}, d.bans.length ? d.bans.map(b => h("div", { class: "banline" }, `${b.i} / ${b.j} (${dur(b.bantime)}) `,
                        countdown(banStart(hist, b.i, b.j, d.ip) || (d.history.find(e => e.i === b.i && e.j === b.j && e.a !== "Unban") ? parseT(d.history.find(e => e.i === b.i && e.j === b.j && e.a !== "Unban").t).getTime() : null), b.bantime))) : "aucun"),
                    h("dt", {}, "Bans passés"), h("dd", {}, fmtN(d.history.filter(e => e.a === "Ban").length)),
                    h("dt", {}, "Tentatives fail2ban"), h("dd", {}, Object.keys(d.found).length ? Object.entries(d.found).map(([k, v]) => `${k} : ${v}`).join(", ") : "aucune"),
                    h("dt", {}, "Requêtes nginx"), h("dd", {}, fmtN(d.nginx.total) + (d.nginx.total ? " (" + Object.entries(d.nginx.per_vhost).map(([k, v]) => `${k} ${v}`).join(", ") + ")" : "")),
                    h("dt", {}, "SSH bloqué (géo, 7 j)"), h("dd", {}, d.geoblock_7d === null ? "–" : fmtN(d.geoblock_7d) + " paquet(s)"),
                    h("dt", {}, "Listes ipset"), h("dd", { class: "chips" }, Object.entries(d.ipsets).map(([k, v]) =>
                        badge(v ? "st-info" : "st-off", (v ? "✓ " : "") + k))))),
            h("div", { style: "margin-top:12px" }, actions)));

        if (d.history.length)
            out.append(card("Historique fail2ban", null, table(["Date", "Action", "Machine", "Prison"], d.history.map(e => h("tr", {},
                h("td", { class: "nw" }, fmtTime(e.t)), h("td", {}, e.a), h("td", {}, e.i), h("td", {}, e.j))))));
        if (d.nginx.last.length)
            out.append(card(`Dernières requêtes reçues par nginx (${d.nginx.last.length} sur ${fmtN(d.nginx.total)})`, null,
                table(["Date", "Site", "Requête", "Code", "Navigateur"], d.nginx.last.slice().reverse().map(r => h("tr", {},
                    h("td", { class: "nw" }, fmtTime(r.t)), h("td", {}, r.v), h("td", { class: "wrap mono" }, r.r),
                    h("td", {}, h("span", { class: "code c" + String(r.s)[0] }, r.s)), h("td", { class: "wrap small muted hide-sm" }, r.ua))), "scroll")));
        if (d.ssh.length)
            out.append(card("Lignes SSH (30 j)", null, h("pre", { class: "pre" }, d.ssh.join("\n"))));
    }
    $("#ip-form").addEventListener("submit", e => { e.preventDefault(); runLookup(); });
    RENDER.ip = () => { const i = $("#ip-q"); if (i.offsetParent !== null) i.focus(); };

    /* ------------------------------------------------------------ tâches planifiées */
    async function runTimer(inst, t) {
        if (!await confirmDlg(`Lancer ${t.service} maintenant ?`, h("p", {}, `Sur ${inst}. ${t.desc || ""}`), "Lancer")) return;
        try {
            await api("run", inst, t.unit);
            toast(`${t.service} lancé sur ${inst}`);
            setTimeout(() => RENDER.tasks(true), 2500);
        } catch (e) { toast(e.message, true); }
    }
    RENDER.tasks = force => withPanel("tasks", ["tasks"], (p, d) => {
        d.instances.forEach((i, k) => {
            const blocks = [];
            if (i.timers.length) {
                blocks.push(table(["Tâche", "Planning", "Dernière", "Prochaine", "Résultat", ""], i.timers.map(t => {
                    const ok = !t.result || t.result === "success";
                    return h("tr", { class: ok ? "" : "bad" },
                        h("td", {}, h("div", {}, h("strong", {}, t.unit.replace(/\.timer$/, "")), h("div", { class: "small muted" }, t.desc))),
                        h("td", { class: "mono small" }, t.schedule || "–"),
                        h("td", { class: "nw", title: fmtTime(t.last) }, t.last ? rel(t.last) : "jamais"),
                        h("td", { class: "nw", title: fmtTime(t.next) }, t.next ? rel(t.next) : "–"),
                        h("td", {}, t.state === "active" || t.state === "activating" ? badge("st-info", "en cours")
                            : !t.last ? badge("st-off", "–") : ok ? badge("st-ok", "réussi") : badge("st-err", `échec (${t.result}, code ${t.status})`),
                            t.enabled && t.enabled !== "enabled" && t.enabled !== "static" ? [" ", badge("st-quiet", t.enabled)] : null),
                        h("td", { class: "num", "data-label": "" }, withIcon(h("button", { class: "btn small", type: "button", onclick: () => runTimer(i.instance, t) }, "Lancer"), "play")));
                })));
            }
            if (i.cron.entries.length) {
                const st = i.cron.running ? badge("st-ok", `${i.cron.daemon} actif`)
                    : i.cron.daemon ? badge("st-err", `${i.cron.daemon} arrêté — ces lignes ne s'exécutent pas`)
                        : badge("st-off", "pas de démon cron : fichiers fournis par les paquets, remplacés par les timers systemd ci-dessus");
                blocks.push(h("div", { style: "margin-top:12px" }, h("div", { class: "row", style: "margin-bottom:6px" }, h("h3", { style: "margin:0" }, "Crontabs"), st),
                    table(["Quand", "Utilisateur", "Commande", "Fichier"], i.cron.entries.map(c => h("tr", {},
                        h("td", { class: "mono nw" }, c.when), h("td", {}, c.user || "–"), h("td", { class: "mono wrap" }, c.cmd),
                        h("td", { class: "mono small muted wrap" }, c.file))))));
            }
            p.append(rise(h("section", { class: "card inst" },
                h("div", { class: "inst-h" }, h("h3", {}, i.instance === HOST ? "Hôte (Portfolio)" : "Container " + i.instance),
                    h("span", { class: "muted small" }, `${i.timers.length} timer(s), ${i.cron.entries.length} ligne(s) cron`)),
                blocks.length ? blocks : empty("Aucune tâche planifiée.")), k));
        });
    }, force);

    /* ------------------------------------------------------------ certificats */
    RENDER.certs = force => withPanel("certs", ["certs"], (p, d) => {
        const grid = h("div", { class: "certs" });
        d.certs.slice().sort((a, b) => a.days - b.days).forEach((c, k) => {
            const le = !!(c.renewal && c.renewal.authenticator);
            const start = parseT(c.start), end = parseT(c.end);
            const total = Math.max(1, Math.round((end - start) / 86400e3));
            const pct = Math.max(0, Math.min(100, c.days / total * 100));
            const lvl = c.days < 14 ? "e" : c.days < 30 ? "w" : "ok";
            const servedRows = Object.entries(c.served).map(([dom, serial]) => h("li", {},
                h("span", { class: "mono" }, dom),
                !serial ? badge("st-err", "injoignable") : serial === c.serial ? badge("st-ok", "servi, à jour")
                    : badge("st-quiet", "nginx sert un autre certificat (recharger nginx ?)")));
            const renewAt = le ? new Date(end.getTime() - 30 * 86400e3) : null;
            grid.append(rise(h("article", { class: "card cert " + (le ? "le" : "int") },
                h("div", { class: "cert-h" },
                    h("span", { class: "cert-ic" }, icon(le ? "lock" : "cert")),
                    h("div", { class: "cert-n" }, h("h2", {}, c.name), h("span", { class: "small muted" }, c.source)),
                    le ? badge(c.days < 14 ? "st-err" : c.days < 30 ? "st-quiet" : "st-ok", `${c.days} j`) : badge("st-off", "interne")),
                h("div", { class: "cert-life" },
                    h("div", { class: "meter " + lvl, role: "meter", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": c.days,
                        "aria-label": `Validité restante : ${c.days} jours sur ${total}` }, h("i", { style: `width:${pct}%` })),
                    h("div", { class: "cert-x small" }, h("span", {}, df.format(start)),
                        h("span", { class: "tnum" }, `${c.days} j restants sur ${total}`), h("span", {}, df.format(end))),
                    renewAt ? h("p", { class: "hint", style: "margin-top:6px" }, renewAt > Date.now()
                        ? `Renouvellement automatique prévu vers le ${df.format(renewAt)} (30 j avant l'échéance).`
                        : "Dans la fenêtre de renouvellement : certbot devrait le renouveler au prochain passage.") : null),
                h("dl", { class: "kv" },
                    h("dt", {}, "Domaines"), h("dd", { class: "mono" }, c.sans.join(", ") || "–"),
                    h("dt", {}, "Émetteur"), h("dd", {}, c.issuer || "–"),
                    h("dt", {}, "Clé"), h("dd", {}, [c.key && c.key.replace("id-ecPublicKey", "ECDSA").replace("rsaEncryption", "RSA"), c.bits && c.bits + " bits", c.curve].filter(Boolean).join(" · ")),
                    le ? [h("dt", {}, "Renouvellement"), h("dd", {}, `${c.renewal.authenticator} (certbot.timer dans le container nginx, 30 j avant l'échéance)`)] : null,
                    h("dt", {}, "Empreinte SHA-256"), h("dd", { class: "mono small fp" }, c.sha256 || "–")),
                servedRows.length ? h("div", {}, h("h3", { style: "margin-top:12px" }, "Vérification en direct (SNI sur le proxy)"), h("ul", { class: "served" }, servedRows))
                    : h("p", { class: "hint" }, "Certificat interne : Cockpit n'est joignable qu'à travers le proxy nginx, qui présente le certificat Let's Encrypt.")), k));
        });
        p.append(grid);
        if (!d.certs.length) p.append(empty("Aucun certificat trouvé."));
    }, force);

    /* ------------------------------------------------------------ système */
    RENDER.system = force => withPanel("system", ["system"], (p, d) => {
        const b = d.backups || {};
        const disk = b.disk;
        const g1 = h("div", { class: "grid2" });
        g1.append(card("Sauvegardes", null,
            (b.dirs || []).map(dir => h("div", { style: "margin-bottom:10px" },
                h("h3", {}, `${dir.name.toUpperCase()} — ${dir.count} fichier(s), ${fmtSize(dir.size)}`),
                table(["Fichier", "Taille", "Date"], dir.last.map(f => h("tr", {},
                    h("td", { class: "mono wrap small" }, f.f), h("td", { class: "num" }, fmtSize(f.size)),
                    h("td", { class: "nw", title: fmtTime(f.t) }, rel(f.t))))))),
            disk ? [h("h3", {}, `Disque de l'hôte : ${fmtSize(disk.used)} / ${fmtSize(disk.size)} (${fmtSize(disk.avail)} libres)`),
                h("div", { class: "meter " + (disk.used / disk.size > .9 ? "e" : disk.used / disk.size > .75 ? "w" : "") },
                    h("i", { style: `width:${disk.used / disk.size * 100}%` }))] : null));
        const gb = d.geoblock || {};
        g1.append(card("SSH : géoblocage (24 h)", null,
            h("dl", { class: "kv" },
                h("dt", {}, "Paquets bloqués"), h("dd", {}, fmtN(gb.blocked_24h)),
                h("dt", {}, "IP distinctes"), h("dd", {}, fmtN(gb.distinct)),
                h("dt", {}, "Listes ipset"), h("dd", {}, Object.entries(gb.ipsets || {}).map(([k, v]) => `${k} : ${fmtN(v)}`).join(" · "))),
            (gb.top || []).length ? h("div", { style: "margin-top:10px" }, table(["IP la plus insistante", "Paquets"], gb.top.map(t => h("tr", {},
                h("td", {}, ipBtn(t.ip)), h("td", { class: "num" }, fmtN(t.n)))))) : null));
        p.append(g1);

        p.append(card("Connexions à l'hôte (14 j)", null, (d.logins || []).length ? table(["Date", "Type", "Utilisateur", "Depuis", ""],
            d.logins.map(l => h("tr", { class: l.ok ? "" : "bad" }, h("td", { class: "nw" }, fmtTime(l.t)), h("td", {}, l.kind), h("td", {}, l.user),
                h("td", {}, /^[0-9a-f.:]+$/i.test(l.from) ? ipBtn(l.from) : l.from),
                h("td", { "data-label": "Résultat" }, l.ok ? badge("st-ok", "réussie") : badge("st-err", "refusée")))), "scroll") : empty("Aucune connexion.")));

        p.append(card("Mises à jour en attente", null, table(["Machine", "Paquets", "Dont sécurité", "Redémarrage requis", "Dernière vérification"],
            (d.updates || []).map(u => h("tr", { class: u.security && u.security.length ? "bad" : u.n ? "warnrow" : "" },
                h("td", {}, u.instance), h("td", { class: "num", title: (u.pkgs || []).join(", ") }, u.mgr ? fmtN(u.n) : "–"),
                h("td", { class: "num", title: (u.security || []).join(", ") }, u.security ? fmtN(u.security.length) : "–"),
                h("td", {}, u.reboot ? badge("st-quiet", "oui") : "non"),
                h("td", { class: "nw" }, u.refreshed ? rel(u.refreshed) : "–")))),
            h("p", { class: "hint" }, "unattended-upgrades installe automatiquement les correctifs de sécurité chaque jour (apt-daily-upgrade.timer).")));

        const pub = a => /^(0\.0\.0\.0|\[::\]|\*):/.test(a);
        p.append(card("Ports en écoute", null, (d.ports || []).map(i => h("div", { class: "inst" },
            h("div", { class: "inst-h" }, h("h3", {}, i.instance === HOST ? "Hôte (Portfolio)" : i.instance)),
            table(["Proto", "Adresse", "Programme", "Exposition"], i.ports.map(r => h("tr", {},
                h("td", {}, r.proto), h("td", { class: "mono" }, r.addr), h("td", {}, r.proc || "–"),
                h("td", {}, pub(r.addr) ? badge(i.instance === HOST ? "st-quiet" : "st-off", i.instance === HOST ? "toutes interfaces" : "réseau interne") : "")))))),
            h("p", { class: "hint" }, "Depuis Internet : 80/443 sont redirigés vers nginx (10.0.3.10) ; sur l'hôte, seul SSH (22, géobloqué) est prévu pour être public.")));
    }, force);

    let rz, lastW = window.innerWidth;
    window.addEventListener("resize", () => {
        clearTimeout(rz);
        rz = setTimeout(() => {
            if (window.innerWidth === lastW) return;      // clavier virtuel : la hauteur seule change
            lastW = window.innerWidth;
            if (["overview", "history"].includes(S.tab)) RENDER[S.tab]();
        }, 250);
    });

    /* ------------------------------------------------------------ démarrage */
    $("#glyph").append(icon("shield"));
    withIcon($("#refresh"), "refresh");
    withIcon($("#ip-go"), "search");
    const ipq = $("#ip-q");
    $("#ipwrap").replaceChildren(searchBox(ipq));
    slashFocus(() => S.tab === "history" ? $("#hist-q") : S.tab === "ip" ? ipq : null);
    $("#refresh").addEventListener("click", async () => {
        S.data = {};
        const b = $("#refresh");
        if (S.tab === "ip") { runLookup(); return; }
        b.classList.add("spin");
        await RENDER[S.tab](true);
        b.classList.remove("spin");
        toast("Données actualisées.");
    });
    // onglet initial : chemin Cockpit (/securite/jails, /securite/certs, /securite/ip/1.2.3.4…), sinon dernier onglet de la session
    const p0 = locPath();
    if (TABS.includes(p0[0])) {
        if (p0[0] === "ip" && p0[1]) { ipq.value = p0[1]; setTab("ip", { fromLocation: true, initial: true }); runLookup(); }
        else setTab(p0[0], { fromLocation: true, initial: true });
    } else {
        let start = "overview";
        try { start = sessionStorage.getItem("securite:tab") || "overview"; } catch (e) { /* ignoré */ }
        setTab(RENDER[start] ? start : "overview", { initial: true, fromLocation: start === "overview" });
    }
    // le compteur de l'onglet Prisons se remplit dès que les données sont là
    load("jails", ["jails"]).then(setBannedCount).catch(() => {});
})();
