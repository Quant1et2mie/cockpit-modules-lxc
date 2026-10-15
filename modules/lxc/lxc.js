/* Module Cockpit « Conteneurs LXC » (thème partagé ../studio).
 * Toute action passe par l'assistant /usr/local/libexec/cockpit-lxc (via sudo, règle limitée à ce seul
 * script). Aucune commande arbitraire n'est construite ici : le navigateur ne fournit que des paramètres
 * validés côté serveur. Tout texte affiché est inséré avec textContent (pas d'innerHTML). */
"use strict";
(() => {
    const { h, icon, toast: stToast, skeleton, countUp, slashFocus, searchBox, labelize, rise } = Studio;
    const HELPER = ["sudo", "-n", "/usr/local/libexec/cockpit-lxc"];
    const REFRESH_MS = 15000;  // 15 s (était 5 s : trop coûteux sur 2 vCPU)
    const $ = (sel, root = document) => root.querySelector(sel);

    const S = {
        list: [], routes: [], images: null, ncpu: 1, memTotal: 0,
        cpu: {},            // nom -> % du CPU total (calculé entre deux relevés)
        prev: {},           // nom -> {usec, t}
        busy: {},           // nom -> libellé de l'opération en cours
        detail: null,       // {name, tab, info}
        timer: null, loading: false, loaded: false,
        filter: "all", q: "",
        cards: new Map(),   // nom -> {el, sig, refs}
    };

    /* ------------------------------------------------------------ utilitaires */
    function fmtBytes(n) {
        if (n === null || n === undefined) return "–";
        if (n >= 1073741824) return (n / 1073741824).toFixed(2).replace(".", ",") + " Go";
        return Math.round(n / 1048576) + " Mo";
    }
    const fmtMb = mb => (mb === null || mb === undefined) ? "–" : fmtBytes(mb * 1048576);
    const fmtPct = p => p.toFixed(1).replace(".", ",") + " %";
    const toast = (msg, isErr) => stToast(msg, isErr ? "err" : "ok");

    function showAlert(msg) {
        const a = $("#alert");
        a.hidden = !msg;
        a.textContent = msg || "";
    }
    const withIcon = (btn, name) => { btn.prepend(icon(name)); return btn; };

    /* ------------------------------------------------------------ appels à l'assistant */
    function friendly(e) {
        const m = (e && (e.message || e.problem)) || String(e);
        if (/password is required|not allowed|may not run sudo/i.test(m))
            return "Droit manquant : le compte n'est pas autorisé à lancer l'assistant LXC (voir /etc/sudoers.d/cockpit-lxc).";
        if (/not-found|No such file/i.test(m)) return "Assistant introuvable : /usr/local/libexec/cockpit-lxc.";
        return m;
    }

    async function api(args) {
        let raw;
        try { raw = await cockpit.spawn([...HELPER, ...args], { err: "message" }); }
        catch (e) { throw new Error(friendly(e)); }
        let data;
        try { data = JSON.parse(raw); } catch (e) { throw new Error("Réponse illisible de l'assistant."); }
        if (!data.ok) throw new Error(data.error || "Échec de l'opération.");
        return data;
    }

    /* ------------------------------------------------------------ chargement des données */
    async function refresh(quiet) {
        if (S.loading) return;
        S.loading = true;
        const rb = $("#refresh");
        rb.classList.add("spin");
        try {
            const d = await api(["list"]);
            S.ncpu = d.ncpu; S.memTotal = d.mem_total || 0;
            for (const c of d.containers) {
                if (c.cpu_usec !== null && S.prev[c.name]) {
                    const dt = d.now - S.prev[c.name].t;
                    const du = c.cpu_usec - S.prev[c.name].usec;
                    if (dt > 0.5 && du >= 0) S.cpu[c.name] = Math.min(100, du / (dt * 1e6) / d.ncpu * 100);
                }
                if (c.cpu_usec !== null) S.prev[c.name] = { usec: c.cpu_usec, t: d.now };
                else { delete S.prev[c.name]; delete S.cpu[c.name]; }
            }
            S.list = d.containers;
            try { S.routes = (await api(["routes"])).routes; } catch (e) { S.routes = []; }
            showAlert("");
            S.loaded = true;
            render();
        } catch (e) {
            if (!quiet) showAlert(e.message);
            else showAlert("Actualisation impossible : " + e.message);
            if (!S.loaded) { $("#grid").replaceChildren(); $("#summary").textContent = "Indisponible"; }
        } finally { S.loading = false; rb.classList.remove("spin"); }
    }

    function startTimer() {
        clearInterval(S.timer);
        S.timer = null;
        if ($("#auto").checked) S.timer = setInterval(() => { if (!document.hidden) refresh(true); }, REFRESH_MS);
    }

    /* ------------------------------------------------------------ états */
    const stateInfo = st => ({
        RUNNING: ["b-running", "En marche", "ok live"], STOPPED: ["b-stopped", "Arrêté", ""], FROZEN: ["b-frozen", "Gelé", "info"],
    }[st] || ["b-other", st.charAt(0) + st.slice(1).toLowerCase(), "warn"]);

    function badge(st) { const [cls, label] = stateInfo(st); return h("span", { class: "badge " + cls }, label); }

    function critical(name) {
        if (name === "nginx") return "Ce conteneur est le reverse proxy : l'arrêter ou le redémarrer coupe TOUS vos sites ET l'accès à Cockpit pendant quelques secondes (l'opération se termine même si la page se déconnecte).";
        if (name.startsWith("db-")) return "Ce conteneur héberge une base de données : le site qui en dépend sera indisponible pendant l'opération.";
        return "";
    }

    async function doAction(name, action, label, opts = {}) {
        const warn = ["stop", "restart"].includes(action) ? critical(name) : "";
        if (opts.confirm || warn) {
            const ok = await askConfirm({
                title: label + " « " + name + " » ?", text: warn || opts.confirm, okLabel: label, danger: !!warn,
            });
            if (!ok) return null;
        }
        S.busy[name] = { start: "Démarrage…", stop: "Arrêt…", restart: "Redémarrage…", freeze: "Gel…", unfreeze: "Réactivation…" }[action] || "…";
        render();
        try {
            const r = await api([action, name]);
            toast(name + " : " + r.message);
            return r;
        } catch (e) { toast(name + " : " + e.message, true); return null; }
        finally { delete S.busy[name]; await refresh(true); if (S.detail && S.detail.name === name) loadDetail(); }
    }

    /* ------------------------------------------------------------ rendu : cartes */
    function miniBar(cls) {
        const fill = h("i");
        const txt = h("span", { class: "v tnum" }, "–");
        return { el: h("div", { class: "mbar " + (cls || "") }, h("div", { class: "meter" }, fill), txt), fill, txt };
    }
    function setBar(bar, pct, text, show) {
        bar.el.classList.toggle("off", !show);
        const p = show ? Math.max(0, Math.min(100, pct)) : 0;
        bar.fill.style.width = p.toFixed(1) + "%";
        bar.el.firstChild.className = "meter" + (p > 90 ? " e" : p > 75 ? " w" : "");
        bar.txt.textContent = text;
    }

    const sigOf = c => [c.state, S.busy[c.name] || "", c.autostart, c.ips.join(","), c.os || ""].join("|");

    function buildCard(c) {
        const busy = S.busy[c.name];
        const [, , dotCls] = stateInfo(c.state);
        const menuItem = (ic, label, fn, opts = {}) => {
            const b = h("button", { type: "button", role: "menuitem", class: opts.danger ? "danger" : null, disabled: !!opts.disabled,
                onclick: e => { e.currentTarget.closest("details").open = false; fn(); } }, label);
            b.prepend(icon(ic));
            return b;
        };
        const items = [];
        if (c.state === "RUNNING") {
            items.push(menuItem("refresh", "Redémarrer", () => doAction(c.name, "restart", "Redémarrer"), { disabled: !!busy }));
            items.push(menuItem("snow", "Geler…", () => doAction(c.name, "freeze", "Geler", { confirm: "Le gel suspend tous les processus du conteneur (ils ne répondront plus) jusqu'à la réactivation." }), { disabled: !!busy }));
        }
        if (c.state === "FROZEN") items.push(menuItem("play", "Réactiver", () => doAction(c.name, "unfreeze", "Réactiver"), { disabled: !!busy }));
        if (items.length) items.push(h("hr"));
        items.push(menuItem("info", "Aperçu", () => openDetail(c.name, "overview")));
        items.push(menuItem("logs", "Journal", () => openDetail(c.name, "logs"), { disabled: c.state !== "RUNNING" }));
        items.push(menuItem("terminal", "Diagnostics", () => openDetail(c.name, "diag"), { disabled: c.state !== "RUNNING" }));
        items.push(menuItem("camera", "Snapshots", () => openDetail(c.name, "snaps")));
        items.push(menuItem("filter", "Configuration", () => openDetail(c.name, "config")));
        items.push(h("hr"));
        items.push(menuItem("trash", c.state === "STOPPED" ? "Supprimer…" : "Supprimer (arrêter d'abord)", () => destroy(c.name), { danger: true, disabled: c.state !== "STOPPED" || !!busy }));

        const more = h("summary", { class: "btn small icon", "aria-label": "Autres actions pour " + c.name, title: "Autres actions" });
        more.append(icon("more"));
        const menu = h("details", { class: "menu" }, more, h("div", { class: "menu-list", role: "menu" }, items));

        let main;
        if (c.state === "RUNNING") main = withIcon(h("button", { class: "btn small", type: "button", disabled: !!busy, onclick: () => doAction(c.name, "stop", "Arrêter") }, "Arrêter"), "stop");
        else if (c.state === "FROZEN") main = withIcon(h("button", { class: "btn small", type: "button", disabled: !!busy, onclick: () => doAction(c.name, "unfreeze", "Réactiver") }, "Réactiver"), "play");
        else main = withIcon(h("button", { class: "btn small primary", type: "button", disabled: !!busy, onclick: () => doAction(c.name, "start", "Démarrer") }, "Démarrer"), "play");

        const auto = h("input", { type: "checkbox", checked: c.autostart, disabled: !!busy, "aria-label": "Démarrage automatique de " + c.name });
        auto.addEventListener("change", async () => {
            try { const r = await api(["autostart", c.name, auto.checked ? "on" : "off"]); toast(c.name + " : " + r.message); }
            catch (e) { auto.checked = !auto.checked; toast(e.message, true); }
            refresh(true);
        });

        const cpu = miniBar("cpu"), mem = miniBar("mem");
        const el = h("article", { class: "ct" + (busy ? " busy" : "") + (c.state === "RUNNING" ? " on" : ""), dataset: { name: c.name } },
            h("div", { class: "ct-top" },
                h("span", { class: "dot " + (busy ? "warn live" : dotCls), "aria-hidden": "true" }),
                h("div", { class: "ct-id" },
                    h("button", { class: "name", type: "button", onclick: () => openDetail(c.name) }, c.name),
                    h("span", { class: "os" }, c.os || "système inconnu")),
                busy ? h("span", { class: "badge b-other" }, busy) : badge(c.state)),
            h("div", { class: "ct-ip mono" }, icon("globe"), c.ips.length ? c.ips.join(", ") : "pas d'adresse"),
            h("div", { class: "ct-bars" },
                h("span", { class: "lb" }, "CPU"), cpu.el,
                h("span", { class: "lb" }, "RAM"), mem.el),
            h("div", { class: "ct-foot" },
                h("label", { class: "switch small", title: "Démarrer avec le serveur" }, auto, h("span", { class: "track" }), h("span", {}, "Auto")),
                h("div", { class: "acts" }, main,
                    withIcon(h("button", { class: "btn small ghost", type: "button", onclick: () => openDetail(c.name) }, "Détails"), "info"),
                    menu)));
        return { el, sig: sigOf(c), refs: { cpu, mem } };
    }

    function updateMetrics(card, c) {
        const cpu = S.cpu[c.name];
        if (c.state !== "RUNNING") setBar(card.refs.cpu, 0, "–", false);
        else if (cpu === undefined) setBar(card.refs.cpu, 0, "mesure…", true);
        else setBar(card.refs.cpu, cpu, fmtPct(cpu), true);
        const lim = c.mem_max && c.mem_max < S.memTotal * 4 ? c.mem_max : S.memTotal;
        if (c.mem === null || c.mem === undefined) setBar(card.refs.mem, 0, "–", false);
        else setBar(card.refs.mem, lim ? c.mem / lim * 100 : 0, fmtBytes(c.mem) + (lim ? " / " + fmtBytes(lim) : ""), true);
        card.refs.mem.el.title = c.mem_max ? "Limite mémoire du conteneur : " + fmtBytes(c.mem_max) : "Pas de limite : rapporté à la RAM de l'hôte";
    }

    function renderGrid() {
        const grid = $("#grid");
        const seen = new Set();
        const first = !grid.querySelector(".ct");
        if (first) S.cards.clear();
        if (first) grid.replaceChildren();
        S.list.forEach((c, i) => {
            seen.add(c.name);
            let card = S.cards.get(c.name);
            const sig = sigOf(c);
            if (!card || card.sig !== sig) {
                const locked = card && (card.el.querySelector("details[open]") || card.el.contains(document.activeElement));
                if (!locked || !card) {
                    const fresh = buildCard(c);
                    if (card) card.el.replaceWith(fresh.el);
                    if (first) rise(fresh.el, i);
                    card = fresh;
                    S.cards.set(c.name, card);
                }
            }
            if (card.el.parentNode !== grid || grid.children[i] !== card.el) grid.insertBefore(card.el, grid.children[i] || null);
            updateMetrics(card, c);
        });
        for (const [name, card] of S.cards) if (!seen.has(name)) { card.el.remove(); S.cards.delete(name); }
        applyFilter();
    }

    /* ------------------------------------------------------------ filtres */
    const FILTERS = [["all", "Tous", null], ["RUNNING", "En marche", "ok"], ["STOPPED", "Arrêtés", "off"], ["FROZEN", "Gelés", "info"]];
    function renderFilters() {
        const box = $("#filters");
        const count = k => k === "all" ? S.list.length : S.list.filter(c => c.state === k).length;
        box.replaceChildren(...FILTERS.filter(([k]) => k !== "FROZEN" || count(k)).map(([k, label]) =>
            h("button", { type: "button", class: "pill", "aria-pressed": String(S.filter === k), onclick: () => { S.filter = k; renderFilters(); applyFilter(); } },
                label, h("span", { class: "n" }, count(k)))));
    }
    function applyFilter() {
        const q = S.q.toLowerCase();
        let shown = 0;
        for (const c of S.list) {
            const card = S.cards.get(c.name);
            if (!card) continue;
            const hay = [c.name, c.os || "", c.ips.join(" "), c.state].join(" ").toLowerCase();
            const ok = (S.filter === "all" || c.state === S.filter) && (!q || hay.includes(q));
            card.el.hidden = !ok;
            if (ok) shown++;
        }
        const none = $("#none");
        none.hidden = !S.loaded || shown > 0;
        none.textContent = S.list.length ? "Aucun conteneur ne correspond au filtre." : "Aucun conteneur.";
    }

    /* ------------------------------------------------------------ rendu : tuiles + architecture */
    const tiles = {};
    function buildTiles() {
        const defs = [["run", "En marche", "play"], ["mem", "Mémoire utilisée", "mem"], ["cpu", "CPU (conteneurs)", "cpu"], ["auto", "Démarrage auto", "refresh"]];
        $("#tiles").replaceChildren(...defs.map(([id, label, ic], i) => {
            const big = h("span", { class: "big" }, "…"), small = h("span", { class: "small" }, "");
            const nm = h("span", { class: "nm" }, icon(ic), " ", label);
            tiles[id] = { big, small };
            return rise(h("div", { class: "tile static" }, nm, big, small), i);
        }));
    }
    function renderTiles() {
        const running = S.list.filter(c => c.state === "RUNNING").length;
        const memUsed = S.list.reduce((a, c) => a + (c.mem || 0), 0);
        const cpuSum = Object.entries(S.cpu).reduce((a, [, v]) => a + v, 0);
        countUp(tiles.run.big, running);
        tiles.run.small.textContent = "sur " + S.list.length + " conteneurs";
        countUp(tiles.mem.big, memUsed / 1048576, v => v >= 1024 ? (v / 1024).toFixed(2).replace(".", ",") + " Go" : Math.round(v) + " Mo");
        tiles.mem.small.textContent = S.memTotal ? "sur " + fmtBytes(S.memTotal) + " (" + Math.round(memUsed / S.memTotal * 100) + " %)" : "";
        countUp(tiles.cpu.big, cpuSum, fmtPct);
        tiles.cpu.small.textContent = S.ncpu + " cœur" + (S.ncpu > 1 ? "s" : "") + " · moyenne sur 5 s";
        countUp(tiles.auto.big, S.list.filter(c => c.autostart).length);
        tiles.auto.small.textContent = "lancés au boot de l'hôte";
    }

    function renderArch() {
        const box = $("#arch");
        box.replaceChildren();
        const nginx = S.list.find(c => c.name === "nginx");
        if (!nginx || !S.routes.length) {
            box.append(h("p", { class: "muted" }, "Aucun reverse proxy « nginx » détecté. Créez un conteneur nommé nginx pour suivre le schéma : Internet → nginx → conteneurs applicatifs."));
            return;
        }
        const byName = Object.fromEntries(S.list.map(c => [c.name, c]));
        const sdot = st => h("span", { class: "dot " + stateInfo(st)[2], "aria-hidden": "true" });
        const routes = h("div", { class: "backends" }, S.routes.map(r => {
            const c = byName[r.container];
            const isHost = r.container === "hôte";
            const st = isHost ? "RUNNING" : (c ? c.state : "UNKNOWN");
            const dom = r.domains[0];
            return h("div", { class: "route" + (st === "RUNNING" ? "" : " dead") },
                h("div", { class: "dom" },
                    h("a", { href: (r.tls ? "https://" : "http://") + dom + "/", target: "_blank", rel: "noopener" }, r.domains.join(", ")),
                    r.tls ? h("span", { class: "tag", title: "HTTPS (Let's Encrypt)" }, "TLS") : h("span", { class: "tag", title: "HTTP seulement" }, "HTTP"),
                    r.auth ? h("span", { class: "tag", title: "Protégé par authentification" }, "auth") : null),
                h("span", { class: "arrow", "aria-hidden": "true" }, "→"),
                h("button", { type: "button", class: "node", disabled: isHost || !c, onclick: () => c && openDetail(c.name),
                    title: isHost ? "Service de l'hôte" : "Ouvrir " + (r.container || "") },
                    sdot(st), h("strong", {}, r.container || "inconnu"),
                    h("small", { class: "mono" }, r.ip + ":" + r.port)));
        }));
        box.append(
            h("div", { class: "hop" }, h("div", { class: "node static" }, icon("globe"), h("strong", {}, "Internet"), h("small", {}, "ports 80 / 443")),
                h("span", { class: "arrow", "aria-hidden": "true" }, "→"),
                h("button", { type: "button", class: "node proxy", onclick: () => openDetail("nginx") }, sdot(nginx.state), h("strong", {}, "nginx"),
                    h("small", {}, "reverse proxy · TLS"), h("small", { class: "mono" }, (nginx.ips[0] || "–"))),
                h("span", { class: "arrow down", "aria-hidden": "true" }, "→")),
            routes);
    }

    function render() {
        const running = S.list.filter(c => c.state === "RUNNING").length;
        const memUsed = S.list.reduce((a, c) => a + (c.mem || 0), 0);
        $("#summary").textContent = S.list.length + " conteneurs · " + running + " en marche · mémoire utilisée : " + fmtBytes(memUsed) +
            (S.memTotal ? " sur " + fmtBytes(S.memTotal) : "");
        renderTiles();
        renderFilters();
        renderGrid();
        renderArch();
    }

    /* ------------------------------------------------------------ boîtes de dialogue */
    document.addEventListener("click", e => {
        const b = e.target.closest("[data-close]");
        if (b) b.closest("dialog").close();
    });

    function askConfirm({ title, text, okLabel = "Confirmer", danger = false, typed = "" }) {
        return new Promise(resolve => {
            const dlg = $("#confirm");
            $("#k-title").textContent = title;
            $("#k-text").textContent = text;
            const wrap = $("#k-typed-wrap"), input = $("#k-typed"), ok = $("#k-ok");
            wrap.hidden = !typed; input.value = ""; $("#k-word").textContent = typed;
            ok.textContent = okLabel; ok.className = "btn" + (danger ? " danger solid" : " primary");
            let result = false;
            const onSubmit = ev => {
                ev.preventDefault();
                if (typed && input.value !== typed) { input.focus(); return; }
                result = true; dlg.close();
            };
            const onClose = () => {
                $("#k-form").removeEventListener("submit", onSubmit);
                dlg.removeEventListener("close", onClose);
                resolve(result);
            };
            $("#k-form").addEventListener("submit", onSubmit);
            dlg.addEventListener("close", onClose);
            dlg.showModal();
            (typed ? input : ok).focus();
        });
    }

    /* ------------------------------------------------------------ détails d'un conteneur */
    const TABS = [["overview", "Aperçu", "info"], ["logs", "Journal", "logs"], ["diag", "Diagnostics", "terminal"], ["snaps", "Snapshots", "camera"], ["config", "Configuration", "filter"]];
    const DIAG_LABELS = {
        processes: "Processus (mémoire)", services: "Services actifs", failed: "Services en échec",
        ports: "Ports en écoute", network: "Réseau", disk: "Disque", uptime: "Charge", updates: "Mises à jour en attente",
    };

    function openDetail(name, tab = "overview") {
        S.detail = { name, tab, info: null };
        const c = S.list.find(x => x.name === name);
        $("#d-title").replaceChildren(h("span", { class: "dot " + (c ? stateInfo(c.state)[2] : ""), "aria-hidden": "true" }), " ", name);
        renderTabs();
        renderDetail();
        const dlg = $("#detail");
        if (!dlg.open) dlg.showModal();
        loadDetail();
    }

    async function loadDetail() {
        const d = S.detail;
        if (!d) return;
        try { d.info = await api(["info", d.name]); } catch (e) { d.error = e.message; }
        if (S.detail === d && ["overview", "snaps", "config"].includes(d.tab)) renderDetail();
    }

    function renderTabs() {
        $("#tabs").replaceChildren(...TABS.map(([id, label, ic]) => {
            const b = h("button", {
                class: "tab", role: "tab", type: "button", "aria-selected": String(S.detail.tab === id),
                onclick: () => { S.detail.tab = id; renderTabs(); renderDetail(); },
            }, label);
            b.prepend(icon(ic));
            return b;
        }));
    }

    function cur() { return S.list.find(c => c.name === S.detail.name); }

    function renderDetail() {
        const d = S.detail, body = $("#d-body"), c = cur();
        body.replaceChildren();
        if (!c) { body.append(h("p", { class: "empty" }, "Ce conteneur n'existe plus.")); return; }
        if (d.tab === "overview") return renderOverview(body, c);
        if (d.tab === "logs") return renderLogs(body, c);
        if (d.tab === "diag") return renderDiag(body, c);
        if (d.tab === "snaps") return renderSnaps(body, c);
        if (d.tab === "config") {
            body.append(d.info ? h("pre", { class: "log" }, d.info.config) : d.error ? h("p", { class: "note danger" }, d.error) : skeleton(6));
        }
    }

    function renderOverview(body, c) {
        const i = S.detail.info;
        const kv = h("dl", { class: "kv" },
            h("dt", {}, "État"), h("dd", {}, badge(c.state)),
            h("dt", {}, "Adresse IP"), h("dd", { class: "mono" }, c.ips.join(", ") || "–"),
            h("dt", {}, "Système"), h("dd", {}, c.os || "–"),
            h("dt", {}, "Démarrage auto"), h("dd", {}, c.autostart ? "Oui" : "Non", c.order ? " (ordre " + c.order + ")" : ""),
            h("dt", {}, "Groupe"), h("dd", {}, c.group || "–"),
            h("dt", {}, "Mode"), h("dd", {}, c.privileged ? "Privilégié" : "Non privilégié"),
            h("dt", {}, "Mémoire"), h("dd", {}, fmtBytes(c.mem), c.mem_max ? " (limite " + fmtBytes(c.mem_max) + ")" : ""),
            h("dt", {}, "Processus"), h("dd", {}, c.pids === null ? "–" : c.pids),
            h("dt", {}, "Espace disque"), h("dd", {}, i ? fmtMb(i.disk_mb) : h("span", { class: "skel w40" })),
            h("dt", {}, "Trafic réseau"), h("dd", {}, i && i.info["RX bytes"] ? "↓ " + i.info["RX bytes"][0] + "  ↑ " + (i.info["TX bytes"] || ["–"])[0] : "–"));
        body.append(kv);

        const acts = h("div", { class: "row", style: "margin-top:16px" });
        if (c.state === "RUNNING") {
            acts.append(withIcon(h("button", { class: "btn", type: "button", onclick: () => doAction(c.name, "restart", "Redémarrer") }, "Redémarrer"), "refresh"));
            acts.append(withIcon(h("button", { class: "btn", type: "button", onclick: () => doAction(c.name, "freeze", "Geler", { confirm: "Le gel suspend tous les processus du conteneur (ils ne répondront plus) jusqu'à la réactivation." }) }, "Geler"), "snow"));
        }
        if (c.state === "FROZEN") acts.append(withIcon(h("button", { class: "btn", type: "button", onclick: () => doAction(c.name, "unfreeze", "Réactiver") }, "Réactiver"), "play"));
        if (acts.children.length) body.append(acts);

        const danger = h("div", { class: "note warn", style: "margin-top:20px" },
            h("strong", {}, "Zone dangereuse. "),
            c.state === "STOPPED" ? "La suppression efface définitivement le conteneur, ses données et ses snapshots. " : "Arrêtez le conteneur pour pouvoir le supprimer. ",
            h("div", { style: "margin-top:8px" },
                withIcon(h("button", { class: "btn danger", type: "button", disabled: c.state !== "STOPPED", onclick: () => destroy(c.name) }, "Supprimer ce conteneur…"), "trash")));
        body.append(danger);
    }

    async function destroy(name) {
        const ok = await askConfirm({
            title: "Supprimer « " + name + " » ?", danger: true, okLabel: "Supprimer définitivement", typed: name,
            text: "Cette action est irréversible : le système de fichiers du conteneur et ses snapshots seront supprimés. Pensez à vérifier vos sauvegardes.",
        });
        if (!ok) return;
        try {
            const r = await api(["destroy", name, name]);
            toast(name + " : " + r.message);
            if ($("#detail").open) $("#detail").close();
        } catch (e) { toast(e.message, true); }
        refresh(true);
    }

    function renderLogs(body, c) {
        if (c.state !== "RUNNING") { body.append(h("p", { class: "empty" }, "Le conteneur est arrêté : pas de journal à afficher.")); return; }
        const lines = h("select", { "aria-label": "Nombre de lignes" }, [100, 200, 500, 1000].map(n => h("option", { value: n, selected: n === 200 }, n + " lignes")));
        const unit = h("input", { placeholder: "unité (ex. nginx)", "aria-label": "Filtrer par unité systemd", spellcheck: false });
        const out = h("pre", { class: "log" }, "Chargement…");
        const go = withIcon(h("button", { class: "btn", type: "button" }, "Charger"), "refresh");
        const load = async () => {
            out.textContent = "Chargement…";
            go.classList.add("spin");
            try {
                const r = await api(["logs", c.name, lines.value || "200", unit.value.trim()]);
                out.textContent = r.output || "(journal vide)";
                out.scrollTop = out.scrollHeight;
            } catch (e) { out.textContent = e.message; }
            go.classList.remove("spin");
        };
        go.addEventListener("click", load);
        unit.addEventListener("keydown", e => { if (e.key === "Enter") load(); });
        body.append(h("div", { class: "row" }, lines, unit, go), out);
        load();
    }

    function renderDiag(body, c) {
        if (c.state !== "RUNNING") { body.append(h("p", { class: "empty" }, "Le conteneur est arrêté : diagnostics indisponibles.")); return; }
        const out = h("pre", { class: "log" }, "Choisissez un diagnostic.");
        const buttons = Object.entries(DIAG_LABELS).map(([id, label]) => h("button", {
            class: "pill", type: "button", "aria-pressed": "false", onclick: async e => {
                buttons.forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
                out.textContent = "Exécution…";
                try { out.textContent = (await api(["diag", c.name, id])).output || "(aucune sortie)"; }
                catch (err) { out.textContent = err.message; }
            },
        }, label));
        body.append(h("div", { class: "note" }, "Commandes prédéfinies en lecture seule, exécutées dans le conteneur."), h("div", { class: "pills", style: "margin-bottom:12px" }, buttons), out);
    }

    function renderSnaps(body, c) {
        const i = S.detail.info;
        if (!i) { body.append(S.detail.error ? h("p", { class: "note danger" }, S.detail.error) : skeleton(4)); return; }
        const comment = h("input", { placeholder: "commentaire (facultatif)", maxlength: 200, "aria-label": "Commentaire du snapshot" });
        body.append(
            h("div", { class: "note warn" }, "Un snapshot est une copie complète (≈ " + fmtMb(i.disk_mb) + ", espace libre : " + fmtMb(i.free_mb) +
                "). Un conteneur en marche est arrêté pendant la copie puis redémarré automatiquement."),
            h("div", { class: "row", style: "margin:12px 0" }, comment, withIcon(h("button", {
                class: "btn primary", type: "button", onclick: async () => {
                    const ok = await askConfirm({ title: "Créer un snapshot de « " + c.name + " » ?", okLabel: "Créer le snapshot", danger: !!critical(c.name),
                        text: (c.state === "RUNNING" ? "Le conteneur sera arrêté puis redémarré. " : "") + (critical(c.name) || "Cela peut prendre quelques dizaines de secondes.") });
                    if (!ok) return;
                    S.busy[c.name] = "Snapshot…"; render();
                    try { const r = await api(["snapshot", c.name, comment.value.trim()]); toast(c.name + " : " + r.message); }
                    catch (e) { toast(e.message, true); }
                    finally { delete S.busy[c.name]; await refresh(true); loadDetail(); }
                },
            }, "Créer un snapshot"), "camera")));
        if (!i.snapshots.length) { body.append(h("p", { class: "empty" }, "Aucun snapshot.")); return; }
        body.append(h("div", { class: "tbl-wrap" }, labelize(h("table", { class: "tbl" },
            h("thead", {}, h("tr", {}, h("th", {}, "Nom"), h("th", {}, "Date"), h("th", {}, "Commentaire"), h("th", { class: "right" }, "Actions"))),
            h("tbody", {}, i.snapshots.map(s => h("tr", {},
                h("td", { class: "mono" }, s.name), h("td", {}, s.date), h("td", { class: "wrap" }, s.comment || "–"),
                h("td", { class: "right", "data-label": "" }, h("div", { class: "acts" },
                    withIcon(h("button", { class: "btn small", type: "button", onclick: () => snapOp(c, s, "restore") }, "Restaurer"), "refresh"),
                    withIcon(h("button", { class: "btn small danger", type: "button", onclick: () => snapOp(c, s, "delsnapshot") }, "Supprimer"), "trash"))))))))));
    }

    async function snapOp(c, s, op) {
        const restore = op === "restore";
        const ok = await askConfirm({
            title: (restore ? "Restaurer " : "Supprimer ") + s.name + " ?", danger: true, okLabel: restore ? "Restaurer" : "Supprimer",
            text: restore ? "L'état actuel de « " + c.name + " » sera REMPLACÉ par celui du snapshot (données créées depuis, perdues). Le conteneur est arrêté puis redémarré."
                : "Ce snapshot sera définitivement supprimé.",
        });
        if (!ok) return;
        if (restore) { S.busy[c.name] = "Restauration…"; render(); }
        try { const r = await api([op, c.name, s.name]); toast(c.name + " : " + r.message); }
        catch (e) { toast(e.message, true); }
        finally { delete S.busy[c.name]; await refresh(true); loadDetail(); }
    }

    /* ------------------------------------------------------------ création */
    async function openCreate() {
        if (!S.images) {
            try { S.images = (await api(["images"])).images; } catch (e) { toast(e.message, true); return; }
        }
        const dist = $("#c-dist"), rel = $("#c-rel");
        dist.replaceChildren(...Object.keys(S.images).map(d => h("option", { value: d }, d.charAt(0).toUpperCase() + d.slice(1))));
        dist.value = Object.keys(S.images)[0];
        const fillRel = () => {
            rel.replaceChildren(...(S.images[dist.value] || []).map(r => h("option", { value: r }, r)));
            rel.value = (S.images[dist.value] || [""])[0];
        };
        dist.onchange = fillRel; fillRel();
        $("#c-name").value = ""; $("#c-ip").value = ""; $("#c-auto").checked = false; $("#c-start").checked = true;
        $("#c-log").hidden = true; $("#c-log").textContent = ""; $("#c-go").disabled = false;
        $("#create").showModal();
        $("#c-name").focus();
    }

    $("#c-form").addEventListener("submit", async ev => {
        ev.preventDefault();
        const name = $("#c-name").value.trim(), ip = $("#c-ip").value.trim();
        if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) { toast("Nom invalide : minuscules, chiffres et tirets.", true); return; }
        if (S.list.some(c => c.name === name)) { toast("Un conteneur « " + name + " » existe déjà.", true); return; }
        const go = $("#c-go"), log = $("#c-log");
        go.disabled = true; go.classList.add("spin"); log.hidden = false; log.textContent = "";
        const proc = cockpit.spawn([...HELPER, "create", name, $("#c-dist").value, $("#c-rel").value, ip,
            $("#c-auto").checked ? "on" : "off", $("#c-start").checked ? "on" : "off"], { err: "out" });
        let buf = "";
        proc.stream(chunk => {
            buf += chunk;
            log.textContent = buf.replace(/__RESULT__.*$/m, "").trimEnd();
            log.scrollTop = log.scrollHeight;
        });
        try { await proc; } catch (e) { buf += "\n__RESULT__ " + JSON.stringify({ ok: false, error: friendly(e) }); }
        go.classList.remove("spin");
        const m = buf.match(/__RESULT__ (.*)$/m);
        let res = { ok: false, error: "Réponse illisible." };
        try { if (m) res = JSON.parse(m[1]); } catch (e) { /* garde le message par défaut */ }
        if (res.ok) { toast(res.message); $("#create").close(); }
        else { toast(res.error, true); log.textContent += "\n✗ " + res.error; go.disabled = false; }
        refresh(true);
    });

    /* ------------------------------------------------------------ démarrage */
    $("#glyph").append(icon("box"));
    withIcon($("#refresh"), "refresh");
    withIcon($("#new"), "plus");
    const q = $("#q");
    $("#searchbar").replaceChildren(searchBox(q));
    q.addEventListener("input", () => { S.q = q.value.trim(); applyFilter(); });
    q.addEventListener("keydown", e => { if (e.key === "Escape" && q.value) { q.value = ""; S.q = ""; applyFilter(); e.stopPropagation(); } });
    slashFocus(q);
    buildTiles();
    $("#grid").replaceChildren(...[0, 1, 2].map(() => h("div", { class: "ct-skel" }, skeleton(4))));
    $("#refresh").addEventListener("click", () => refresh(false));
    $("#auto").addEventListener("change", startTimer);
    $("#new").addEventListener("click", openCreate);
    $("#detail").addEventListener("close", () => { S.detail = null; });
    refresh(false);
    startTimer();
})();
