/* Studio — utilitaires partagés des modules Cockpit maison (chemin stable : ../studio/studio.js).
 * Aucun innerHTML : tout le texte passe par textContent / createTextNode (anti-XSS).
 * Styles dynamiques uniquement via CSSOM (el.style.*), compatible avec la CSP stricte de Cockpit. */
"use strict";
(() => {
    const NS = "http://www.w3.org/2000/svg";

    function h(tag, props, ...kids) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(props || {})) {
            if (v === false || v === null || v === undefined) continue;
            if (k === "class") el.className = v;
            else if (k === "for") el.htmlFor = v;
            else if (k === "style") el.style.cssText = v;
            else if (k === "dataset") Object.assign(el.dataset, v);
            else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
            else if (k in el && !k.includes("-")) el[k] = v;
            else el.setAttribute(k, v === true ? "" : String(v));
        }
        for (const kid of kids.flat(Infinity)) {
            if (kid === null || kid === undefined || kid === false) continue;
            el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
        }
        return el;
    }
    function svg(tag, attrs, ...kids) {
        const el = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
        for (const kid of kids.flat(Infinity)) if (kid) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
        return el;
    }

    /* ---------------------------------------------------------- icônes (traits, 24×24) */
    const P = {
        refresh: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"],
        plus: ["M12 5v14", "M5 12h14"],
        search: ["M20 20l-4.2-4.2", "C11 11 7"],
        box: ["M21 8l-9-5-9 5v8l9 5 9-5z", "M3 8l9 5 9-5", "M12 13v8"],
        shield: ["M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z", "M9 12l2 2 4-4"],
        logs: ["M4 6h16", "M4 11h16", "M4 16h10", "M4 21h6"],
        grid: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
        play: ["M8 5l11 7-11 7z"],
        stop: ["M7 7h10v10H7z"],
        pause: ["M9 6v12", "M15 6v12"],
        more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
        x: ["M6 6l12 12", "M18 6L6 18"],
        check: ["M5 12.5l4.5 4.5L19 7"],
        alert: ["M12 3.5l9.5 17h-19z", "M12 10v4.5", "M12 17.5h.01"],
        clock: ["C12 12 9", "M12 7.5V12l3 2"],
        lock: ["M6 11h12v10H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
        globe: ["C12 12 9", "M3 12h18", "M12 3c3 3.4 3 14.6 0 18", "M12 3c-3 3.4-3 14.6 0 18"],
        download: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"],
        cert: ["C12 9 6", "M8.5 14L7 22l5-3 5 3-1.5-8"],
        ban: ["C12 12 9", "M5.6 5.6l12.8 12.8"],
        bell: ["M6 9a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9", "M10 21h4"],
        arrow: ["M5 12h14", "M13 6l6 6-6 6"],
        camera: ["M4 8h4l2-3h4l2 3h4v12H4z", "C12 13.5 3.5"],
        terminal: ["M5 7l5 5-5 5", "M12 18h7"],
        cpu: ["M7 7h10v10H7z", "M10 10h4v4h-4z", "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"],
        mem: ["M3 8h18v9H3z", "M7 8v9M11 8v9M15 8v9", "M5 20v-3M19 20v-3"],
        disk: ["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3z", "M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
        archive: ["M3 5h18v4H3z", "M5 9v11h14V9", "M10 13h4"],
        server: ["M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01"],
        user: ["C12 8 4", "M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"],
        filter: ["M4 5h16l-6 8v6l-4 2v-8z"],
        snow: ["M12 3v18", "M4.2 7.5l15.6 9", "M4.2 16.5l15.6-9"],
        trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 14h10l1-14"],
        info: ["C12 12 9", "M12 11v5", "M12 8h.01"],
        live: ["C12 12 2", "M7.8 7.8a6 6 0 0 0 0 8.4", "M16.2 7.8a6 6 0 0 1 0 8.4", "M5 5a10 10 0 0 0 0 14", "M19 5a10 10 0 0 1 0 14"],
    };
    function icon(name, cls) {
        const s = svg("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": name === "more" ? "3" : "1.8",
            "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: cls || null, focusable: "false" });
        for (const d of P[name] || []) {
            if (d[0] === "C") { const [cx, cy, r] = d.slice(1).trim().split(/\s+/); s.append(svg("circle", { cx, cy, r })); }
            else s.append(svg("path", { d }));
        }
        return s;
    }

    /* ---------------------------------------------------------- thème (suit Cockpit) */
    function applyTheme(style) {
        if (!style) {
            style = "auto";
            try { style = localStorage.getItem("shell:style") || "auto"; } catch (e) { /* stockage indisponible */ }
        }
        const dark = style === "dark" || (style !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.dataset.theme = dark ? "dark" : "light";
    }
    applyTheme();
    window.addEventListener("storage", e => { if (e.key === "shell:style") applyTheme(); });
    window.addEventListener("cockpit-style", e => applyTheme(e.detail && e.detail.style));
    try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme()); } catch (e) { /* ancien navigateur */ }

    const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };

    /* ---------------------------------------------------------- notifications */
    function toast(msg, kind) {
        let box = document.querySelector(".toasts");
        if (!box) { box = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
        if (kind === true) kind = "err";
        const t = h("div", { class: "toast " + (kind || "") },
            icon(kind === "err" ? "alert" : kind === "ok" ? "check" : "info"), h("span", {}, msg),
            h("button", { class: "x", type: "button", "aria-label": "Fermer", onclick: () => close() }, "✕"));
        const close = () => { if (!t.isConnected) return; t.classList.add("out"); setTimeout(() => t.remove(), reduced() ? 0 : 260); };
        t.querySelector("svg").style.cssText = "width:18px;height:18px;flex:none;margin-top:1px";
        box.append(t);
        while (box.children.length > 4) box.firstChild.remove();
        setTimeout(close, kind === "err" ? 9000 : 4500);
        return t;
    }

    /* ---------------------------------------------------------- squelettes */
    function skeleton(lines = 3, cls) {
        const wrap = h("div", { class: "skel-card " + (cls || ""), "aria-busy": "true", "aria-label": "Chargement" });
        const widths = ["", "w70", "w40", "", "w70"];
        for (let i = 0; i < lines; i++) wrap.append(h("span", { class: "skel " + (i === 0 && lines > 1 ? "lg" : widths[i % widths.length]) }));
        return wrap;
    }

    /* ---------------------------------------------------------- nombres animés */
    const nf = new Intl.NumberFormat("fr-FR");
    function countUp(el, to, fmt) {
        fmt = fmt || (v => nf.format(Math.round(v)));
        const from = Number(el.dataset.v || 0);
        el.dataset.v = to;
        if (reduced() || !isFinite(to) || from === to) { el.textContent = fmt(to); return; }
        const t0 = performance.now(), d = 700;
        const step = now => {
            const k = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - k, 3);
            el.textContent = fmt(from + (to - from) * e);
            if (k < 1 && el.dataset.v == String(to)) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    /* ---------------------------------------------------------- raccourci « / » pour la recherche */
    function slashFocus(getInput) {
        document.addEventListener("keydown", e => {
            if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
            const t = e.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            const inp = typeof getInput === "function" ? getInput() : getInput;
            if (!inp || inp.offsetParent === null) return;
            e.preventDefault();
            inp.focus();
            inp.select && inp.select();
        });
    }
    function searchBox(input) {
        return h("div", { class: "search" }, icon("search"), input, h("kbd", { title: "Raccourci : /" }, "/"));
    }

    /* ---------------------------------------------------------- tableaux → cartes (libellés) */
    function labelize(table) {
        const heads = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
        for (const tr of table.querySelectorAll("tbody tr"))
            [...tr.children].forEach((td, i) => { if (!td.hasAttribute("data-label")) td.setAttribute("data-label", heads[i] || ""); });
        return table;
    }

    /* ---------------------------------------------------------- divers */
    function rise(el, i) { el.classList.add("rise"); el.style.setProperty("--i", i || 0); return el; }
    function jump(path) { try { cockpit.jump(path); } catch (e) { /* hors Cockpit */ } }
    function closeMenus(except) {
        document.querySelectorAll("details.menu[open]").forEach(d => { if (d !== except) d.open = false; });
    }
    document.addEventListener("click", e => { const m = e.target.closest("details.menu"); closeMenus(m); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(null); });

    window.Studio = { h, svg, icon, toast, skeleton, countUp, slashFocus, searchBox, labelize, rise, jump, applyTheme, reduced, nf, closeMenus };
})();
