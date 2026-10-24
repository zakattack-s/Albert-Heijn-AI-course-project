const root = document.documentElement;
const conversation = document.getElementById("conversation");
const welcome = document.getElementById("welcome");
const messages = document.getElementById("messages");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("prompt");
const sendButton = document.getElementById("sendButton");
const sidebar = document.getElementById("sidebar");
const scrim = document.getElementById("scrim");
const statusDot = document.querySelector(".topbar-title i");
const statusText = statusDot ? statusDot.parentElement : null;
const history = [];
let busy = false;
let currentController = null;

const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2-6-7-1Z" /></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>';

/* ---------- Theme ---------- */

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode etc.) - ignore.
  }
}

function applyTheme(preference) {
  const resolved =
    preference === "system"
      ? systemTheme.matches
        ? "dark"
        : "light"
      : preference;

  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  writeStored("ah-theme", preference);

  document.querySelectorAll(".theme-picker [data-theme]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.theme === preference);
  });
}

applyTheme(readStored("ah-theme", "system"));

systemTheme.addEventListener("change", () => {
  if (root.dataset.themePreference === "system") {
    applyTheme("system");
  }
});

document.querySelectorAll(".theme-picker [data-theme]").forEach((button) => {
  button.addEventListener("click", () => {
    applyTheme(button.dataset.theme);
  });
});

/* ---------- Sidebar & dialog ---------- */

function setSidebar(open) {
  sidebar.classList.toggle("open", open);
  scrim.classList.toggle("open", open);
}

document.getElementById("openSidebar").addEventListener("click", () => setSidebar(true));
document.getElementById("closeSidebar").addEventListener("click", () => setSidebar(false));
scrim.addEventListener("click", () => setSidebar(false));

const aboutDialog = document.getElementById("aboutDialog");

document.getElementById("aboutButton").addEventListener("click", () => {
  setSidebar(false);
  aboutDialog.showModal();
});

document.getElementById("closeAbout").addEventListener("click", () => {
  aboutDialog.close();
});

// Click outside the dialog box (on the backdrop) closes it.
aboutDialog.addEventListener("click", (event) => {
  const rect = aboutDialog.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;

  if (!inside) aboutDialog.close();
});

// "Assistant" nav item: go back to the chat and focus the input.
document.getElementById("assistantButton").addEventListener("click", () => {
  setSidebar(false);
  conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
  promptInput.focus();
});

// Escape closes the mobile menu (the dialog already handles Escape itself).
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebar.classList.contains("open")) {
    setSidebar(false);
  }
});

/* ---------- Busy state ---------- */

function setBusy(value) {
  busy = value;

  sendButton.classList.toggle("stop", value);
  sendButton.type = value ? "button" : "submit";
  sendButton.innerHTML = value ? STOP_ICON : SEND_ICON;
  sendButton.setAttribute("aria-label", value ? "Stop generating" : "Send message");
  sendButton.title = value ? "Stop generating" : "Send message";

  if (statusDot) statusDot.classList.toggle("busy", value);
  if (statusText) {
    statusText.lastChild.textContent = value ? " Working on it…" : " Ready to help";
  }

  resizeInput();
}

sendButton.addEventListener("click", () => {
  if (busy && currentController) {
    currentController.abort();
  }
});

/* ---------- Conversation reset ---------- */

function resetConversation() {
  if (currentController) {
    currentController.discarded = true;
    currentController.abort();
    currentController = null;
  }

  history.length = 0;
  messages.replaceChildren();
  welcome.hidden = false;
  promptInput.value = "";
  setBusy(false);
  conversation.scrollTo({ top: 0, behavior: "auto" });
  promptInput.focus();
}

document.getElementById("newChat").addEventListener("click", () => {
  resetConversation();
  setSidebar(false);
});

/* ---------- Composer ---------- */

function resizeInput() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 128)}px`;
  // While busy the button acts as "Stop", so it stays enabled.
  sendButton.disabled = !busy && !promptInput.value.trim();
}

promptInput.addEventListener("input", resizeInput);

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();

    if (!busy && promptInput.value.trim()) {
      composer.requestSubmit();
    }
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt);
  });
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(promptInput.value.trim());
});

/* ---------- Message rendering ---------- */

function addUserMessage(text) {
  const row = document.createElement("article");
  row.className = "message-row user-message";

  const bubble = document.createElement("div");
  bubble.className = "user-bubble";
  bubble.textContent = text;

  row.appendChild(bubble);
  messages.appendChild(row);
}

function addAssistantMessage() {
  const fragment = document
    .getElementById("assistantTemplate")
    .content.cloneNode(true);

  const row = fragment.querySelector("article");
  const answer = fragment.querySelector(".answer");

  answer.innerHTML =
    '<span class="typing" role="status"><i></i><i></i><i></i><span class="typing-label">Generating response</span></span>';

  messages.appendChild(fragment);

  return { row, answer };
}

function addCopyButton(row, getText) {
  const content = row.querySelector(".message-content");
  if (!content || content.querySelector(".message-actions")) return;

  const actions = document.createElement("div");
  actions.className = "message-actions";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-button";
  button.innerHTML = `${COPY_ICON}<span>Copy</span>`;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.classList.add("done");
      button.querySelector("span").textContent = "Copied";
    } catch {
      button.querySelector("span").textContent = "Copy failed";
    }

    setTimeout(() => {
      button.classList.remove("done");
      button.querySelector("span").textContent = "Copy";
    }, 1600);
  });

  actions.appendChild(button);
  content.appendChild(actions);
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

/* ---------- Charts ---------- */

const CHART_COLORS = [
  "#00a9e0", "#f58220", "#2eab6a", "#8062be",
  "#e0457b", "#f2c200", "#0078b9", "#7a8b99",
];

function isValidColor(value) {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    typeof CSS !== "undefined" &&
    CSS.supports("color", value)
  );
}

// Colour of a whole series (legend, lines, multi-series bars)
function seriesColor(c, k) {
  return c.colors[k] || CHART_COLORS[k % CHART_COLORS.length];
}

// Colour of one bar. With a single series and several colours,
// each bar gets its own colour; otherwise the series colour is used.
function pointColor(c, k, i) {
  if (c.series.length === 1 && c.colors.length > 1) {
    return c.colors[i % c.colors.length];
  }

  return seriesColor(c, k);
}

function truncateLabel(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatNum(value) {
  const abs = Math.abs(value);
  const trim = (n) => String(Number(n.toFixed(1)));

  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}K`;

  return String(Number(value.toFixed(2)));
}

function formatFull(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function niceScale(min, max, ticks = 5) {
  if (max === min) max = min + 1;

  const raw = (max - min) / (ticks - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step =
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;

  return {
    lo: Math.floor(min / step) * step,
    hi: Math.ceil(max / step) * step,
    step,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;

  return null;
}

/* Sorting and "top N" are applied here so the model only has to ask. */
function applySortAndLimit(c) {
  if (c.type === "line") return c;

  const sort = c.sort || (c.topN ? "desc" : null);

  if (!sort && !c.topN) return c;

  let order = c.labels.map((_, i) => i);

  if (sort === "label") {
    order.sort((a, b) => c.labels[a].localeCompare(c.labels[b]));
  } else if (sort) {
    const total = (i) => c.series.reduce((sum, s) => sum + s.values[i], 0);

    order.sort((a, b) => (sort === "asc" ? total(a) - total(b) : total(b) - total(a)));
  }

  if (c.topN) order = order.slice(0, c.topN);

  c.labels = order.map((i) => c.labels[i]);
  c.series = c.series.map((s) => ({
    name: s.name,
    values: order.map((i) => s.values[i]),
  }));

  return c;
}

function parseChartSpec(raw) {
  let spec;

  try {
    spec = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!spec || typeof spec !== "object") return null;

  const type = ["bar", "hbar", "line", "pie"].includes(spec.type)
    ? spec.type
    : "bar";

  const labels = Array.isArray(spec.labels) ? spec.labels.map(String) : [];

  let series = Array.isArray(spec.series) ? spec.series : [];

  if (!series.length && Array.isArray(spec.values)) {
    series = [{ name: spec.y_label || "", values: spec.values }];
  }

  series = series
    .map((s) => ({
      name: String((s && s.name) || ""),
      values: Array.isArray(s && s.values) ? s.values.map(Number) : [],
    }))
    .filter((s) => s.values.length);

  if (!labels.length || !series.length) return null;

  const n = Math.min(labels.length, 60, ...series.map((s) => s.values.length));
  const topN = numberOrNull(spec.top_n);

  return applySortAndLimit({
    type,
    title: String(spec.title || ""),
    colors: (Array.isArray(spec.colors) ? spec.colors.map(String) : []).filter(isValidColor),
    xLabel: String(spec.x_label || ""),
    yLabel: String(spec.y_label || ""),
    stacked: boolOrNull(spec.stacked) === true,
    sort: ["asc", "desc", "label"].includes(spec.sort) ? spec.sort : null,
    topN: topN && topN >= 1 ? Math.floor(topN) : null,
    numberFormat: spec.number_format === "full" ? "full" : "compact",
    showValues: boolOrNull(spec.show_values),
    showLegend: boolOrNull(spec.show_legend),
    showGrid: boolOrNull(spec.show_grid) !== false,
    yMin: numberOrNull(spec.y_min),
    yMax: numberOrNull(spec.y_max),
    labels: labels.slice(0, n),
    series: series.map((s) => ({
      name: s.name,
      values: s.values.slice(0, n).map((v) => (Number.isFinite(v) ? v : 0)),
    })),
  });
}

function barTitle(c, label, s, v, fmtFull) {
  return `<title>${escapeHtml(label)}${s.name ? ` – ${escapeHtml(s.name)}` : ""}: ${fmtFull(v)}</title>`;
}

function cartesianSvg(c) {
  const W = 640;
  const H = 340;
  const n = c.labels.length;
  const horizontal = c.type === "hbar";
  const stacked = c.stacked && c.series.length > 1 && c.type !== "line";
  const fmt = (v) => (c.numberFormat === "full" ? formatFull(v) : formatNum(v));

  /* ---- Value range ---- */
  let dMin = 0;
  let dMax = 0;

  if (stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;

      c.series.forEach((s) => {
        if (s.values[i] >= 0) pos += s.values[i];
        else neg += s.values[i];
      });

      dMax = Math.max(dMax, pos);
      dMin = Math.min(dMin, neg);
    }
  } else {
    const all = c.series.flatMap((s) => s.values);

    dMin = Math.min(0, ...all);
    dMax = Math.max(0, ...all);
  }

  let lo = c.yMin ?? dMin;
  let hi = c.yMax ?? dMax;

  if (lo >= hi) {
    lo = dMin;
    hi = dMax;
  }

  const scale = niceScale(lo, hi);
  const count = Math.round((scale.hi - scale.lo) / scale.step);
  const ticks = [];

  for (let i = 0; i <= count; i++) ticks.push(scale.lo + i * scale.step);

  const clamp = (v) => Math.min(scale.hi, Math.max(scale.lo, v));
  const base = clamp(0);
  const valueMax = Math.max(...c.series.flatMap((s) => s.values.map((v) => fmt(v).length)));

  let out = "";

  /* ---- Horizontal bars ---- */
  if (horizontal) {
    const longest = Math.max(...c.labels.map((l) => Math.min(l.length, 26)));
    const M = {
      l: Math.min(190, longest * 6.4 + 18),
      r: Math.max(64, valueMax * 6.6 + 14),
      t: 10,
      b: c.xLabel ? 50 : 32,
    };
    const rowH = stacked ? 34 : Math.max(26, c.series.length * 15 + 12);
    const ph = n * rowH;
    const h = M.t + ph + M.b;
    const pw = W - M.l - M.r;
    const x = (v) => M.l + pw * ((clamp(v) - scale.lo) / (scale.hi - scale.lo));
    const showVals = c.showValues ?? (stacked ? false : c.series.length === 1 || n <= 12);

    ticks.forEach((t) => {
      if (c.showGrid) {
        out += `<line class="c-grid" x1="${x(t)}" x2="${x(t)}" y1="${M.t}" y2="${M.t + ph}"/>`;
      }

      out += `<text class="c-text" x="${x(t)}" y="${M.t + ph + 16}" text-anchor="middle">${fmt(t)}</text>`;
    });

    c.labels.forEach((label, i) => {
      const top = M.t + i * rowH;

      out += `<text class="c-text" x="${M.l - 8}" y="${top + rowH / 2 + 4}" text-anchor="end">${escapeHtml(truncateLabel(label, 26))}</text>`;

      if (stacked) {
        const bh = Math.min(22, rowH - 10);
        const y0 = top + (rowH - bh) / 2;
        let pos = 0;
        let neg = 0;

        c.series.forEach((s, k) => {
          const v = s.values[i];
          const from = v >= 0 ? pos : neg;
          const to = from + v;

          if (v >= 0) pos = to;
          else neg = to;

          out += `<rect x="${Math.min(x(from), x(to))}" y="${y0}" width="${Math.max(0.5, Math.abs(x(to) - x(from)))}" height="${bh}" fill="${escapeHtml(seriesColor(c, k))}">${barTitle(c, label, s, v, formatFull)}</rect>`;
        });

        if (c.showValues) {
          out += `<text class="c-val" x="${x(pos) + 6}" y="${y0 + bh / 2 + 4}">${fmt(pos + neg)}</text>`;
        }

        return;
      }

      const bh = Math.min(22, (rowH - 10) / c.series.length);

      c.series.forEach((s, k) => {
        const v = s.values[i];
        const y0 = top + (rowH - bh * c.series.length) / 2 + k * bh;

        out += `<rect x="${Math.min(x(base), x(v))}" y="${y0}" width="${Math.max(1, Math.abs(x(v) - x(base)))}" height="${bh - 2}" rx="3" fill="${escapeHtml(pointColor(c, k, i))}">${barTitle(c, label, s, v, formatFull)}</rect>`;

        if (showVals) {
          out += `<text class="c-val" x="${x(v) + (v >= 0 ? 6 : -6)}" y="${y0 + bh / 2 + 3}" text-anchor="${v >= 0 ? "start" : "end"}">${fmt(v)}</text>`;
        }
      });
    });

    out += `<line class="c-axis" x1="${x(base)}" x2="${x(base)}" y1="${M.t}" y2="${M.t + ph}"/>`;

    if (c.xLabel) {
      out += `<text class="c-text" x="${M.l + pw / 2}" y="${h - 6}" text-anchor="middle">${escapeHtml(c.xLabel)}</text>`;
    }

    return { svg: out, w: W, h };
  }

  /* ---- Vertical bars and lines ---- */
  const rotate =
    c.labels.some((l) => l.length > 9) ||
    (n > 6 && c.labels.some((l) => l.length > 4));
  const tickW = Math.max(...ticks.map((t) => fmt(t).length)) * 6.4 + 16;
  const M = {
    l: Math.max(58, tickW) + (c.yLabel ? 16 : 0),
    r: 18,
    t: 24,
    b: (rotate ? 82 : 40) + (c.xLabel ? 18 : 0),
  };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const y = (v) => M.t + ph * (1 - (clamp(v) - scale.lo) / (scale.hi - scale.lo));

  ticks.forEach((t) => {
    if (c.showGrid) {
      out += `<line class="c-grid" x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    }

    out += `<text class="c-text" x="${M.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  });

  out += `<line class="c-axis" x1="${M.l}" x2="${W - M.r}" y1="${y(base)}" y2="${y(base)}"/>`;

  const labelEvery = Math.max(1, Math.ceil(n / 14));
  const baseY = M.t + ph + 16;

  const xLabel = (cx, i) => {
    if (i % labelEvery !== 0) return "";

    const text = escapeHtml(truncateLabel(c.labels[i], 16));

    return rotate
      ? `<text class="c-text" x="${cx}" y="${baseY}" text-anchor="end" transform="rotate(-35 ${cx} ${baseY})">${text}</text>`
      : `<text class="c-text" x="${cx}" y="${baseY}" text-anchor="middle">${text}</text>`;
  };

  if (c.type === "line") {
    const px = (i) => (n === 1 ? M.l + pw / 2 : M.l + (pw * i) / (n - 1));
    const showVals = c.showValues === true && n <= 30;

    c.series.forEach((s, k) => {
      const color = escapeHtml(seriesColor(c, k));
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${px(i)} ${y(v)}`).join(" ");

      out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;

      s.values.forEach((v, i) => {
        out += `<circle cx="${px(i)}" cy="${y(v)}" r="${n <= 30 ? 3.5 : 5}" fill="${n <= 30 ? color : "transparent"}">${barTitle(c, c.labels[i], s, v, formatFull)}</circle>`;

        if (showVals) {
          out += `<text class="c-val" x="${px(i)}" y="${y(v) - 8}" text-anchor="middle">${fmt(v)}</text>`;
        }
      });
    });

    c.labels.forEach((_, i) => {
      out += xLabel(px(i), i);
    });
  } else {
    const gw = pw / n;
    const inner = gw * 0.72;
    const bw = inner / c.series.length;
    const showVals = c.showValues ?? (!stacked && c.series.length === 1 && n <= 12);

    c.labels.forEach((label, i) => {
      if (stacked) {
        const bx = M.l + i * gw + (gw - inner) / 2;
        let pos = 0;
        let neg = 0;

        c.series.forEach((s, k) => {
          const v = s.values[i];
          const from = v >= 0 ? pos : neg;
          const to = from + v;

          if (v >= 0) pos = to;
          else neg = to;

          out += `<rect x="${bx}" y="${Math.min(y(from), y(to))}" width="${inner}" height="${Math.max(0.5, Math.abs(y(to) - y(from)))}" fill="${escapeHtml(seriesColor(c, k))}">${barTitle(c, label, s, v, formatFull)}</rect>`;
        });

        if (c.showValues && n <= 20) {
          out += `<text class="c-val" x="${bx + inner / 2}" y="${y(pos) - 5}" text-anchor="middle">${fmt(pos + neg)}</text>`;
        }
      } else {
        c.series.forEach((s, k) => {
          const v = s.values[i];
          const bx = M.l + i * gw + (gw - inner) / 2 + k * bw;

          out += `<rect x="${bx}" y="${Math.min(y(v), y(base))}" width="${Math.max(1, bw - 1)}" height="${Math.max(1, Math.abs(y(v) - y(base)))}" rx="3" fill="${escapeHtml(pointColor(c, k, i))}">${barTitle(c, label, s, v, formatFull)}</rect>`;

          if (showVals && n * c.series.length <= 40) {
            out += `<text class="c-val" x="${bx + bw / 2}" y="${v >= 0 ? y(v) - 5 : y(v) + 13}" text-anchor="middle">${fmt(v)}</text>`;
          }
        });
      }

      out += xLabel(M.l + i * gw + gw / 2, i);
    });
  }

  if (c.xLabel) {
    out += `<text class="c-text" x="${M.l + pw / 2}" y="${H - 6}" text-anchor="middle">${escapeHtml(c.xLabel)}</text>`;
  }

  if (c.yLabel) {
    out += `<text class="c-text" x="14" y="${M.t + ph / 2}" text-anchor="middle" transform="rotate(-90 14 ${M.t + ph / 2})">${escapeHtml(truncateLabel(c.yLabel, 40))}</text>`;
  }

  return { svg: out, w: W, h: H };
}

function pieSvg(c) {
  const values = c.series[0].values.map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0);

  if (!total) return null;

  const R = 120;
  const cx = 150;
  const cy = 160;
  const h = Math.max(320, c.labels.length * 24 + 50);
  let out = "";
  let angle = -Math.PI / 2;

  values.forEach((v, i) => {
    const color = escapeHtml(c.colors[i] || CHART_COLORS[i % CHART_COLORS.length]);
    const title = `${escapeHtml(c.labels[i])}: ${formatFull(c.series[0].values[i])} (${((v / total) * 100).toFixed(1)}%)`;

    if (v === total) {
      out += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${color}"><title>${title}</title></circle>`;
    } else if (v > 0) {
      const next = angle + (v / total) * Math.PI * 2;
      const large = next - angle > Math.PI ? 1 : 0;

      out += `<path d="M${cx} ${cy} L${cx + R * Math.cos(angle)} ${cy + R * Math.sin(angle)} A${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(next)} ${cy + R * Math.sin(next)} Z" fill="${color}" class="c-slice"><title>${title}</title></path>`;
      angle = next;
    }
  });

  const legendTop = Math.max(20, (h - c.labels.length * 24) / 2);

  c.labels.forEach((label, i) => {
    const ly = legendTop + i * 24;
    const pct = ((values[i] / total) * 100).toFixed(1);

    out += `<rect x="310" y="${ly}" width="12" height="12" rx="3" fill="${escapeHtml(c.colors[i] || CHART_COLORS[i % CHART_COLORS.length])}"/>`;
    out += `<text class="c-text" x="330" y="${ly + 10}">${escapeHtml(truncateLabel(label, 24))} · ${pct}%</text>`;
  });

  return { svg: out, w: 640, h };
}

function renderChart(spec) {
  const c = parseChartSpec(spec);

  if (!c) return null;

  const drawn = c.type === "pie" ? pieSvg(c) : cartesianSvg(c);

  if (!drawn) return null;

  const legendOn = c.type !== "pie" && (c.showLegend ?? c.series.length > 1);

  const legend = legendOn
    ? `<div class="chart-legend">${c.series
        .map(
          (s, k) =>
            `<span><i style="background:${escapeHtml(seriesColor(c, k))}"></i>${escapeHtml(s.name || `Series ${k + 1}`)}</span>`
        )
        .join("")}</div>`
    : "";

  return `
    <figure class="chart-card">
      ${c.title ? `<figcaption class="chart-title">${escapeHtml(c.title)}</figcaption>` : ""}
      ${legend}
      <div class="chart-scroll">
        <svg viewBox="0 0 ${drawn.w} ${drawn.h}" role="img" aria-label="${escapeHtml(c.title || "Chart")}">${drawn.svg}</svg>
      </div>
    </figure>`;
}

function renderText(text) {
  const lines = text.split("\n");
  let html = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* Markdown table */
    if (
      i + 1 < lines.length &&
      isTableRow(line) &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = parseTableRow(line);

      i += 2;

      const rows = [];

      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }

      html += `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                ${headers.map((header) => `<th>${formatInline(header)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (row) => `
                    <tr>
                      ${row.map((cell) => `<td>${formatInline(cell)}</td>`).join("")}
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;

      continue;
    }

    /* Code block (```chart blocks are drawn as charts) */
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim().toLowerCase();
      const codeLines = [];

      i++;

      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }

      const closed = i < lines.length;

      if (closed) {
        i++;
      }

      if (lang === "chart") {
        if (!closed) {
          html +=
            '<span class="typing" role="status"><i></i><i></i><i></i><span class="typing-label">Building chart</span></span>';
        } else {
          const chart = renderChart(codeLines.join("\n"));

          html +=
            chart ||
            '<div class="notice-box">The chart could not be displayed.</div>';
        }
      } else {
        html += `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
      }

      continue;
    }

    /* Empty line */
    if (!line.trim()) {
      i++;
      continue;
    }

    /* Normal paragraph - stops when a table or code block starts */
    const paragraphLines = [];

    while (
      i < lines.length &&
      lines[i].trim() &&
      !(
        i + 1 < lines.length &&
        isTableRow(lines[i]) &&
        isTableSeparator(lines[i + 1])
      ) &&
      !lines[i].trim().startsWith("```")
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }

    if (paragraphLines.length > 0) {
      html += `<p>${paragraphLines.map(formatInline).join("<br>")}</p>`;
    }
  }

  return html;
}

function isTableRow(line) {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.length >= 2;
}

function isTableSeparator(line) {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.length >= 2 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function formatInline(text) {
  let html = escapeHtml(text);

  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  return html;
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: "smooth",
    });
  });
}

/* ---------- Stream parsing ---------- */

function findText(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(findText).join("");
  }

  if (typeof value !== "object") {
    return "";
  }

  if (typeof value.delta === "string") {
    return value.delta;
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  if (value.text && typeof value.text.value === "string") {
    return value.text.value;
  }

  if (value.content) {
    return findText(value.content);
  }

  if (value.output) {
    return findText(value.output);
  }

  if (value.response) {
    return findText(value.response);
  }

  return "";
}

function processEvent(event, state) {
  const type = event.type || event.event || "";
  const item = event.item || event.output_item || event.data || event;
  const itemType = item?.type || "";

  // Tool / SQL events are intentionally not shown to the user.

  let text = "";

  if (
    type.includes("delta") &&
    !type.includes("function") &&
    !type.includes("tool")
  ) {
    text = typeof event.delta === "string" ? event.delta : findText(event.delta);
  } else if (type.includes("completed") || type === "response.done") {
    text = findText(event.response || event.output || event.data);

    if (text && state.text && text.startsWith(state.text)) {
      text = text.slice(state.text.length);
    }
  }

  if (text) {
    state.text += text;

    state.answer.innerHTML = renderText(state.text);

    scrollToLatest();
  }
}

async function readResponse(response, state) {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  if (
    contentType.includes("text/event-stream") ||
    contentType.includes("ndjson") ||
    response.body
  ) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const data = line.trim().replace(/^data:\s*/, "");

        if (!data || data === "[DONE]" || data.startsWith("event:")) {
          continue;
        }

        try {
          processEvent(JSON.parse(data), state);
        } catch {
          // Ignore incomplete or informational lines.
        }
      }

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      try {
        processEvent(JSON.parse(buffer.trim().replace(/^data:\s*/, "")), state);
      } catch {
        // Ignore incomplete final line.
      }
    }

    return;
  }

  processEvent(await response.json(), state);
}

/* ---------- Sending ---------- */

async function sendMessage(text) {
  if (!text || busy) return;

  setBusy(true);

  welcome.hidden = true;

  addUserMessage(text);

  const assistant = addAssistantMessage();

  const state = {
    answer: assistant.answer,
    text: "",
  };

  history.push({
    role: "user",
    content: text,
  });

  promptInput.value = "";

  resizeInput();
  scrollToLatest();

  const controller = new AbortController();
  currentController = controller;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: history,
        stream: true,
      }),
      signal: controller.signal,
    });

    await readResponse(response, state);

    if (!state.text) {
      history.pop();
      state.answer.innerHTML = `
        <div class="error-box">
          The service replied, but no readable answer was returned.
          Please try again.
        </div>
      `;
    } else {
      history.push({
        role: "assistant",
        content: state.text,
      });
    }
  } catch (error) {
    if (controller.discarded) {
      // The conversation was reset while this request was running.
      return;
    }

    if (error.name === "AbortError") {
      // The user pressed Stop.
      if (state.text) {
        history.push({ role: "assistant", content: state.text });
      } else {
        history.pop();
        state.answer.innerHTML =
          '<div class="notice-box">Stopped. You can ask your question again or try a different one.</div>';
      }
    } else {
      history.pop();
      state.answer.innerHTML = `
        <div class="error-box">
          <strong>I couldn't complete that request.</strong>
          <br>
          ${escapeHtml(error.message || "Please try again.")}
        </div>
      `;
    }
  } finally {
    if (currentController === controller) {
      currentController = null;

      if (state.text) {
        addCopyButton(assistant.row, () =>
          state.text.replace(/```chart[\s\S]*?```/g, "[Chart]")
        );
      }

      setBusy(false);
      promptInput.focus();
      scrollToLatest();
    }
  }
}

resizeInput();
