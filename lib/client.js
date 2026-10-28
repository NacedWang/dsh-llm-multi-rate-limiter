/* eslint-disable */
/**
 * dsh-llm-multi-rate-limiter — Client (browser) entry point.
 *
 * Registers the rate limiter's configuration page in the Plugins page's
 * `plugins.item` slot (DSH 0.1.7+). The page draws the card chrome — icon,
 * title, crumb, and the "open" navigation — and asks the entry for two views:
 *
 *   - `view: "summary"` → the one-line description on the card;
 *   - `view: "page"`    → the configuration body plus the live status panel.
 *
 * Configuration values and the write channel come from the page itself
 * (`props.form.state` / `props.form.mutate`), not from a plugin-owned
 * `settingsScope`: `dsh-settings` projects the Host entry's volatile Config
 * fields into one shared form per entry, and the page owns that form.
 *
 * Browser format: CJS-style factory registered via window.__ModuleLoader__.load
 * (loaded as a plain <script>, so NO top-level ESM `export` allowed).
 *
 * @module dsh-llm-multi-rate-limiter/client
 */
window.__ModuleLoader__.load({
	id: "@naced/llm-multi-rate-limiter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ── React imports (browser module system provides them) ──────────────
		let react, jsx, jsxs;
		react = require("react");
		({ jsx, jsxs } = require("react/jsx-runtime"));

		// ── Shared constants ──
		/**
		 * Settings namespace = the Host profile entry's id (its
		 * `cordis.patch.yml` row id). `dsh-settings` keys every form by
		 * `entry.options.id`, so this constant must match the row id.
		 */
		const name = "llm-multi-rate-limiter";
		/** Locale dictionary namespace owned by this plugin. */
		const NS = "settings.llmMultiRateLimiter";
		/** Static fiber inject: every service this bundle reads. */
		const inject = ["slots", "locale", "configForms"];

		/* ── locale dictionaries ─────────────────────────────────────────── */
		const zh = {
			title: "LLM 调用限速",
			description: "按模型限制 LLM 请求频率，超出限制的请求排队等待",
			unavailable: "该插件当前未加载，暂时无法配置。",
			readOnly: "本部署的设置为只读。",
		};
		const en = {
			title: "LLM rate limiter",
			description: "Limit per-model LLM request rates; throttled calls wait in queue",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			readOnly: "This deployment stores settings read-only.",
		};

		/* ── CSS-in-JS (design tokens, injected once) ────────────────────── */
		(() => {
			const styles = [
				".rlr-page{display:flex;flex-direction:column;gap:4px;list-style:none;margin:0}",
				".rlr-status{color:var(--dsw-alias-label-tertiary);margin:8px 0 4px;font-size:12px;line-height:1.5}",
				".rlr-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0}",
				".rlr-label{min-width:140px;font-size:13px;color:var(--dsw-alias-label-secondary)}",
				".rlr-input{width:80px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-surface-s2);color:var(--dsw-alias-label-primary);font-size:13px}",
				".rlr-select{padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-surface-s2);color:var(--dsw-alias-label-primary);font-size:13px}",
				".rlr-btn{height:30px;padding:0 12px;border-radius:15px;border:none;cursor:pointer;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary-foreground);background:var(--dsh-alias-button-primary-fill,#4f46e5)}",
				".rlr-btnSec{height:26px;padding:0 10px;border-radius:13px;border:none;cursor:pointer;font-size:12px;background:var(--dsw-alias-button-secondary-fill);color:var(--dsw-alias-label-primary)}",
				".rlr-danger{height:26px;padding:0 8px;border-radius:13px;border:none;cursor:pointer;font-size:11px;background:var(--dsw-alias-state-error-primary);color:#fff}",
				".rlr-modelRow{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l4);gap:8px;margin:4px 0}",
				".rlr-modelName{font-size:13px;font-weight:500;font-family:monospace}",
				".rlr-modelMeta{display:flex;gap:12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}",
				".rlr-section{display:flex;flex-direction:column;gap:4px;margin-top:2px}",
				".rlr-sectHead{margin:10px 0 0;font-size:14px;font-weight:500}",
				// ── status panel ──
				".rlr-statusHead{display:flex;align-items:center;gap:8px;margin:10px 0 0}",
				".rlr-statusTitle{font-size:14px;font-weight:500;flex:1}",
				".rlr-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}",
				".rlr-chip{font-size:11px;padding:2px 8px;border-radius:10px;background:var(--dsw-alias-surface-s2);color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}",
				".rlr-chipOk{background:var(--dsw-alias-state-success-primary,#16a34a);color:#fff}",
				".rlr-chipWarn{background:var(--dsw-alias-state-warning-primary,#d97706);color:#fff}",
				".rlr-chipErr{background:var(--dsw-alias-state-error-primary,#dc2626);color:#fff}",
				".rlr-phase{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
				".rlr-phaseLive{color:var(--dsw-alias-state-success-primary,#16a34a)}",
				".rlr-phaseFailed{color:var(--dsw-alias-state-error-primary,#dc2626)}",
				".rlr-models{display:flex;flex-direction:column;gap:4px;margin:6px 0}",
				".rlr-mRow{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l4)}",
				".rlr-mName{font-size:12px;font-family:monospace;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".rlr-mKind{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--dsw-alias-surface-s2);color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
				".rlr-mMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums}",
				".rlr-mIdle{opacity:.55}",
				".rlr-bar{width:90px;height:6px;border-radius:3px;background:var(--dsw-alias-surface-s2);overflow:hidden;flex:none}",
				".rlr-barFill{height:100%;background:var(--dsw-alias-brand-primary,#4f46e5);transition:width .3s}",
				".rlr-barFillWarn{background:var(--dsw-alias-state-warning-primary,#d97706)}",
				".rlr-log{display:flex;flex-direction:column;gap:1px;margin:6px 0;font-family:monospace;font-size:11px}",
				".rlr-logRow{display:flex;gap:8px;padding:1px 4px;border-radius:4px;color:var(--dsw-alias-label-tertiary)}",
				".rlr-logRowNew{background:var(--dsw-alias-surface-s2)}",
				".rlr-logEv{min-width:66px}",
				".rlr-logEvOk{color:var(--dsw-alias-state-success-primary,#16a34a)}",
				".rlr-logEvWarn{color:var(--dsw-alias-state-warning-primary,#d97706)}",
				".rlr-logEvErr{color:var(--dsw-alias-state-error-primary,#dc2626)}",
				".rlr-logMs{min-width:56px;text-align:right}",
			].join("\n");
			const tagId = "@dsh-llm-multi-rate-limiter/rate-limiter-card.css";
			if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-llm-multi-rate-limiter";
				tag.dataset.pluginCss = tagId;
				tag.textContent = styles;
				document.head.appendChild(tag);
			}
		})();

		/* ── helpers ─────────────────────────────────────────────────────── */
		function readNum(cfg, key, field) {
			return cfg.models?.[key]?.[field] ?? cfg.defaults?.[field] ?? 0;
		}

		/* ── status channel access (dsh-context defensive idiom) ─────────── */
		const STATUS_CHANNEL = "/llm-multi-rate-limiter";

		/**
		 * The connection's bound generic-RPC caller, or undefined when the
		 * service is absent or hostile. Every read is guarded, so this can
		 * never throw — a missing channel degrades the panel, not the page.
		 */
		function rpcCallOf(ctx) {
			try {
				const rpc = ctx.get("connection")?.rpc;
				const fn = rpc?.call;
				if (rpc && typeof fn === "function") return fn.bind(rpc);
			} catch {}
			return undefined;
		}

		/** Format a duration in ms for the chips/log (compact). */
		function fmtMs(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return "0";
			if (ms < 1000) return Math.round(ms) + "ms";
			if (ms < 60_000) return (ms / 1000).toFixed(1) + "s";
			return Math.round(ms / 60_000) + "m";
		}

		/** Human label for a strategy id. */
		function strategyLabel(id) {
			return id === "sliding-window" ? "滑动窗口" : "令牌桶";
		}

		/** Tunable polling cadence: first retry delay doubles up to 8s. */
		const POLL_MS = 1000;
		const POLL_MAX_MULTIPLIER = 8;

		/* ── React component: live status panel ──────────────────────────── */
		function MultiRateLimiterStatus({ statusCall, cfg }) {
			const [snap, setSnap] = react.useState(null);
			const [phase, setPhase] = react.useState("connecting");
			const prevRev = react.useRef(-1);
			const [highlight, setHighlight] = react.useState(false);

			react.useEffect(() => {
				const call = statusCall();
				if (call === undefined) {
					setPhase("no-channel");
					return undefined;
				}
				let stop = false;
				let timer = null;
				let failures = 0;

				const tick = async () => {
					try {
						const r = await call(STATUS_CHANNEL, "snapshot", {});
						if (stop) return;
						if (r?.ok !== true || !r.value) throw new Error("bad envelope");
						setSnap(r.value);
						setPhase("live");
						failures = 0;
					} catch {
						if (stop) return;
						failures += 1;
						setPhase("failed");
					}
					if (stop) return;
					const multiplier = Math.min(2 ** Math.min(failures, 3), POLL_MAX_MULTIPLIER);
					timer = setTimeout(tick, POLL_MS * multiplier);
				};

				tick();
				return () => {
					stop = true;
					if (timer) clearTimeout(timer);
				};
			}, [statusCall]);

			// Flash newly arrived events when `rev` advances between polls.
			react.useEffect(() => {
				if (!snap) return undefined;
				if (prevRev.current === -1) { prevRev.current = snap.rev; return undefined; }
				if (snap.rev === prevRev.current) return undefined;
				prevRev.current = snap.rev;
				setHighlight(true);
				const t = setTimeout(() => setHighlight(false), 700);
				return () => clearTimeout(t);
			}, [snap]);

			// ── non-live phases ──
			if (phase === "no-channel") {
				return jsx("div", { className: "rlr-status", children: "状态通道不可用（需要 DSH web 组合）" });
			}
			if (phase === "connecting" && !snap) {
				return jsx("div", { className: "rlr-status", children: "正在连接状态通道…" });
			}
			if (!snap) {
				return jsx("div", { className: "rlr-status", children: "连接中断，重试中…" });
			}

			const t = snap.totals ?? {};
			const avgWait = t.granted > 0 ? (t.totalWaitMs ?? 0) / t.granted : 0;
			const live = phase === "live";

			function onReset() {
				const call = statusCall();
				if (call === undefined) return;
				Promise.resolve(call(STATUS_CHANNEL, "reset", {})).catch(() => undefined);
			}

			// Union of configured models and models that have actually been used.
			const snapModels = snap.models ?? {};
			const keys = Array.from(new Set([...Object.keys(cfg.models ?? {}), ...Object.keys(snapModels)]));

			const chips = [
				{ label: "请求 " + (t.requests ?? 0) },
				{ label: "通过 " + (t.granted ?? 0), tone: "ok" },
				(t.rejected ?? 0) > 0 && { label: "拒绝 " + t.rejected, tone: "err" },
				(t.timeouts ?? 0) > 0 && { label: "超时 " + t.timeouts, tone: "warn" },
				(t.aborted ?? 0) > 0 && { label: "中止 " + t.aborted, tone: "warn" },
				{ label: "平均等待 " + fmtMs(avgWait) },
			].filter(Boolean);

			const events = Array.isArray(snap.events) ? snap.events.slice().reverse() : [];

			return jsxs("div", { className: "rlr-section", children: [
				jsxs("div", { className: "rlr-statusHead", children: [
					jsx("span", { className: "rlr-statusTitle", children: "📊 实时状态" }),
					jsx("span", {
						className: "rlr-phase" + (live ? " rlr-phaseLive" : " rlr-phaseFailed"),
						children: live ? "● 实时" : "○ 重试中",
					}),
					jsx("button", { type: "button", className: "rlr-btnSec", onClick: onReset, children: "清零" }),
				] }),

				snap.enabled === false
					? jsx("div", { className: "rlr-status", children: "限速已停用" })
					: null,

				jsx("div", { className: "rlr-chips", children: chips.map((c, i) =>
					jsx("span", {
						key: i,
						className: "rlr-chip" + (c.tone === "ok" ? " rlr-chipOk" : c.tone === "warn" ? " rlr-chipWarn" : c.tone === "err" ? " rlr-chipErr" : ""),
						children: c.label,
					}),
				) }),

				keys.length === 0
					? jsx("div", { className: "rlr-status", children: "尚无模型调用记录" })
					: jsx("div", { className: "rlr-models", children: keys.map((key) => {
						const m = snapModels[key];
						if (!m) {
							return jsxs("div", { key, className: "rlr-mRow rlr-mIdle", children: [
								jsx("span", { className: "rlr-mName", children: key }),
								jsx("span", { className: "rlr-mMeta", children: "未调用" }),
							] });
						}
						const isBucket = m.strategy !== "sliding-window";
						const numerator = isBucket ? (m.tokens ?? 0) : (m.countInWindow ?? 0);
						const denominator = isBucket ? (m.burstSize ?? 0) : (m.maxRpm ?? 0);
						const pct = denominator > 0 ? Math.min(100, Math.round((numerator / denominator) * 100)) : 0;
						// A nearly empty bucket / a nearly full window both mean "close to throttling".
						const nearLimit = isBucket ? pct <= 20 : pct >= 80;
						return jsxs("div", { key, className: "rlr-mRow", children: [
							jsx("span", { className: "rlr-mName", title: key, children: key }),
							jsx("span", { className: "rlr-mKind", children: strategyLabel(m.strategy) }),
							jsx("span", { className: "rlr-bar", children:
								jsx("span", { className: "rlr-barFill" + (nearLimit ? " rlr-barFillWarn" : ""), style: { width: pct + "%" } }),
							}),
							jsx("span", { className: "rlr-mMeta", children:
								(isBucket ? numerator + "/" + denominator : numerator + "/" + denominator + " rpm"),
							}),
							jsx("span", { className: "rlr-mMeta", children: "并发 " + (m.concurrent ?? 0) + "/" + (m.maxConcurrent ?? 0) }),
							(m.queued ?? 0) > 0
								? jsx("span", { className: "rlr-chip rlr-chipWarn", children: "排队 " + m.queued })
								: null,
						] });
					}) }),

				events.length > 0
					? jsx("div", { className: "rlr-log", children: events.map((e, i) => {
						const good = e.event === "granted" || e.event === "completed";
						const bad = e.event === "rejected";
						const d = new Date(e.ts ?? Date.now());
						const hh = String(d.getHours()).padStart(2, "0");
						const mm = String(d.getMinutes()).padStart(2, "0");
						const ss = String(d.getSeconds()).padStart(2, "0");
						return jsxs("div", {
							className: "rlr-logRow" + (highlight && i === 0 ? " rlr-logRowNew" : ""),
							children: [
								jsx("span", { children: hh + ":" + mm + ":" + ss }),
								jsx("span", { className: "rlr-logEv " + (good ? "rlr-logEvOk" : bad ? "rlr-logEvErr" : "rlr-logEvWarn"), children: e.event }),
								jsx("span", { className: "rlr-mName", title: e.model, children: e.model }),
								(e.waitMs ?? 0) > 0
									? jsx("span", { className: "rlr-logMs", children: "等待 " + fmtMs(e.waitMs) })
									: null,
							],
						});
					}) })
					: null,
			] });
		}

		/* ── React component: the Settings section ────────────────────────── */
		/**
		 * One number field bound to a config path. Kept dumb on purpose: the
		 * Host validates, this only forwards the edit as one atomic op.
		 */
		function NumField(props) {
			const { label, value, placeholder, min, step, disabled, onChange } = props;
			return jsxs("div", { className: "rlr-row", children: [
				jsx("span", { className: "rlr-label", children: label }),
				jsx("input", {
					className: "rlr-input",
					type: "number",
					min,
					step,
					disabled,
					value: value === undefined || value === null ? "" : value,
					placeholder,
					onChange: (e) => onChange(e.target.value),
				}),
			] });
		}

		/**
		 * The section body: configuration form (Host settings document) plus the
		 * live status panel. Values come from `props.form`, the
		 * `ConfigFormController` this plugin owns for its own namespace, so every
		 * edit is one atomic `mutate(ops)` on `settings.mutate`.
		 *
		 * @param props - `t`, the owned `form`, the framework's `useSnapshot`
		 *   selector hook (bound to `form.store`), and `statusCall`.
		 */
		function SectionPage(props) {
			const t = typeof props.t === "function" ? props.t : (key) => key;
			const form = props.form;
			const snap = typeof props.useSnapshot === "function"
				? props.useSnapshot((s) => s)
				: form?.getSnapshot?.();
			const statusCall = props.statusCall;

			const cfg = snap !== undefined && snap.status === "ready" && snap.value ? snap.value : {};
			const writable = snap === undefined ? true : snap.writable !== false;
			const [draftKey, setDraftKey] = react.useState("");
			const [draftProvider, setDraftProvider] = react.useState("");
			const [query, setQuery] = react.useState("");
			const [confirmKey, setConfirmKey] = react.useState("");
			const [importError, setImportError] = react.useState("");
			const fileInputRef = react.useRef(null);

			/** Queue one atomic namespace mutation; failures leave the form as-is. */
			function push(ops) {
				if (!form || typeof form.mutate !== "function") return;
				try {
					Promise.resolve(form.mutate(ops)).catch(() => undefined);
				} catch {}
			}
			const setPath = (path, value) => push([{ op: "set", path, value }]);
			const unsetPath = (path) => push([{ op: "unset", path }]);
			const setTop = (field, value) => setPath([field], value);
			const setDefault = (field, value) => setPath(["defaults", field], value);
			/** Empty input clears the override, restoring inheritance. */
			function setModel(key, field, raw) {
				const path = ["models", key, field];
				if (raw === "") unsetPath(path);
				else {
					const n = Number(raw);
					if (!Number.isFinite(n)) return;
					setPath(path, n);
				}
			}
			/** Provider tier: same shape, one slashless key. */
			function setProvider(key, field, raw) {
				const path = ["providers", key, field];
				if (raw === "") unsetPath(path);
				else {
					const n = Number(raw);
					if (!Number.isFinite(n)) return;
					setPath(path, n);
				}
			}
			function addProvider() {
				const key = draftProvider.trim();
				if (!key || /[\s/]/.test(key) || providerKeys.includes(key)) {
					setDraftProvider("");
					return;
				}
				setPath(["providers", key], {});
				setDraftProvider("");
			}
			function removeProvider(key) {
				unsetPath(["providers", key]);
			}
			const setCooldown = (field, value) => setPath(["cooldown", field], value);
			/** Downloads the whole namespace value so it can be re-imported. */
			function exportConfig() {
				const payload = {
					$schema: "llm-multi-rate-limiter/config@1",
					exportedAt: new Date().toISOString(),
					config: cfg,
				};
				const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = "llm-multi-rate-limiter.json";
				document.body.appendChild(a);
				a.click();
				setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 0);
				setImportError("");
			}
			/** Applies an imported document as one atomic namespace mutation. */
			function applyImport(text) {
				let parsed;
				try {
					parsed = JSON.parse(text);
				} catch {
					setImportError(t("importInvalidJson"));
					return;
				}
				const imported = parsed !== null && typeof parsed === "object"
					&& parsed.config !== null && typeof parsed.config === "object"
					? parsed.config
					: parsed;
				if (imported === null || typeof imported !== "object" || Array.isArray(imported)) {
					setImportError(t("importInvalidShape"));
					return;
				}
				if (!writable) {
					setImportError(t("importReadOnly"));
					return;
				}
				const ops = [];
				for (const field of ["enabled", "strategy", "defaults", "providers", "models", "cooldown", "onThrottled", "maxQueueWaitMs"]) {
					if (Object.prototype.hasOwnProperty.call(imported, field)) {
						ops.push({ op: "set", path: [field], value: imported[field] });
					}
				}
				if (ops.length === 0) {
					setImportError(t("importEmpty"));
					return;
				}
				setImportError("");
				push(ops);
			}
			async function onPickFile(event) {
				const file = event.target.files && event.target.files[0];
				event.target.value = "";
				if (!file) return;
				try {
					applyImport(await file.text());
				} catch {
					setImportError(t("importUnreadable"));
				}
			}

			const providerKeys = Object.keys(cfg.providers ?? {}).sort();
			const allModelKeys = Object.keys(cfg.models ?? {}).sort();
			const needle = query.trim().toLowerCase();
			// The filter is presentation only: it never hides a stored limit from
			// `mutate`, it just narrows what this render lists.
			const modelKeys = needle === ""
				? allModelKeys
				: allModelKeys.filter((key) => key.toLowerCase().includes(needle));
			const cooldown = cfg.cooldown ?? {};
			const strategy = cfg.strategy ?? "token-bucket";
			const bucket = strategy !== "sliding-window";
			const defaults = cfg.defaults ?? {};

			function addModel() {
				const key = draftKey.trim();
				if (!key || !/^[^/\s]+\/.+$/.test(key) || allModelKeys.includes(key)) {
					setDraftKey("");
					return;
				}
				setPath(["models", key], {});
				setDraftKey("");
			}
			function removeModel(key) {
				unsetPath(["models", key]);
			}
			function toggleModel(key) {
				const off = cfg.models?.[key]?.enabled === false;
				if (off) unsetPath(["models", key, "enabled"]);
				else setPath(["models", key, "enabled"], false);
			}

			return jsxs("div", { className: "rlr-page", children: [
				/* ── unavailable / read-only notices ── */
				snap?.status === "unavailable"
					? jsx("div", { className: "rlr-status", children: t("unavailable") })
					: null,
				snap !== undefined && !writable
					? jsx("div", { className: "rlr-status", children: t("readOnly") })
					: null,

				/* ── 实时状态面板 ── */
				jsx(MultiRateLimiterStatus, { statusCall, cfg }),

				/* ── 总开关 ── */
				jsx("div", { className: "rlr-section", children: [
					jsx("div", { className: "rlr-sectHead", children: t("title") }),
					jsx("div", { className: "rlr-status", children: t("description") }),
					jsxs("div", { className: "rlr-row", children: [
						jsxs("label", { style: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }, children: [
							jsx("input", {
								type: "checkbox",
								checked: cfg.enabled ?? true,
								disabled: !writable,
								onChange: (e) => setTop("enabled", e.target.checked),
							}),
							t("enabled"),
						] }),
					] }),
				] }),

				/* ── 默认配置 ── */
				jsxs("div", { className: "rlr-section", children: [
					jsx("div", { className: "rlr-sectHead", children: t("defaults") }),
					jsxs("div", { className: "rlr-row", children: [
						jsx("span", { className: "rlr-label", children: t("strategy") }),
						jsxs("select", {
							className: "rlr-select",
							value: strategy,
							disabled: !writable,
							onChange: (e) => setTop("strategy", e.target.value),
							children: [
								jsx("option", { value: "token-bucket", children: t("tokenBucket") }),
								jsx("option", { value: "sliding-window", children: t("slidingWindow") }),
							],
						}),
					] }),
					jsx(NumField, { label: t("maxConcurrent"), value: defaults.maxConcurrent, placeholder: "5", min: 1, step: 1, disabled: !writable, onChange: (v) => setDefault("maxConcurrent", Number(v) || 1) }),
					jsx(NumField, { label: t("maxRpm"), value: defaults.maxRpm, placeholder: "60", min: 1, step: 1, disabled: !writable, onChange: (v) => setDefault("maxRpm", Number(v) || 1) }),
					bucket
						? jsx(NumField, { label: t("burstSize"), value: defaults.burstSize, placeholder: "10", min: 1, step: 1, disabled: !writable, onChange: (v) => setDefault("burstSize", Number(v) || 1) })
						: null,
					bucket
						? jsx(NumField, { label: t("refillRate"), value: defaults.refillRate, placeholder: "1", min: 0.1, step: 0.1, disabled: !writable, onChange: (v) => setDefault("refillRate", Number(v) || 0.1) })
						: null,
				] }),

				/* ── 模型专属配置 ── */
				jsxs("div", { className: "rlr-section", children: [
					jsx("div", { className: "rlr-sectHead", children: t("models") }),
					jsx("div", { className: "rlr-status", children: t("modelsHint") }),
					allModelKeys.length > 6
						? jsxs("div", { className: "rlr-row", children: [
							jsx("input", {
								className: "rlr-input",
								style: { width: 240 },
								type: "search",
								placeholder: t("searchPlaceholder"),
								value: query,
								onChange: (e) => setQuery(e.target.value),
							}),
							jsx("span", { className: "rlr-modelMeta", children: modelKeys.length + " / " + allModelKeys.length }),
						] })
						: null,
					allModelKeys.length === 0
						? jsx("p", { className: "rlr-status", children: t("noModels") })
						: modelKeys.length === 0
							? jsx("p", { className: "rlr-status", children: t("noMatches") })
						: modelKeys.map((key) => {
							const o = cfg.models?.[key] ?? {};
							const off = o.enabled === false;
							const effRpm = o.maxRpm ?? defaults.maxRpm ?? 60;
							const effConc = o.maxConcurrent ?? defaults.maxConcurrent ?? 5;
							return jsxs("div", { className: "rlr-modelRow", key, style: off ? { opacity: 0.55 } : undefined, children: [
								jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }, children: [
									jsx("span", { className: "rlr-modelName", children: key }),
									jsxs("span", { className: "rlr-modelMeta", children: [
										jsx("span", { children: t("effective") + ": " + effRpm + " rpm / " + effConc + " " + t("concurrent") }),
									] }),
								] }),
								jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
									jsx("input", {
										className: "rlr-input", type: "number", min: 1, style: { width: 64 }, title: t("maxRpm"),
										disabled: !writable, value: o.maxRpm ?? "", placeholder: "rpm",
										onChange: (e) => setModel(key, "maxRpm", e.target.value),
									}),
									jsx("input", {
										className: "rlr-input", type: "number", min: 1, style: { width: 56 }, title: t("maxConcurrent"),
										disabled: !writable, value: o.maxConcurrent ?? "", placeholder: t("concurrent"),
										onChange: (e) => setModel(key, "maxConcurrent", e.target.value),
									}),
									bucket
										? jsx("input", {
											className: "rlr-input", type: "number", min: 1, style: { width: 56 }, title: t("burstSize"),
											disabled: !writable, value: o.burstSize ?? "", placeholder: t("burstSize"),
											onChange: (e) => setModel(key, "burstSize", e.target.value),
										})
										: null,
									jsx("button", { className: "rlr-btnSec", disabled: !writable, onClick: () => toggleModel(key), children: off ? t("enable") : t("disable") }),
									confirmKey === key
										? jsxs("span", { style: { display: "flex", gap: 4, alignItems: "center" }, children: [
											jsx("button", {
												className: "rlr-danger",
												disabled: !writable,
												onClick: () => { removeModel(key); setConfirmKey(""); },
												children: t("confirmDelete"),
											}),
											jsx("button", { className: "rlr-btnSec", onClick: () => setConfirmKey(""), children: t("cancel") }),
										] })
										: jsx("button", {
											className: "rlr-danger",
											disabled: !writable,
											onClick: () => setConfirmKey(key),
											title: t("remove"),
											children: "✕",
										}),
								] }),
							] });
						}),
					jsxs("div", { className: "rlr-row", children: [
						jsx("input", {
							className: "rlr-input",
							style: { width: 240 },
							placeholder: t("addPlaceholder"),
							value: draftKey,
							disabled: !writable,
							onChange: (e) => setDraftKey(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter") addModel(); },
						}),
						jsx("button", { className: "rlr-btn", disabled: !writable, onClick: addModel, children: t("addModel") }),
					] }),
				] }),

				/* ── provider 级配置 ── */
				jsxs("div", { className: "rlr-section", children: [
					jsx("div", { className: "rlr-sectHead", children: t("providers") }),
					jsx("div", { className: "rlr-status", children: t("providersHint") }),
					providerKeys.length === 0
						? jsx("p", { className: "rlr-status", children: t("noProviders") })
						: providerKeys.map((key) => {
							const o = cfg.providers?.[key] ?? {};
							return jsxs("div", { className: "rlr-modelRow", key, children: [
								jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }, children: [
									jsx("span", { className: "rlr-modelName", children: key + "/*" }),
									jsx("span", { className: "rlr-modelMeta", children: t("providerScope") }),
								] }),
								jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
									jsx("input", {
										className: "rlr-input", type: "number", min: 1, style: { width: 64 }, title: t("maxRpm"),
										disabled: !writable, value: o.maxRpm ?? "", placeholder: "rpm",
										onChange: (e) => setProvider(key, "maxRpm", e.target.value),
									}),
									jsx("input", {
										className: "rlr-input", type: "number", min: 1, style: { width: 56 }, title: t("maxConcurrent"),
										disabled: !writable, value: o.maxConcurrent ?? "", placeholder: t("concurrent"),
										onChange: (e) => setProvider(key, "maxConcurrent", e.target.value),
									}),
									jsx("button", { className: "rlr-danger", disabled: !writable, onClick: () => removeProvider(key), title: t("remove"), children: "✕" }),
								] }),
							] });
						}),
					jsxs("div", { className: "rlr-row", children: [
						jsx("input", {
							className: "rlr-input",
							style: { width: 200 },
							placeholder: t("addProviderPlaceholder"),
							value: draftProvider,
							disabled: !writable,
							onChange: (e) => setDraftProvider(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter") addProvider(); },
						}),
						jsx("button", { className: "rlr-btn", disabled: !writable, onClick: addProvider, children: t("addProvider") }),
					] }),
				] }),

				/* ── 429 自适应降速 ── */
				jsxs("div", { className: "rlr-section", children: [
					jsx("div", { className: "rlr-sectHead", children: t("cooldown") }),
					jsx("div", { className: "rlr-status", children: t("cooldownHint") }),
					jsxs("div", { className: "rlr-row", children: [
						jsxs("label", { style: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }, children: [
							jsx("input", {
								type: "checkbox",
								checked: cooldown.enabled ?? true,
								disabled: !writable,
								onChange: (e) => setCooldown("enabled", e.target.checked),
							}),
							t("cooldownEnabled"),
						] }),
					] }),
					jsx(NumField, { label: t("cooldownMs"), value: cooldown.cooldownMs, placeholder: "30000", min: 1000, step: 1000, disabled: !writable, onChange: (v) => setCooldown("cooldownMs", Number(v) || 30000) }),
					jsx(NumField, { label: t("cooldownFactor"), value: cooldown.factor, placeholder: "0.5", min: 0.05, step: 0.05, disabled: !writable, onChange: (v) => setCooldown("factor", Number(v) || 0.5) }),
					jsx(NumField, { label: t("recoverAfter"), value: cooldown.recoverAfter, placeholder: "3", min: 1, step: 1, disabled: !writable, onChange: (v) => setCooldown("recoverAfter", Number(v) || 3) }),
				] }),

				/* ── 配置导入 / 导出 ── */
				jsxs("div", { className: "rlr-section", children: [
					jsx("div", { className: "rlr-sectHead", children: t("preset") }),
					jsx("div", { className: "rlr-status", children: t("presetHint") }),
					jsxs("div", { className: "rlr-row", children: [
						jsx("button", { className: "rlr-btn", onClick: exportConfig, children: t("exportConfig") }),
						jsx("button", {
							className: "rlr-btn",
							disabled: !writable,
							onClick: () => { if (fileInputRef.current) fileInputRef.current.click(); },
							children: t("importConfig"),
						}),
						jsx("input", {
							ref: fileInputRef,
							type: "file",
							accept: "application/json,.json",
							style: { display: "none" },
							onChange: onPickFile,
						}),
					] }),
					importError !== ""
						? jsx("div", { className: "rlr-status", style: { color: "var(--fg-danger, #d9534f)" }, children: importError })
						: null,
				] }),

				/* ── 被限速时的行为 ── */
				jsxs("div", { className: "rlr-section", children: [
					jsx("div", { className: "rlr-sectHead", children: t("behavior") }),
					jsxs("div", { className: "rlr-row", children: [
						jsxs("label", { style: { display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }, children: [
							jsx("input", {
								type: "radio", name: "mlr-on-throttle", disabled: !writable,
								checked: cfg.onThrottled !== "reject",
								onChange: () => setTop("onThrottled", "queue"),
							}),
							t("queue"),
						] }),
						jsxs("label", { style: { display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }, children: [
							jsx("input", {
								type: "radio", name: "mlr-on-throttle", disabled: !writable,
								checked: cfg.onThrottled === "reject",
								onChange: () => setTop("onThrottled", "reject"),
							}),
							t("reject"),
						] }),
					] }),
					cfg.onThrottled !== "reject"
						? jsx(NumField, { label: t("maxQueueWait"), value: cfg.maxQueueWaitMs, placeholder: "60000", min: 1000, step: 1000, disabled: !writable, onChange: (v) => setTop("maxQueueWaitMs", Number(v) || 60000) })
						: null,
				] }),

				/* ── 落盘说明 ── */
				jsx("div", { className: "rlr-status", children: t("saveHint") }),
			] });
		}

		/* ── Sidebar icon ─────────────────────────────────────────────────── */
		/**
		 * Icon for the root sidebar panel list: a gauge with a needle, which reads
		 * as "rate / throttle" at 16px and stays legible in the collapsed rail.
		 *
		 * @param props - slot props (`size` is supplied by the sidebar row).
		 */
		function PanelIcon(props) {
			const size = typeof props.size === "number" ? props.size : 16;
			return jsx("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					jsx("path", { d: "M4.2 18a8.5 8.5 0 1 1 15.6 0" }),
					jsx("path", { d: "M12 13.4 16.4 9" }),
					jsx("circle", { cx: 12, cy: 14, r: 1.5 }),
					jsx("path", { d: "M3 21h18" }),
				],
			});
		}

		/* ── Plugin registration ──────────────────────────────────────────── */
		/**
		 * Register the Settings section, the dictionaries it reads, and the form
		 * it edits. The section lives in the Settings navigation, so it does not
		 * depend on any other page owning a slot this plugin could not reach.
		 *
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh: Object.assign({}, zh, {
					nav: "多模型限速",
					enabled: "启用限速",
					defaults: "默认配置",
					strategy: "策略",
					tokenBucket: "令牌桶 (Token Bucket)",
					slidingWindow: "滑动窗口 (Sliding Window)",
					maxConcurrent: "最大并发数",
					maxRpm: "每分钟最大请求数",
					burstSize: "突发容量",
					refillRate: "补充速率 (个/秒)",
					models: "模型专属配置",
					modelsHint: "格式 provider/model；留空即继承默认值。",
					noModels: "未配置任何模型专属限速，所有模型使用默认值。",
					addModel: "+ 添加模型",
					addPlaceholder: "例如 openai/gpt-5.1",
					effective: "实际生效",
					concurrent: "并发",
					enable: "启用",
					disable: "禁用",
					remove: "删除",
					behavior: "被限速时的行为",
					queue: "排队等待",
					reject: "拒绝请求",
					maxQueueWait: "最大排队等待 (ms)",
					saveHint: "改动即写入 profile 的 cordis.patch.yml，无需重启。",
					searchPlaceholder: "搜索模型…",
					noMatches: "没有匹配的模型。",
					confirmDelete: "确认删除",
					cancel: "取消",
					providers: "Provider 级配置",
					providersHint: "作用于该 provider 下所有未单独配置的模型；优先级低于模型专属配置。",
					noProviders: "未配置 provider 级限速。",
					addProvider: "+ 添加 provider",
					addProviderPlaceholder: "例如 openai",
					providerScope: "作用于该 provider 的全部模型",
					cooldown: "429 自适应降速",
					cooldownHint: "provider 返回 429 时临时调低该模型的速率，连续成功后再恢复。",
					cooldownEnabled: "遇到 429 时自动降速",
					cooldownMs: "降速持续时间 (ms)",
					cooldownFactor: "降速系数 (0.05–0.9)",
					recoverAfter: "恢复所需的连续成功次数",
					preset: "配置导入 / 导出",
					presetHint: "导出的 JSON 可在另一台机器导入，覆盖当前全部设置。",
					exportConfig: "导出 JSON",
					importConfig: "导入 JSON",
					importInvalidJson: "导入失败：不是合法 JSON。",
					importInvalidShape: "导入失败：需要限速配置对象。",
					importReadOnly: "导入失败：当前配置只读。",
					importEmpty: "导入失败：文件里没有可识别的限速配置字段。",
					importUnreadable: "导入失败：无法读取该文件。",
				}),
				en: Object.assign({}, en, {
					nav: "Multi-model limits",
					enabled: "Rate limiting enabled",
					defaults: "Defaults",
					strategy: "Strategy",
					tokenBucket: "Token bucket",
					slidingWindow: "Sliding window",
					maxConcurrent: "Max concurrent",
					maxRpm: "Max requests / minute",
					burstSize: "Burst size",
					refillRate: "Refill rate (per second)",
					models: "Per-model limits",
					modelsHint: "Format provider/model; leave a field empty to inherit the default.",
					noModels: "No per-model limit yet — every model uses the defaults.",
					addModel: "+ Add model",
					addPlaceholder: "e.g. openai/gpt-5.1",
					effective: "Effective",
					concurrent: "concurrent",
					enable: "Enable",
					disable: "Disable",
					remove: "Remove",
					behavior: "When throttled",
					queue: "Wait in queue",
					reject: "Reject the request",
					maxQueueWait: "Max queue wait (ms)",
					saveHint: "Edits are written to the profile's cordis.patch.yml immediately.",
					searchPlaceholder: "Search models…",
					noMatches: "No model matches this filter.",
					confirmDelete: "Delete",
					cancel: "Cancel",
					providers: "Per-provider limits",
					providersHint: "Applies to every model of that provider that has no per-model limit.",
					noProviders: "No per-provider limit yet.",
					addProvider: "+ Add provider",
					addProviderPlaceholder: "e.g. openai",
					providerScope: "covers every model of this provider",
					cooldown: "Adaptive 429 backoff",
					cooldownHint: "After the provider answers 429, this model runs slower until calls succeed again.",
					cooldownEnabled: "Slow down automatically after a 429",
					cooldownMs: "Cooldown duration (ms)",
					cooldownFactor: "Speed factor (0.05–0.9)",
					recoverAfter: "Consecutive successes to recover",
					preset: "Import / export",
					presetHint: "Exported JSON can be imported on another machine; it replaces every setting.",
					exportConfig: "Export JSON",
					importConfig: "Import JSON",
					importInvalidJson: "Import failed: not valid JSON.",
					importInvalidShape: "Import failed: expected a limiter configuration object.",
					importReadOnly: "Import failed: the configuration is read-only.",
					importEmpty: "Import failed: the file has no recognisable limiter settings.",
					importUnreadable: "Import failed: the file could not be read.",
				}),
			}), "llm-multi-rate-limiter: dictionaries");

			// The page edits this plugin's own namespace: `get` creates the one
			// shared form for it and disposes with this fiber, so the page needs no
			// `whileServed` gate (it owns the entry).
			const form = ctx.configForms.get(name);
			const inject = () => ({
				form,
				t,
				hooks: { snapshot: form.store },
				statusCall: () => rpcCallOf(ctx),
			});

			// Two surfaces, one page: the Settings section (native settings nav) and
			// a root sidebar panel (icon + label list, `main` keyed by the same id)
			// so the limiter is reachable without opening Settings at all.
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: name,
				order: 15,
				label: () => t("nav"),
				locale: NS,
				inject,
			}, SectionPage)), "llm-multi-rate-limiter: settings section");

			ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: name,
				order: 40,
				label: () => t("nav"),
				locale: NS,
			}, PanelIcon)), "llm-multi-rate-limiter: sidebar entry");

			ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: name,
				locale: NS,
				inject,
			}, SectionPage)), "llm-multi-rate-limiter: sidebar panel");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		exports.NS = NS;
		return module.exports;
	},
});
