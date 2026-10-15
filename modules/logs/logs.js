/* Module Cockpit « Journaux centralisés » (thème partagé ../studio).
 * Lecture seule : tout passe par l'assistant /usr/local/libexec/cockpit-logs (via sudo, règle limitée à
 * ce seul script). Le navigateur ne fournit que des paramètres validés côté serveur. Tout texte issu des
 * journaux est inséré avec textContent (jamais innerHTML) : une ligne de log piégée ne peut rien exécuter. */
"use strict";
(() => {
    const { h, svg, icon, toast, skeleton, countUp, slashFocus, searchBox, rise, nf } = Studio;
    const HELPER = ["sudo", "-n", "/usr/local/libexec/cockpit-logs"];
    const LIVE_MS = 2000;
    const $ = (sel, root = document) => root.querySelector(sel);

    const S = {
        list: null, stats: null,
        sel: null,              // {mode: "file", machine, file} | {mode: "all"}
        lines: [],              // lignes brutes reçues (avant filtre de gravité)
        offset: null,           // position de lecture pour le mode direct
        liveTimer: null, reqId: 0,
        lvl: "all",             // all | warn | err
    };

    /* ------------------------------------------------------------ utilitaires */
    const fmtN = n => nf.format(n);
    function fmtSize(n) {
        if (n >= 1048576) return (n / 1048576).toFixed(1).replace(".", ",") + " Mo";
        if (n >= 1024) return Math.round(n / 1024) + " Ko";
        return n + " o";
    }
    const dtf = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    function fmtTime(iso) {
        const d = new Date(iso);
        return isNaN(d) ? iso : dtf.format(d);
    }
    function ago(iso) {
        const s = (Date.now() - new Date(iso)) / 1000;
        if (!isFinite(s)) return "–";
        if (s < 60) return "à l'instant";
        if (s < 3600) return "il y a " + Math.round(s / 60) + " min";
        if (s < 86400) return "il y a " + Math.round(s / 3600) + " h";
        return "il y a " + Math.round(s / 86400) + " j";
    }

    function showAlert(msg) {
        const a = $("#alert");
        a.hidden = !msg;
        a.textContent = msg || "";
    }

    /* ------------------------------------------------------------ appels à l'assistant */
    function friendly(e) {
        const m = (e && (e.message || e.problem)) || String(e);
        if (/password is required|not allowed|may not run sudo|not in the sudoers/i.test(m))
            return "Droit manquant : ce compte n'est pas autorisé à lancer l'assistant des journaux.\n" +
                   "En root sur l'hôte : install -m 440 /root/cockpit-logs.sudoers /etc/sudoers.d/cockpit-logs && visudo -c";
        if (/not-found|No such file/i.test(m)) return "Assistant introuvable : /usr/local/libexec/cockpit-logs.";
        return m;
    }

    async function api(args) {
        let raw;
        try { raw = await cockpit.spawn([...HELPER, ...args], { err: "message" }); }
        catch (e) { throw new Error(friendly(e)); }
        const j = JSON.parse(raw);
        if (j.error) throw new Error(j.error);
        return j;
    }

    /* ------------------------------------------------------------ classification des lignes */
    const ERR_RE = /\b(error|erreur|err|fail(ed|ure)?|crit(ical)?|fatal|panic|emerg|alert|denied|refused|segfault|out of memory|oom|killed process|ban)\b/i;
    const WARN_RE = /\b(warn(ing)?|invalid|timed? ?out|not found|deprecated|unban|retry|disconnect(ed)?)\b/i;
    const HTTP_RE = /" ([1-5]\d\d) [\d-]+ /;

    function level(e) {
        if (/access/.test(e.p)) {
            const m = HTTP_RE.exec(e.m);
            if (!m) return "";
            return m[1][0] === "5" ? "err" : m[1][0] === "4" ? "warn" : "";
        }
        if (ERR_RE.test(e.m)) return "err";
        if (WARN_RE.test(e.m)) return "warn";
        return "";
    }

    /* ------------------------------------------------------------ graphique d'activité */
    function drawChart() {
        const box = $("#chart");
        box.textContent = "";
        const data = S.stats ? S.stats.hours : [];
        if (!data.length) return;
        const W = Math.max(box.clientWidth, 280), H = box.clientHeight || 170;
        const L = 40, R = 4, T = 6, B = 20;
        const max = Math.max(1, ...data.map(d => d.n));
        const step = niceStep(max);
        const top = Math.ceil(max / step) * step;
        const y = v => T + (H - T - B) * (1 - v / top);
        const cw = (W - L - R) / data.length;
        const bw = Math.max(1, Math.min(cw - 2, 28));

        const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
            "aria-label": `Lignes de journal par heure : ${fmtN(data.reduce((a, d) => a + d.n, 0))} au total` });
        for (let v = 0; v <= top; v += step) {
            g.append(svg("line", { class: "grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
            g.append(svg("text", { class: "axis", x: L - 6, y: y(v) + 4, "text-anchor": "end" }, fmtN(v)));
        }
        const every = Math.ceil(data.length / Math.max(2, Math.floor((W - L) / 56)));
        data.forEach((d, i) => {
            const x = L + i * cw + (cw - bw) / 2;
            const col = svg("g", { class: "col" });
            col.style.setProperty("--i", i);
            col.append(svg("rect", { class: "hit", x: L + i * cw, y: T, width: cw, height: H - T - B, rx: 3 }));
            const errH = y(0) - y(d.err), okH = y(0) - y(d.n - d.err);
            // erreurs à la base (toujours visibles), le reste au-dessus, 2 px d'écart entre segments
            if (d.err) col.append(svg("path", { class: "bar-err", d: barPath(x, y(0) - errH, bw, errH, !(d.n - d.err)) }));
            if (d.n - d.err) {
                const gap = d.err ? 2 : 0;
                const hh = Math.max(0, okH - gap);
                col.append(svg("path", { class: "bar-ok", d: barPath(x, y(0) - errH - gap - hh, bw, hh, true) }));
            }
            col.addEventListener("mousemove", ev => tip(ev, d));
            col.addEventListener("mouseleave", () => { $("#tip").hidden = true; });
            g.append(col);
            if (i % every === 0) {
                const dt = new Date(d.t);
                g.append(svg("text", { class: "axis", x: L + i * cw + cw / 2, y: H - 4, "text-anchor": "middle" },
                    data.length > 48 ? dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " + dt.getHours() + "h" : dt.getHours() + "h"));
            }
        });
        box.append(g);
    }
    // barre dont seul le haut est arrondi (4 px), ancrée sur la ligne de base
    function barPath(x, yTop, w, hgt, roundTop) {
        if (hgt <= 0) return "";
        const r = roundTop ? Math.min(4, w / 2, hgt) : 0;
        const yb = yTop + hgt;
        return `M${x},${yb} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yb} Z`;
    }
    function niceStep(max) {
        const raw = max / 3, p = Math.pow(10, Math.floor(Math.log10(raw)));
        const m = raw / p;
        return Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p);
    }
    function tip(ev, d) {
        const t = $("#tip");
        const a = new Date(d.t), b = new Date(a.getTime() + 3600e3);
        const f = x => x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        t.textContent = "";
        t.append(h("b", null, a.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + " · " + f(a) + "–" + f(b)),
            h("div", null, h("i", { class: "sw sw-ok" }), fmtN(d.n) + " lignes"),
            h("div", null, h("i", { class: "sw sw-err" }), fmtN(d.err) + " erreur" + (d.err > 1 ? "s" : "")));
        t.hidden = false;
        const x = Math.max(8, Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8));
        t.style.left = x + "px";
        t.style.top = Math.max(8, ev.clientY - t.offsetHeight - 10) + "px";
    }

    /* ------------------------------------------------------------ tuiles par machine */
    function drawTiles() {
        const box = $("#tiles");
        const firstTime = !box.querySelector(".tile");
        box.textContent = "";
        if (!S.list || !S.stats) return;
        S.list.machines.forEach((m, i) => {
            const s = S.stats.machines[m.name] || { n: 0, err: 0, last: null };
            const sel = S.sel && S.sel.mode === "file" && S.sel.machine === m.name;
            const big = h("span", { class: "big" }, fmtN(s.n));
            const t = h("button", { type: "button", class: "tile" + (sel ? " sel" : "") + (s.err ? " has-err" : ""), onclick: () => pickMachine(m.name, true),
                "aria-pressed": String(!!sel) },
                h("span", { class: "nm" }, h("span", { class: "dot " + (s.err ? "err" : s.last ? "ok" : ""), "aria-hidden": "true" }), m.name),
                big, h("span", { class: "small" }, "lignes sur la période"),
                s.err ? h("span", { class: "st st-err" }, "⚠ " + fmtN(s.err) + " erreur" + (s.err > 1 ? "s" : ""))
                      : h("span", { class: "st st-ok" }, "✓ aucune erreur"),
                h("span", { class: "small" }, s.last ? "dernier message " + ago(s.last) : "rien sur la période"));
            if (firstTime) { rise(t, i); big.dataset.v = 0; countUp(big, s.n); }
            box.append(t);
        });
    }

    /* ------------------------------------------------------------ arborescence des sources */
    const current = f => !/\.gz$|-\d{8}$|\.log-\d{8}/.test(f.name);

    function drawTree() {
        const tree = $("#tree");
        tree.textContent = "";
        $("#src-all").setAttribute("aria-current", S.sel && S.sel.mode === "all" ? "true" : "false");
        for (const m of S.list.machines) {
            const files = m.files.filter(current);
            const open = S.sel && S.sel.mode === "file" && S.sel.machine === m.name;
            const grp = h("details", { class: "grp", open: open || !S.sel },
                h("summary", {}, h("span", {}, m.name), h("small", {}, files.length)));
            for (const f of files) {
                const on = open && S.sel.file === f.name;
                grp.append(h("button", { type: "button", class: "src", "aria-current": on ? "true" : "false",
                    title: "Modifié " + ago(new Date(f.mtime * 1000).toISOString()),
                    onclick: () => pick({ mode: "file", machine: m.name, file: f.name }) },
                    h("span", null, f.name.replace(/\.log$/, "")), h("small", null, fmtSize(f.size))));
            }
            tree.append(grp);
        }
    }

    function machine(name) { return S.list && S.list.machines.find(m => m.name === name); }

    function pickMachine(name, scroll) {
        const m = machine(name);
        if (!m) return;
        const cur = m.files.filter(current).sort((a, b) => b.mtime - a.mtime);
        if (cur.length) pick({ mode: "file", machine: name, file: cur[0].name });
        if (scroll) $(".viewer").scrollIntoView({ behavior: Studio.reduced() ? "auto" : "smooth", block: "start" });
    }

    function pick(sel) {
        S.sel = sel;
        try { localStorage.setItem("logs:sel", JSON.stringify(sel)); } catch (e) { /* facultatif */ }
        drawTree();
        drawTiles();
        const all = sel.mode === "all";
        $("#v-title").textContent = all ? "Recherche dans toutes les machines" : sel.machine;
        const vf = $("#v-file");
        vf.hidden = all;
        vf.textContent = "";
        if (!all) {
            const m = machine(sel.machine);
            const base = sel.file.replace(/\.log.*$/, "");
            // le fichier courant + ses archives logrotate (…log-AAAAMMJJ[.gz]), plus récentes d'abord
            m.files.filter(f => f.name.replace(/\.log.*$/, "") === base)
                .sort((a, b) => b.mtime - a.mtime)
                .forEach(f => vf.append(h("option", { value: f.name, selected: f.name === sel.file },
                    current(f) ? f.name + " (en cours)" : f.name + " — " + fmtSize(f.size))));
        }
        $("#hours").hidden = !all;
        $(".log").classList.toggle("one-host", !all);
        const live = $("#live");
        live.disabled = !all && /\.gz$/.test(sel.file);
        if (live.disabled) live.checked = false;
        load();
    }

    /* ------------------------------------------------------------ chargement des lignes */
    function rowsSkeleton() {
        const tb = $("#rows");
        if (tb.children.length) return;
        tb.append(...[0, 1, 2, 3, 4, 5].map(() => h("tr", { class: "skel-row" }, h("td", { colspan: 4 }, h("span", { class: "skel" })))));
    }

    async function load() {
        stopLive();
        const id = ++S.reqId;
        const q = $("#q").value.trim(), rx = $("#rx").checked, n = $("#n").value;
        const opt = ["--lines", n];
        if (q) opt.push("--grep", q);
        if (q && rx) opt.push("--regex");
        $("#v-meta").textContent = "Chargement…";
        $("#log-wrap").setAttribute("aria-busy", "true");
        rowsSkeleton();
        try {
            const r = S.sel.mode === "all"
                ? await api(["search", "--hours", $("#hours").value, ...opt])
                : await api(["read", S.sel.machine, S.sel.file, ...opt]);
            if (id !== S.reqId) return;          // une requête plus récente a pris le relais
            S.lines = r.lines;
            S.offset = r.offset;
            const shown = render(false);
            $("#v-meta").textContent = S.sel.mode === "all"
                ? `${fmtN(r.total)} correspondance${r.total > 1 ? "s" : ""}` + (r.total > r.lines.length ? ` · ${fmtN(r.lines.length)} plus récentes affichées` : "") + ` · ${fmtN(shown)} après filtre de gravité`
                : `${fmtN(r.scanned)} lignes dans le fichier · ${fmtN(r.lines.length)} chargées · ${fmtN(shown)} affichées`;
            showAlert("");
            const w = $("#log-wrap");
            w.scrollTop = w.scrollHeight;
            if ($("#live").checked) startLive();
        } catch (e) {
            if (id !== S.reqId) return;
            $("#v-meta").textContent = "";
            $("#rows").textContent = "";
            showAlert(e.message);
        } finally {
            if (id === S.reqId) $("#log-wrap").removeAttribute("aria-busy");
        }
        liveIndicator();
    }

    function filterRe(q, rx, flags) {
        try { return new RegExp(rx ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags); } catch (e) { return null; }
    }

    function highlight(text, q, rx) {
        if (!q) return [text];
        const re = filterRe(q, rx, "gi");
        if (!re) return [text];
        const out = [];
        let last = 0, m;
        while ((m = re.exec(text)) && out.length < 200) {
            if (!m[0]) { re.lastIndex++; continue; }
            out.push(text.slice(last, m.index), h("mark", null, m[0]));
            last = m.index + m[0].length;
        }
        out.push(text.slice(last));
        return out;
    }

    const LV_LABEL = { err: "Erreur probable", warn: "Avertissement probable", "": "Information" };
    function row(e, q, rx, fresh) {
        const lv = level(e);
        const msg = highlight(e.m, q, rx);
        const code = /access/.test(e.p) && HTTP_RE.exec(e.m);
        const p = e.p + (S.sel.mode === "all" && e.f && !e.p.startsWith(e.f.replace(/\.log$/, "")) ? " · " + e.f : "");
        return h("tr", { class: ["lv-" + (lv || "info"), lv, fresh ? "new" : ""].join(" ").trim(), title: LV_LABEL[lv] },
            h("td", { class: "t", title: e.t }, h("span", { class: "sev", "aria-label": LV_LABEL[lv] }), fmtTime(e.t)),
            h("td", { class: "h" }, highlight(e.h, q, rx)),
            h("td", { class: "p" }, highlight(p, q, rx)),
            h("td", { class: "m" }, code ? h("span", { class: "code c" + code[1][0] }, code[1]) : null, code ? " " : null, msg));
    }

    function keep(e) {
        const want = S.lvl;
        if (want === "all") return true;
        const lv = level(e);
        return want === "err" ? lv === "err" : lv !== "";
    }

    /* pastilles de gravité (avec compteurs) */
    const LVLS = [["all", "Tout", ""], ["warn", "Avert. + erreurs", "warn"], ["err", "Erreurs", "err"]];
    function drawLevels() {
        const counts = { all: S.lines.length, warn: 0, err: 0 };
        for (const e of S.lines) { const lv = level(e); if (lv) counts.warn++; if (lv === "err") counts.err++; }
        $("#lvl").replaceChildren(...LVLS.map(([k, label, cls]) => h("button", {
            type: "button", class: "pill lvl-" + (cls || "all"), "aria-pressed": String(S.lvl === k),
            onclick: () => {
                S.lvl = k;
                try { localStorage.setItem("logs:lvl", k); } catch (e) { /* facultatif */ }
                const n = render(false);
                $("#v-meta").textContent = `${fmtN(S.lines.length)} chargées · ${fmtN(n)} affichées`;
            },
        }, cls ? h("i", { "aria-hidden": "true" }) : null, label, h("span", { class: "n" }, fmtN(counts[k])))));
    }

    function render(append, added) {
        const tb = $("#rows");
        const q = $("#q").value.trim(), rx = $("#rx").checked;
        drawLevels();
        if (!append) {
            tb.textContent = "";
            const frag = document.createDocumentFragment();
            let n = 0;
            for (const e of S.lines) if (keep(e)) { frag.append(row(e, q, rx, false)); n++; }
            tb.append(frag);
            const empty = $("#empty");
            empty.hidden = n > 0;
            empty.textContent = S.lines.length ? "Aucune ligne pour cette gravité." : (q ? "Aucune ligne ne correspond au filtre." : "Fichier vide.");
            return n;
        }
        for (const e of added) if (keep(e)) tb.append(row(e, q, rx, true));
        const max = Number($("#n").value);
        while (tb.children.length > max) tb.firstChild.remove();
        $("#empty").hidden = tb.children.length > 0;
        return tb.children.length;
    }

    /* ------------------------------------------------------------ mode direct */
    function liveIndicator() { $("#live-ind").hidden = !$("#live").checked; }
    function startLive() {
        stopLive();
        S.liveTimer = setTimeout(tick, S.sel.mode === "all" ? 5000 : LIVE_MS);
    }
    function stopLive() { clearTimeout(S.liveTimer); S.liveTimer = null; }

    async function tick() {
        if (!$("#live").checked) return;
        if (S.sel.mode === "all") { load(); return; }
        const id = S.reqId;
        try {
            const r = await api(["follow", S.sel.machine, S.sel.file, String(S.offset || 0)]);
            if (id !== S.reqId) return;
            S.offset = r.offset;
            const q = $("#q").value.trim(), rx = $("#rx").checked;
            let added = r.lines;
            if (q) {
                const re = filterRe(q, rx, "i");
                added = re ? added.filter(e => re.test([e.t, e.h, e.p, e.m].join(" "))) : added;
            }
            if (added.length) {
                const w = $("#log-wrap");
                const atBottom = w.scrollHeight - w.scrollTop - w.clientHeight < 40;
                S.lines = S.lines.concat(added).slice(-Number($("#n").value));
                render(true, added);
                if (atBottom) w.scrollTop = w.scrollHeight;
                $("#v-meta").textContent = `En direct · ${fmtN(added.length)} nouvelle${added.length > 1 ? "s" : ""} ligne${added.length > 1 ? "s" : ""} à ${new Date().toLocaleTimeString("fr-FR")}` + (r.rotated ? " (fichier tourné)" : "");
                const errs = added.filter(e => level(e) === "err").length;
                if (errs && document.hidden === false) toast(`${errs} nouvelle${errs > 1 ? "s" : ""} erreur${errs > 1 ? "s" : ""} sur ${S.sel.machine}`, "err");
            }
        } catch (e) {
            showAlert(e.message);
        }
        if ($("#live").checked && id === S.reqId) startLive();
    }

    /* ------------------------------------------------------------ vue d'ensemble, alertes, rapports */
    async function overview() {
        try {
            const [list, stats, alerts] = await Promise.all([
                api(["list"]), api(["stats", "--hours", $("#range").value]), api(["alerts", "--lines", "200"])]);
            S.list = list;
            S.stats = stats;
            const tot = stats.hours.reduce((a, d) => a + d.n, 0), err = stats.hours.reduce((a, d) => a + d.err, 0);
            const files = list.machines.reduce((a, m) => a + m.files.length, 0);
            $("#summary").textContent = `${list.machines.length} machines · ${files} fichiers · ${fmtN(tot)} lignes et ${fmtN(err)} erreurs probables sur la période · container « logs » (10.0.3.40)`;
            drawChart();
            drawTiles();
            drawTree();
            $("#alerts").textContent = alerts.lines.length ? alerts.lines.slice().reverse().join("\n") : "Aucune alerte enregistrée.";
            const rs = $("#report"), prev = rs.value;
            rs.textContent = "";
            list.reports.forEach(r => rs.append(h("option", { value: r }, r.replace(/^rapport-|\.txt$/g, ""))));
            if (!list.reports.length) $("#report-text").textContent = "Aucun rapport pour l'instant (généré chaque jour à 07:00).";
            else { rs.value = list.reports.includes(prev) ? prev : list.reports[0]; loadReport(); }
            showAlert("");
            return true;
        } catch (e) {
            $("#summary").textContent = "Indisponible";
            $("#chart").textContent = ""; $("#tiles").textContent = "";
            showAlert(e.message);
            return false;
        }
    }

    async function loadReport() {
        const r = $("#report").value;
        if (!r) return;
        try { $("#report-text").textContent = (await api(["report", r])).text || "(vide)"; }
        catch (e) { $("#report-text").textContent = e.message; }
    }

    function download() {
        const txt = S.lines.filter(keep).map(e => [e.t, e.h, e.p, e.m].join(" ")).join("\n") + "\n";
        const name = (S.sel.mode === "all" ? "recherche" : S.sel.machine + "-" + S.sel.file.replace(/\.gz$/, "")) + ".txt";
        const a = h("a", { href: URL.createObjectURL(new Blob([txt], { type: "text/plain" })), download: name });
        document.body.append(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast("Téléchargement : " + name, "ok");
    }

    /* ------------------------------------------------------------ évènements */
    $("#glyph").append(icon("logs"));
    $("#refresh").prepend(icon("refresh"));
    $("#dl").prepend(icon("download"));
    $("#src-all").prepend(icon("search"));
    const qIn = $("#q");
    $("#qwrap").replaceChildren(searchBox(qIn));
    slashFocus(qIn);
    try { const l = localStorage.getItem("logs:lvl"); if (LVLS.some(x => x[0] === l)) S.lvl = l; } catch (e) { /* facultatif */ }
    drawLevels();
    $("#chart").append(h("span", { class: "skel block" }));
    $("#tiles").append(...[0, 1, 2, 3, 4].map(() => h("div", { class: "tile" }, skeleton(3))));
    $("#tree").append(skeleton(6));
    rowsSkeleton();

    let deb;
    qIn.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(load, 400); });
    qIn.addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(deb); load(); } });
    $("#rx").addEventListener("change", load);
    $("#n").addEventListener("change", load);
    $("#hours").addEventListener("change", load);
    $("#live").addEventListener("change", e => { liveIndicator(); if (e.target.checked) load(); else stopLive(); });
    $("#v-file").addEventListener("change", e => pick({ mode: "file", machine: S.sel.machine, file: e.target.value }));
    $("#src-all").addEventListener("click", () => pick({ mode: "all" }));
    $("#dl").addEventListener("click", download);
    $("#report").addEventListener("change", loadReport);
    $("#range").addEventListener("change", overview);
    $("#refresh").addEventListener("click", async () => {
        const b = $("#refresh");
        b.classList.add("spin");
        const ok = await overview();
        if (S.sel) load();
        b.classList.remove("spin");
        if (ok) toast("Journaux actualisés.", "ok");
    });
    let rz;
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(drawChart, 150); });
    // vue d'ensemble rafraîchie chaque minute
    setInterval(() => { if (!document.hidden) overview(); }, 60000);

    (async () => {
        if (!(await overview())) return;
        let sel = null;
        try { sel = JSON.parse(localStorage.getItem("logs:sel") || "null"); } catch (e) { /* facultatif */ }
        if (sel && sel.mode === "all") pick(sel);
        else if (sel && machine(sel.machine) && machine(sel.machine).files.some(f => f.name === sel.file)) pick(sel);
        else {
            const m = machine("nginx") || S.list.machines[0];
            if (m) pickMachine(m.name, false);
        }
    })();
})();
