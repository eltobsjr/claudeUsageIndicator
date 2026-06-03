import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DATA_DIR  = GLib.build_filenamev([GLib.get_user_data_dir(), 'claude-usage']);
const USAGE_FILE = GLib.build_filenamev([DATA_DIR, 'usage.json']);
const CONFIG_FILE = GLib.build_filenamev([DATA_DIR, 'config.json']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function humanTokens(n) {
    n = n || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

function fmtCost(c) { return '$' + (c || 0).toFixed(2); }

function fmtCountdown(isoStr) {
    if (!isoStr) return '';
    const diff = Math.floor((new Date(isoStr) - Date.now()) / 1000);
    if (diff <= 0) return 'agora';
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// ---------------------------------------------------------------------------
// Barra de progresso
// ---------------------------------------------------------------------------
const ProgressBar = GObject.registerClass(
class ProgressBar extends St.BoxLayout {
    _init() {
        super._init({ style_class: 'cu-bar-track', x_expand: true,
                      y_align: Clutter.ActorAlign.CENTER });
        this._fill = new St.Widget({ style_class: 'cu-bar-fill' });
        this.add_child(this._fill);
        this._pct = 0;
        // notify::allocation é mais confiável que notify::width no Wayland
        this.connect('notify::allocation', () => this._relayout());
    }

    setFraction(frac, level) {
        this._pct = Math.max(0, Math.min(1, frac || 0));
        ['cu-warn', 'cu-crit', 'cu-time'].forEach(c =>
            this._fill.remove_style_class_name(c));
        if (level === 'crit')     this._fill.add_style_class_name('cu-crit');
        else if (level === 'warn') this._fill.add_style_class_name('cu-warn');
        else if (level === 'time') this._fill.add_style_class_name('cu-time');
        this.queue_relayout();
    }

    _relayout() {
        const w = this.width;
        if (w > 0) this._fill.width = Math.max(0, Math.round(w * this._pct));
    }
});

// ---------------------------------------------------------------------------
// Seção de métrica (sessão / hoje / semana)
// ---------------------------------------------------------------------------
const MetricRow = GObject.registerClass(
class MetricRow extends PopupMenu.PopupBaseMenuItem {
    _init(label) {
        super._init({ reactive: false, can_focus: false, style_class: 'cu-metric' });

        const box = new St.BoxLayout({ vertical: true, x_expand: true });

        // linha topo: rótulo (esq) + reset countdown (dir)
        const top = new St.BoxLayout({ x_expand: true });
        this._label = new St.Label({
            text: label, style_class: 'cu-metric-label', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._right = new St.Label({
            text: '', style_class: 'cu-metric-right',
            y_align: Clutter.ActorAlign.CENTER,
        });
        top.add_child(this._label);
        top.add_child(this._right);
        box.add_child(top);

        // barra de progresso (sempre visível)
        this._bar = new ProgressBar();
        box.add_child(this._bar);

        // linha rodapé: tokens · custo · reqs
        this._detail = new St.Label({ text: '', style_class: 'cu-metric-detail' });
        box.add_child(this._detail);

        this.add_child(box);
    }

    setTheme(cls) {
        const all = ['cu-tema-sistema', 'cu-tema-catppuccin', 'cu-tema-verde', 'cu-tema-laranja'];
        all.forEach(t => {
            this._bar._fill.remove_style_class_name(t);
            this._label.remove_style_class_name(t);
        });
        if (cls) {
            this._bar._fill.add_style_class_name(cls);
            this._label.add_style_class_name(cls);
        }
    }

    update(bucket, opts = {}) {
        const tokens = bucket.tokens || 0;
        const cost   = bucket.cost   || 0;
        const count  = bucket.count  || 0;

        this._detail.text = `${humanTokens(tokens)} · ${fmtCost(cost)} · ${count} reqs`;

        // lado direito: "X% usado" ou countdown
        if (opts.pct != null) {
            const p = Math.round(opts.pct);
            this._right.text = `${p}% usado`;
            this._right.remove_style_class_name('cu-warn');
            this._right.remove_style_class_name('cu-crit');
            let level = 'ok';
            if (opts.pct >= 90) { level = 'crit'; this._right.add_style_class_name('cu-crit'); }
            else if (opts.pct >= 70) { level = 'warn'; this._right.add_style_class_name('cu-warn'); }
            this._bar.setFraction(opts.pct / 100, level);
        } else {
            // sem limite: countdown + barra cinza baseada em tempo
            const cd = fmtCountdown(opts.reset);
            this._right.text = cd ? `↺ ${cd}` : '';
            this._right.remove_style_class_name('cu-warn');
            this._right.remove_style_class_name('cu-crit');
            this._bar.setFraction(opts.timeFrac || 0, 'time');
        }
    }
});

// ---------------------------------------------------------------------------
// Indicator
// ---------------------------------------------------------------------------
const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Claude Usage', false);
        this._ext = ext;
        this._settings = ext.getSettings();
        this._data = null;

        // --- painel ---
        const panelBox = new St.BoxLayout({ style_class: 'panel-status-menu-box cu-panel' });
        this._panelIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(
                GLib.build_filenamev([ext.path, 'icons', 'claude-symbolic.svg'])),
            style_class: 'system-status-icon',
        });
        this._panelLabel = new St.Label({
            text: '…', y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cu-panel-label',
        });
        panelBox.add_child(this._panelIcon);
        panelBox.add_child(this._panelLabel);
        this.add_child(panelBox);

        this._buildMenu();

        this._settings.connectObject(
            'changed::refresh-interval', () => this._restartTimer(),
            'changed::show-icon',        () => this._applyShowIcon(),
            'changed::color-theme',      () => this._applyTheme(),
            this);
        this._applyShowIcon();
        this._applyTheme();
        this._syncConfig();
        this._tick();
        this._restartTimer();
    }

    _buildMenu() {
        // cabeçalho
        const head = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false,
            style_class: 'cu-head' });
        const hbox = new St.BoxLayout({ x_expand: true });
        hbox.add_child(new St.Label({ text: 'Claude', style_class: 'cu-head-title',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        this._timeLabel = new St.Label({ text: '', style_class: 'cu-head-time',
            y_align: Clutter.ActorAlign.CENTER });
        hbox.add_child(this._timeLabel);
        head.add_child(hbox);
        this.menu.addMenuItem(head);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // métricas
        this._rowSession = new MetricRow(_('Sessão (5h)'));
        this._rowToday   = new MetricRow(_('Hoje'));
        this._rowWeek    = new MetricRow(_('Semana'));
        this.menu.addMenuItem(this._rowSession);
        this.menu.addMenuItem(this._rowToday);
        this.menu.addMenuItem(this._rowWeek);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // por modelo (compacto)
        this._modelBox = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false,
            style_class: 'cu-models' });
        this._modelList = new St.BoxLayout({ vertical: true, x_expand: true });
        this._modelBox.add_child(this._modelList);
        this.menu.addMenuItem(this._modelBox);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // seletor de tema
        this._temaMenu = new PopupMenu.PopupSubMenuMenuItem(_('Tema'));
        const TEMAS_LISTA = [
            ['auto',       _('Automático')],
            ['sistema',    _('Sistema · Fedora Navy')],
            ['catppuccin', _('Catppuccin Macchiato')],
            ['verde',      _('Verde GNOME')],
            ['laranja',    _('Laranja Ubuntu')],
        ];
        this._temaItems = {};
        for (const [id, nome] of TEMAS_LISTA) {
            const item = new PopupMenu.PopupMenuItem(nome);
            item.connect('activate', () => this._settings.set_string('color-theme', id));
            this._temaMenu.menu.addMenuItem(item);
            this._temaItems[id] = item;
        }
        this.menu.addMenuItem(this._temaMenu);

        // ações
        const refresh = new PopupMenu.PopupImageMenuItem(_('Atualizar agora'), 'view-refresh-symbolic');
        refresh.connect('activate', () => this._tick(true));
        this.menu.addMenuItem(refresh);

        const prefs = new PopupMenu.PopupImageMenuItem(_('Preferências'), 'preferences-system-symbolic');
        prefs.connect('activate', () => this._ext.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    _applyShowIcon() {
        this._panelIcon.visible = this._settings.get_boolean('show-icon');
    }

    _applyTheme() {
        const theme = this._settings.get_string('color-theme');
        const cls = theme !== 'auto' ? 'cu-tema-' + theme : null;
        [this._rowSession, this._rowToday, this._rowWeek].forEach(r => r.setTheme(cls));
        this._updateTemaMenu(theme);
    }

    _updateTemaMenu(theme) {
        const NOMES = {
            'auto':       'Automático',
            'sistema':    'Sistema',
            'catppuccin': 'Catppuccin',
            'verde':      'Verde',
            'laranja':    'Laranja',
        };
        this._temaMenu.label.text = `Tema: ${NOMES[theme] || theme}`;
        for (const [id, item] of Object.entries(this._temaItems))
            item.setOrnament(id === theme ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
    }

    _restartTimer() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = null; }
        const iv = Math.max(10, this._settings.get_int('refresh-interval'));
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, iv, () => {
            this._tick(); return GLib.SOURCE_CONTINUE;
        });
        if (!this._cdTimer) {
            this._cdTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                if (this._data) this._render(); return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _syncConfig() {
        try {
            const cfg = {
                session_token_limit:  this._settings.get_int('session-token-limit'),
                daily_token_limit:    this._settings.get_int('daily-token-limit'),
                weekly_token_limit:   this._settings.get_int('weekly-token-limit'),
                weekly_reset_weekday: this._settings.get_int('weekly-reset-weekday'),
                weekly_reset_hour:    this._settings.get_int('weekly-reset-hour'),
            };
            GLib.mkdir_with_parents(DATA_DIR, 0o755);
            Gio.File.new_for_path(CONFIG_FILE).replace_contents(
                JSON.stringify(cfg), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (_e) {}
    }

    _tick() {
        this._syncConfig();
        const py = 'python3';
        const script = GLib.build_filenamev([this._ext.path, 'claude-usage-tracker.py']);
        try {
            Gio.Subprocess.new([py, script],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE)
                .wait_async(null, () => this._loadData());
        } catch (_e) { this._loadData(); }
    }

    _loadData() {
        try {
            const [ok, raw] = Gio.File.new_for_path(USAGE_FILE).load_contents(null);
            if (ok) {
                this._data = JSON.parse(new TextDecoder().decode(raw));
                this._render();
            }
        } catch (_e) { this._panelLabel.text = '—'; }
    }

    _render() {
        const d = this._data;
        if (!d) return;

        const session = d.session || {};
        const today   = d.today   || {};
        const week    = d.week    || {};
        const now     = Date.now();

        // --- painel: "D:35% 14h · S:4% 2d3h" ---
        function panelBit(b, reset) {
            const val = (b.pct != null) ? `${Math.round(b.pct)}%` : humanTokens(b.tokens || 0);
            const cd  = reset ? ` ${fmtCountdown(reset)}` : '';
            return `${val}${cd}`;
        }
        this._panelLabel.text =
            `${panelBit(today, today.reset_at)}  ·  ${panelBit(week, week.reset_at)}`;

        const worstPct = today.pct ?? week.pct ?? null;
        this._panelLabel.remove_style_class_name('cu-warn');
        this._panelLabel.remove_style_class_name('cu-crit');
        if (worstPct != null) {
            if (worstPct >= 90) this._panelLabel.add_style_class_name('cu-crit');
            else if (worstPct >= 70) this._panelLabel.add_style_class_name('cu-warn');
        }

        // timestamp no cabeçalho
        this._timeLabel.text = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // frações de tempo (barra cinza quando sem limite)
        const sessionFrac = (session.pct == null && session.reset_at)
            ? Math.max(0, Math.min(1, 1 - (new Date(session.reset_at) - now) / 18_000_000))
            : null;
        const n = new Date();
        const todayFrac = today.pct == null
            ? (n.getHours() * 3600 + n.getMinutes() * 60) / 86400 : null;
        const weekFrac = (week.pct == null && week.start_at && week.reset_at)
            ? Math.max(0, Math.min(1,
                (now - new Date(week.start_at)) /
                (new Date(week.reset_at) - new Date(week.start_at))))
            : null;

        this._rowSession.update(session, {
            pct: session.pct, reset: session.reset_at, timeFrac: sessionFrac });
        this._rowToday.update(today, {
            pct: today.pct, reset: today.reset_at, timeFrac: todayFrac });
        this._rowWeek.update(week, {
            pct: week.pct, reset: week.reset_at, timeFrac: weekFrac });

        // por modelo
        this._modelList.destroy_all_children();
        const models = d.by_model || {};
        for (const [name, b] of Object.entries(models)) {
            const row = new St.BoxLayout({ x_expand: true, style_class: 'cu-model-row' });
            const short = name.replace('claude-', '').replace(/-\d{8}$/, '');
            row.add_child(new St.Label({ text: short, style_class: 'cu-model-name',
                x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
            row.add_child(new St.Label({
                text: `${humanTokens(b.tokens)}  ${fmtCost(b.cost)}`,
                style_class: 'cu-model-val', y_align: Clutter.ActorAlign.CENTER }));
            this._modelList.add_child(row);
        }
    }

    destroy() {
        if (this._timer)  { GLib.source_remove(this._timer);  this._timer  = null; }
        if (this._cdTimer){ GLib.source_remove(this._cdTimer); this._cdTimer = null; }
        this._settings.disconnectObject(this);
        super.destroy();
    }
});

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._indicator = new ClaudeIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }
    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
