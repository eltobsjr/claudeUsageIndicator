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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtCountdown(isoStr) {
    if (!isoStr) return '';
    const diff = Math.floor((new Date(isoStr) - Date.now()) / 1000);
    if (diff <= 0) return 'agora';
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (d > 0) return `${d}d${h}h`;
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
}

// Nível de alerta de uma janela. Usa a `severity` oficial da API quando houver;
// senão cai para limiares de porcentagem.
function levelFor(w) {
    const s = (w?.severity || '').toLowerCase();
    if (s && s !== 'normal') return s === 'warning' ? 'warn' : 'crit';
    const p = w?.pct;
    if (p == null) return 'ok';
    if (p >= 90) return 'crit';
    if (p >= 70) return 'warn';
    return 'ok';
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
        ['cu-warn', 'cu-crit'].forEach(c =>
            this._fill.remove_style_class_name(c));
        if (level === 'crit')      this._fill.add_style_class_name('cu-crit');
        else if (level === 'warn') this._fill.add_style_class_name('cu-warn');
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

        // linha topo: rótulo (esq) + porcentagem em destaque (dir)
        const top = new St.BoxLayout({ x_expand: true });
        this._label = new St.Label({
            text: label, style_class: 'cu-metric-label', x_expand: true,
            y_align: Clutter.ActorAlign.END,
        });
        this._pct = new St.Label({
            text: '', style_class: 'cu-metric-pct',
            y_align: Clutter.ActorAlign.END,
        });
        top.add_child(this._label);
        top.add_child(this._pct);
        box.add_child(top);

        // barra de progresso (sempre visível)
        this._bar = new ProgressBar();
        box.add_child(this._bar);

        // rodapé: countdown até o reset (secundário)
        this._reset = new St.Label({
            text: '', style_class: 'cu-metric-reset',
            x_align: Clutter.ActorAlign.END, x_expand: true,
        });
        box.add_child(this._reset);

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

    // window = { pct, reset_at, severity }  — sempre vindo da API de uso.
    update(window) {
        const w = window || {};
        this._pct.remove_style_class_name('cu-warn');
        this._pct.remove_style_class_name('cu-crit');

        // Sem dado real: não inventamos número.
        if (w.pct == null) {
            this._pct.text = '—';
            this._reset.text = '';
            this._bar.setFraction(0, 'ok');
            return;
        }

        this._pct.text = `${Math.round(w.pct)}%`;
        const cd = fmtCountdown(w.reset_at);
        this._reset.text = cd ? `reseta em ${cd}` : '';

        const level = levelFor(w);
        if (level === 'crit')      this._pct.add_style_class_name('cu-crit');
        else if (level === 'warn') this._pct.add_style_class_name('cu-warn');
        this._bar.setFraction(w.pct / 100, level);
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
            'changed::refresh-interval',    () => this._restartTimer(),
            'changed::show-icon',           () => this._applyShowIcon(),
            'changed::color-theme',         () => this._applyTheme(),
            'changed::label-format',        () => { if (this._data) this._render(); },
            this);
        this._applyShowIcon();
        this._applyTheme();
        this._applyPlan();
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
        this._planLabel = new St.Label({ text: '', style_class: 'cu-head-plan',
            y_align: Clutter.ActorAlign.CENTER });
        hbox.add_child(this._planLabel);
        this._timeLabel = new St.Label({ text: '', style_class: 'cu-head-time',
            y_align: Clutter.ActorAlign.CENTER });
        hbox.add_child(this._timeLabel);
        head.add_child(hbox);
        this.menu.addMenuItem(head);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // linha de status (login necessário / sessão expirada / indisponível)
        this._statusRow = new PopupMenu.PopupBaseMenuItem({ reactive: false,
            can_focus: false, style_class: 'cu-status' });
        this._statusLabel = new St.Label({ text: '', style_class: 'cu-status-label',
            x_expand: true });
        this._statusRow.add_child(this._statusLabel);
        this.menu.addMenuItem(this._statusRow);
        this._statusRow.visible = false;

        // métricas (vindas da API de uso do claude.ai)
        this._rowSession  = new MetricRow(_('Sessão (5h)'));
        this._rowWeek     = new MetricRow(_('Semana'));
        this._rowWeekOpus = new MetricRow(_('Semana · Opus'));
        this.menu.addMenuItem(this._rowSession);
        this.menu.addMenuItem(this._rowWeek);
        this.menu.addMenuItem(this._rowWeekOpus);
        this._rowWeekOpus.visible = false;  // só em planos Max com limite de Opus
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

    _applyTheme() {
        const theme = this._settings.get_string('color-theme');
        const cls = theme !== 'auto' ? 'cu-tema-' + theme : null;
        [this._rowSession, this._rowWeek, this._rowWeekOpus].forEach(r => r.setTheme(cls));
    }

    _applyPlan() {
        // Plano vem do usage.json (lido da API do claude.ai); atualizado em _render()
    }

    _restartTimer() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = null; }
        const iv = Math.max(15, this._settings.get_int('refresh-interval'));
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, iv, () => {
            this._tick(); return GLib.SOURCE_CONTINUE;
        });
        if (!this._cdTimer) {
            this._cdTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                if (this._data) this._render(); return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _tick(force = false) {
        const script = GLib.build_filenamev([this._ext.path, 'claude-usage-tracker.py']);
        const argv = ['python3', script];
        if (force) argv.push('--force');
        try {
            Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE)
                .wait_async(null, () => this._loadData());
        } catch (_e) { this._loadData(); }
    }

    _loadData() {
        const file = Gio.File.new_for_path(USAGE_FILE);
        file.load_contents_async(null, (f, res) => {
            try {
                const [ok, raw] = f.load_contents_finish(res);
                if (ok) {
                    this._data = JSON.parse(new TextDecoder().decode(raw));
                    this._render();
                }
            } catch (_e) { this._panelLabel.text = '—'; }
        });
    }

    _render() {
        const d = this._data;
        if (!d) return;

        const session = d.session || {};
        const week    = d.week    || {};

        // plano real (da API). Cobre variações tipo "max_5x", "max_20x".
        const planKey = (d.plan || 'unknown').toLowerCase();
        let planTxt = '';
        if (planKey.startsWith('max'))      planTxt = 'Max';
        else if (planKey.startsWith('pro')) planTxt = 'Pro';
        else if (planKey === 'free')        planTxt = 'Free';
        else if (planKey.includes('api'))   planTxt = 'API';
        else if (planKey !== 'unknown')     planTxt = d.plan;
        else                                planTxt = '?';
        this._planLabel.text = planTxt;

        // marca dados servidos do cache (API indisponível no momento)
        this._timeLabel.text = (d.stale ? '⏳ ' : '') +
            new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // --- linha de status (estado vazio / problema) ---
        let status = '';
        if (!d.has_credentials)   status = _('Faça login no Claude Code para ver o uso.');
        else if (d.token_expired) status = _('Sessão expirada — reabra o Claude Code.');
        else if (!d.api_source)   status = _('Uso indisponível no momento.');
        this._statusRow.visible = status !== '';
        this._statusLabel.text = status;

        // --- painel ---
        const fmt = this._settings.get_string('label-format');

        function sparkBar(pct, len = 5) {
            const frac = Math.max(0, Math.min(1, (pct ?? 0) / 100));
            const filled = Math.round(frac * len);
            return '▓'.repeat(filled) + '░'.repeat(len - filled);
        }

        function panelBit(prefix, w) {
            // sem dado real: mostra travessão, nunca um número inventado
            if (w.pct == null) return `${prefix} —`;
            const val = `${Math.round(w.pct)}%`;
            if (fmt === 'spark')    return `${sparkBar(w.pct)} ${val}`;
            if (fmt === 'pct-only') return `${prefix} ${val}`;
            const cd = w.reset_at ? ` ${fmtCountdown(w.reset_at)}` : '';
            return `${prefix} ${val}${cd}`;
        }
        this._panelLabel.text =
            `${panelBit('S', session)} · ${panelBit('W', week)}`;

        const levels = [levelFor(session), levelFor(week)];
        this._panelLabel.remove_style_class_name('cu-warn');
        this._panelLabel.remove_style_class_name('cu-crit');
        if (levels.includes('crit')) this._panelLabel.add_style_class_name('cu-crit');
        else if (levels.includes('warn')) this._panelLabel.add_style_class_name('cu-warn');

        this._rowSession.update(session);
        this._rowWeek.update(week);

        // limite semanal de Opus (só planos Max o expõem)
        const opus = d.week_opus;
        if (opus && opus.pct != null) {
            this._rowWeekOpus.visible = true;
            this._rowWeekOpus.update(opus);
        } else {
            this._rowWeekOpus.visible = false;
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
        this._settings = this.getSettings();
        this._posHandler = this._settings.connect('changed::panel-position',
            () => this._reposition());
        this._create();
    }

    _create() {
        this._indicator = new ClaudeIndicator(this);
        const pos = this._settings.get_string('panel-position');
        switch (pos) {
            case 'left':
                Main.panel.addToStatusArea(this.uuid, this._indicator, -1, 'left');
                break;
            case 'left-edge':
                Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'left');
                break;
            default: // 'right'
                Main.panel.addToStatusArea(this.uuid, this._indicator);
                break;
        }
    }

    _reposition() {
        delete Main.panel.statusArea[this.uuid];
        this._indicator?.destroy();
        this._indicator = null;
        this._create();
    }

    disable() {
        if (this._posHandler) {
            this._settings.disconnect(this._posHandler);
            this._posHandler = null;
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
