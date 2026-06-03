/* Claude Usage Indicator — GNOME Shell extension
 * Mostra o uso do Claude (Claude Code) na barra superior.
 * 100% local: lê os JSONL do Claude Code via um tracker em Python.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DATA_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'claude-usage']);
const USAGE_FILE = GLib.build_filenamev([DATA_DIR, 'usage.json']);
const CONFIG_FILE = GLib.build_filenamev([DATA_DIR, 'config.json']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function humanTokens(n) {
    n = n || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

function fmtCost(c) {
    return '$' + (c || 0).toFixed(2);
}

function fmtCountdown(isoStr) {
    if (!isoStr) return _('expirado');
    const target = new Date(isoStr).getTime();
    let diff = Math.floor((target - Date.now()) / 1000);
    if (diff <= 0) return _('agora');
    const d = Math.floor(diff / 86400); diff -= d * 86400;
    const h = Math.floor(diff / 3600); diff -= h * 3600;
    const m = Math.floor(diff / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// ---------------------------------------------------------------------------
// Barra de progresso (compatível com tema via accent color)
// ---------------------------------------------------------------------------
const ProgressBar = GObject.registerClass(
class ProgressBar extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'cu-progress-track',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill = new St.Widget({ style_class: 'cu-progress-fill' });
        this.add_child(this._fill);
        this._pct = 0;
        this.connect('notify::width', () => this._relayout());
    }

    setFraction(frac, level) {
        this._pct = Math.max(0, Math.min(1, frac || 0));
        this._fill.remove_style_class_name('cu-level-warn');
        this._fill.remove_style_class_name('cu-level-crit');
        if (level === 'crit') this._fill.add_style_class_name('cu-level-crit');
        else if (level === 'warn') this._fill.add_style_class_name('cu-level-warn');
        this._relayout();
    }

    _relayout() {
        const w = this.width;
        if (w > 0) this._fill.width = Math.round(w * this._pct);
    }
});

// ---------------------------------------------------------------------------
// Linha de seção do popup
// ---------------------------------------------------------------------------
const StatRow = GObject.registerClass(
class StatRow extends PopupMenu.PopupBaseMenuItem {
    _init(title, iconName) {
        super._init({ reactive: false, can_focus: false, style_class: 'cu-stat-row' });

        const box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'cu-stat-box' });

        const header = new St.BoxLayout({ x_expand: true, style_class: 'cu-stat-header' });
        if (iconName) {
            header.add_child(new St.Icon({
                icon_name: iconName,
                style_class: 'cu-stat-icon',
                icon_size: 16,
            }));
        }
        this._title = new St.Label({ text: title, style_class: 'cu-stat-title', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER });
        this._reset = new St.Label({ text: '', style_class: 'cu-stat-reset',
            y_align: Clutter.ActorAlign.CENTER });
        header.add_child(this._title);
        header.add_child(this._reset);
        box.add_child(header);

        this._bar = new ProgressBar();
        box.add_child(this._bar);

        const footer = new St.BoxLayout({ x_expand: true, style_class: 'cu-stat-footer' });
        this._main = new St.Label({ text: '', style_class: 'cu-stat-main', x_expand: true });
        this._sub = new St.Label({ text: '', style_class: 'cu-stat-sub' });
        footer.add_child(this._main);
        footer.add_child(this._sub);
        box.add_child(footer);

        this.add_child(box);
        this._hasBar = true;
    }

    update(bucket, opts = {}) {
        const tokens = bucket.tokens || 0;
        const cost = bucket.cost || 0;
        const count = bucket.count || 0;
        this._main.text = `${humanTokens(tokens)} tokens · ${fmtCost(cost)}`;
        this._sub.text = `${count} ${count === 1 ? _('req') : _('reqs')}`;

        if (opts.reset !== undefined) {
            this._reset.text = opts.reset ? `↻ ${fmtCountdown(opts.reset)}` : '';
        }

        if (opts.pct !== null && opts.pct !== undefined) {
            const frac = opts.pct / 100;
            let level = 'ok';
            if (opts.pct >= 90) level = 'crit';
            else if (opts.pct >= 70) level = 'warn';
            this._bar.setFraction(frac, level);
            this._bar.show();
            this._sub.text += ` · ${opts.pct}%`;
        } else if (this._hasBar) {
            this._bar.hide();
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

        // ---- painel ----
        const panelBox = new St.BoxLayout({ style_class: 'panel-status-menu-box cu-panel' });
        this._panelIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([ext.path, 'icons', 'claude-symbolic.svg'])),
            style_class: 'system-status-icon cu-panel-icon',
        });
        this._panelLabel = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cu-panel-label',
        });
        panelBox.add_child(this._panelIcon);
        panelBox.add_child(this._panelLabel);
        this.add_child(panelBox);

        this._buildMenu();

        // ---- timers ----
        this._settings.connectObject(
            'changed::refresh-interval', () => this._restartTimer(),
            'changed::panel-mode', () => this._render(),
            'changed::show-icon', () => this._applyShowIcon(),
            this);
        this._applyShowIcon();

        this._syncConfigToTracker();
        this._tick();
        this._restartTimer();
    }

    _buildMenu() {
        // título
        const titleItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false,
            style_class: 'cu-menu-title' });
        const tbox = new St.BoxLayout({ x_expand: true });
        tbox.add_child(new St.Label({ text: _('Uso do Claude'), style_class: 'cu-title-label',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        this._updatedLabel = new St.Label({ text: '', style_class: 'cu-updated',
            y_align: Clutter.ActorAlign.CENTER });
        tbox.add_child(this._updatedLabel);
        titleItem.add_child(tbox);
        this.menu.addMenuItem(titleItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // seções
        this._rowSession = new StatRow(_('Sessão (5h)'), 'preferences-system-time-symbolic');
        this._rowToday = new StatRow(_('Hoje'), 'x-office-calendar-symbolic');
        this._rowWeek = new StatRow(_('Semana'), 'view-refresh-symbolic');
        this.menu.addMenuItem(this._rowSession);
        this.menu.addMenuItem(this._rowToday);
        this.menu.addMenuItem(this._rowWeek);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // por modelo
        const modelHeader = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        modelHeader.add_child(new St.Label({ text: _('Por modelo'), style_class: 'cu-section-header' }));
        this.menu.addMenuItem(modelHeader);
        this._modelBox = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this._modelList = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'cu-model-list' });
        this._modelBox.add_child(this._modelList);
        this.menu.addMenuItem(this._modelBox);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // total
        const totalItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const totalBox = new St.BoxLayout({ x_expand: true });
        totalBox.add_child(new St.Label({ text: _('Total acumulado'), style_class: 'cu-total-label',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        this._totalLabel = new St.Label({ text: '', style_class: 'cu-total-value',
            y_align: Clutter.ActorAlign.CENTER });
        totalBox.add_child(this._totalLabel);
        totalItem.add_child(totalBox);
        this.menu.addMenuItem(totalItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

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

    _restartTimer() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = null; }
        const interval = Math.max(10, this._settings.get_int('refresh-interval'));
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        // timer leve só para atualizar contadores de reset
        if (!this._countdownTimer) {
            this._countdownTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                if (this._data) this._render();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    // escreve as configs do plano para o tracker em config.json
    _syncConfigToTracker() {
        try {
            const cfg = {
                session_token_limit: this._settings.get_int('session-token-limit'),
                weekly_token_limit: this._settings.get_int('weekly-token-limit'),
                weekly_reset_weekday: this._settings.get_int('weekly-reset-weekday'),
                weekly_reset_hour: this._settings.get_int('weekly-reset-hour'),
            };
            GLib.mkdir_with_parents(DATA_DIR, 0o755);
            const f = Gio.File.new_for_path(CONFIG_FILE);
            f.replace_contents(JSON.stringify(cfg), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            logError(e, 'claude-usage: erro ao gravar config');
        }
    }

    // roda o tracker e depois lê o usage.json
    _tick(force = false) {
        this._syncConfigToTracker();
        const py = this._resolvePython();
        const script = GLib.build_filenamev([this._ext.path, 'claude-usage-tracker.py']);
        try {
            const proc = Gio.Subprocess.new(
                [py, script],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.wait_async(null, () => {
                this._loadData();
            });
        } catch (e) {
            // se falhar ao rodar python, ainda tenta ler dado antigo
            this._loadData();
        }
    }

    _resolvePython() {
        for (const c of ['python3', '/usr/bin/python3', '/usr/local/bin/python3']) {
            if (GLib.find_program_in_path(c) || GLib.file_test(c, GLib.FileTest.IS_EXECUTABLE))
                return c;
        }
        return 'python3';
    }

    _loadData() {
        try {
            const f = Gio.File.new_for_path(USAGE_FILE);
            const [ok, contents] = f.load_contents(null);
            if (ok) {
                const decoder = new TextDecoder('utf-8');
                this._data = JSON.parse(decoder.decode(contents));
                this._render();
            }
        } catch (e) {
            this._panelLabel.text = '—';
        }
    }

    _render() {
        const d = this._data;
        if (!d) return;
        const mode = this._settings.get_string('panel-mode');

        // ---- painel ----
        const session = d.session || {};
        const today = d.today || {};
        const week = d.week || {};
        let txt = '';
        switch (mode) {
            case 'session-pct':
                txt = (session.pct != null) ? `${Math.round(session.pct)}%`
                                            : humanTokens(session.tokens);
                break;
            case 'week-pct':
                txt = (week.pct != null) ? `${Math.round(week.pct)}%`
                                         : humanTokens(week.tokens);
                break;
            case 'session-cost':
                txt = fmtCost(session.cost);
                break;
            case 'today-cost':
                txt = fmtCost(today.cost);
                break;
            case 'session-reset':
                txt = fmtCountdown(session.reset_at);
                break;
            case 'session-tokens':
            default:
                txt = humanTokens(session.tokens);
                break;
        }
        this._panelLabel.text = txt;

        // cor do painel conforme nível (sessão)
        this._panelLabel.remove_style_class_name('cu-warn');
        this._panelLabel.remove_style_class_name('cu-crit');
        const p = session.pct;
        if (p != null) {
            if (p >= 90) this._panelLabel.add_style_class_name('cu-crit');
            else if (p >= 70) this._panelLabel.add_style_class_name('cu-warn');
        }

        // ---- popup ----
        this._rowSession.update(session, { reset: session.reset_at, pct: session.pct });
        this._rowToday.update(today, { pct: null });
        this._rowWeek.update(week, { reset: week.reset_at, pct: week.pct });

        // por modelo
        this._modelList.destroy_all_children();
        const models = d.by_model || {};
        const entries = Object.entries(models);
        if (entries.length === 0) {
            this._modelList.add_child(new St.Label({ text: _('sem dados'), style_class: 'cu-model-empty' }));
        }
        for (const [name, b] of entries) {
            const row = new St.BoxLayout({ x_expand: true, style_class: 'cu-model-row' });
            const short = name.replace('claude-', '').replace(/-\d{8}$/, '');
            row.add_child(new St.Label({ text: short, style_class: 'cu-model-name',
                x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
            row.add_child(new St.Label({ text: `${humanTokens(b.tokens)} · ${fmtCost(b.cost)}`,
                style_class: 'cu-model-val', y_align: Clutter.ActorAlign.CENTER }));
            this._modelList.add_child(row);
        }

        // total
        const total = d.total || {};
        this._totalLabel.text = `${humanTokens(total.tokens)} · ${fmtCost(total.cost)}`;

        // updated
        if (d.generated_at) {
            const t = new Date(d.generated_at);
            this._updatedLabel.text = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    destroy() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = null; }
        if (this._countdownTimer) { GLib.source_remove(this._countdownTimer); this._countdownTimer = null; }
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
