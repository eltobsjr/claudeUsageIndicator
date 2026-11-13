// Claude Usage Indicator — família Indicator (DESIGN.md).
// Anéis que ESVAZIAM (como o OpenBot), cards que acompanham o estado, ritmo, consumo por modelo (gráfico acumulado ou
// lista) e agentes do OpenBot. Tudo que muda a exibição é configurado nas Preferências.
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as L from './logic.js';

const DATA_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'claude-usage']);
const USAGE_FILE = GLib.build_filenamev([DATA_DIR, 'usage.json']);

// ---------------------------------------------------------------------------
// Desenho (Cairo). As cores vêm do tema por propriedades -cu-* (nunca hex no JS).
// ---------------------------------------------------------------------------
function setColor(cr, c, alpha = 1) {
    cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255, (c.alpha / 255) * alpha);
}

/** Anel que esvazia: `frac` (0..1) do círculo colorido a partir do topo, e um traço opcional "onde deveria estar". */
function makeRing(cls) {
    const area = new St.DrawingArea({style_class: `cu-ring ${cls}`, x_expand: true, y_expand: true});
    area.cu = {frac: 0, tick: null, empty: false};
    area.connect('repaint', a => {
        const cr = a.get_context();
        const [w, h] = a.get_surface_size();
        const node = a.get_theme_node();
        const lw = Math.max(2, Math.min(w, h) * 0.13);
        const r = Math.min(w, h) / 2 - lw / 2 - 1;
        const cx = w / 2, cy = h / 2;
        cr.setLineWidth(lw);
        setColor(cr, node.get_color('-cu-track'));
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.stroke();
        if (!a.cu.empty && a.cu.frac > 0) {
            setColor(cr, node.get_color('-cu-arc'));
            cr.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, a.cu.frac));
            cr.stroke();
        }
        if (a.cu.tick !== null && w > 40) {
            const ang = -Math.PI / 2 + 2 * Math.PI * a.cu.tick;
            setColor(cr, node.get_color('-cu-tick'));
            cr.setLineWidth(2);
            cr.moveTo(cx + (r - lw / 2 - 1) * Math.cos(ang), cy + (r - lw / 2 - 1) * Math.sin(ang));
            cr.lineTo(cx + (r + lw / 2 + 1) * Math.cos(ang), cy + (r + lw / 2 + 1) * Math.sin(ang));
            cr.stroke();
        }
        cr.$dispose();
    });
    return area;
}

/** Gráfico de linhas do consumo acumulado por modelo + total (tracejado). */
function makeCumChart(slots, kind) {
    const area = new St.DrawingArea({style_class: 'cu-chart', x_expand: true});
    const cum = L.cumulative(slots);
    area.connect('repaint', a => {
        const cr = a.get_context();
        const [w, h] = a.get_surface_size();
        const node = a.get_theme_node();
        const pl = 30, pr = 8, pt = 8, pb = 16, n = slots.length;
        const X = i => pl + (w - pl - pr) * (n > 1 ? i / (n - 1) : 0);
        const mx = cum.max || 1;
        const Y = v => pt + (h - pt - pb) * (1 - v / mx);
        cr.setFontSize(9);
        setColor(cr, node.get_color('-cu-grid'));
        cr.setLineWidth(1);
        cr.moveTo(pl, Y(0));
        cr.lineTo(w - pr, Y(0));
        cr.stroke();
        setColor(cr, node.get_color('-cu-label'));
        cr.moveTo(0, pt + 7);
        cr.showText(L.fmtTokens(cum.max));
        cr.moveTo(0, Y(0) + 3);
        cr.showText('0');
        slots.forEach((s, i) => {
            const lab = kind === 'week' ? L.slotLabel(s, 'week').split(' ')[0] : (i % 2 === 0 ? L.slotLabel(s, 'session') : '');
            if (!lab)
                return;
            cr.moveTo(X(i) - 8, h - 3);
            cr.showText(lab);
        });
        const colors = {S: '-cu-s', H: '-cu-h', O: '-cu-o', T: '-cu-t'};
        for (const k of ['T', 'S', 'H', 'O']) {
            const pts = cum.series[k];
            if (!pts.length || (k !== 'T' && pts[pts.length - 1][1] === 0))
                continue;
            setColor(cr, node.get_color(colors[k]));
            cr.setLineWidth(k === 'T' ? 1.2 : 2);
            cr.setDash(k === 'T' ? [3, 3] : [], 0);
            pts.forEach(([i, v], j) => (j === 0 ? cr.moveTo(X(i), Y(v)) : cr.lineTo(X(i), Y(v))));
            cr.stroke();
            cr.setDash([], 0);
            const [li, lv] = pts[pts.length - 1];
            cr.arc(X(li), Y(lv), 2.6, 0, 2 * Math.PI);
            cr.fill();
        }
        cr.$dispose();
    });
    return area;
}

/** Barra de duas partes (Claude Code | OpenBot) ou de uma parte (agente). */
function makeBar(parts, max, ob = 0, fixed = false) {
    const area = new St.DrawingArea({style_class: fixed ? 'cu-mbar cu-mbar-fixed' : 'cu-mbar', x_expand: !fixed});
    area.connect('repaint', a => {
        const cr = a.get_context();
        const [w, h] = a.get_surface_size();
        const node = a.get_theme_node();
        const r = h / 2;
        const pill = (x, wd, color) => {
            if (wd <= 0)
                return;
            setColor(cr, color);
            cr.newSubPath();
            cr.arc(x + r, r, r, Math.PI / 2, 3 * Math.PI / 2);
            cr.arc(x + Math.max(wd, 2 * r) - r, r, r, -Math.PI / 2, Math.PI / 2);
            cr.closePath();
            cr.fill();
        };
        pill(0, w, node.get_color('-cu-track'));
        const a1 = max ? (parts / max) * w : 0, a2 = max ? (ob / max) * w : 0;
        pill(0, a1, node.get_color('-cu-cc'));
        if (a2 > 0) {
            cr.save();
            cr.rectangle(a1, 0, a2, h);
            cr.clip();
            pill(a1 - r, a2 + r, node.get_color('-cu-ob'));
            cr.restore();
        }
        cr.$dispose();
    });
    return area;
}

function makeDonut(items) {
    const area = new St.DrawingArea({style_class: 'cu-donut'});
    area.connect('repaint', a => {
        const cr = a.get_context();
        const [w, h] = a.get_surface_size();
        const node = a.get_theme_node();
        const total = items.reduce((s, i) => s + i.tokens, 0) || 1;
        const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 1;
        let ang = -Math.PI / 2;
        items.forEach((it, i) => {
            const sweep = 2 * Math.PI * it.tokens / total;
            setColor(cr, node.get_color(`-cu-a${Math.min(i, 5)}`));
            cr.moveTo(cx, cy);
            cr.arc(cx, cy, R, ang, ang + sweep);
            cr.closePath();
            cr.fill();
            ang += sweep;
        });
        setColor(cr, node.get_color('-cu-hole'));
        cr.arc(cx, cy, R * 0.66, 0, 2 * Math.PI);
        cr.fill();
        setColor(cr, node.get_color('-cu-label-strong'));
        cr.setFontSize(10);
        const txt = L.fmtTokens(total);
        const ext = cr.textExtents(txt);
        cr.moveTo(cx - ext.width / 2 - ext.xBearing, cy + 3);
        cr.showText(txt);
        cr.$dispose();
    });
    return area;
}

function label(text, cls, props = {}) {
    const l = new St.Label({text, style_class: cls, y_align: Clutter.ActorAlign.CENTER, ...props});
    return l;
}

/** Texto de dica: sempre com quebra de linha (nunca cortado com reticências). */
function hint(text) {
    const l = label(text, 'cu-hint');
    l.clutter_text.set_line_wrap(true);
    return l;
}

function dot(cls) {
    return new St.Widget({style_class: `cu-dot ${cls}`, y_align: Clutter.ActorAlign.CENTER});
}

// ---------------------------------------------------------------------------
// Indicador
// ---------------------------------------------------------------------------
const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Claude Usage', false);
        this._ext = ext;
        this._settings = ext.getSettings();
        this._data = null;
        this._destroyed = false;
        this._cancel = new Gio.Cancellable();
        this._timer = 0;
        this._cdTimer = 0;

        this._buildPanel();
        this._buildMenu();

        const keys = ['refresh-interval', 'show-icon', 'label-format', 'value-mode', 'show-reset', 'show-pace',
            'models-visible', 'models-mode', 'models-window', 'agents-visible', 'agents-mode', 'warn-at', 'crit-at'];
        const args = [];
        for (const k of keys) {
            args.push(`changed::${k}`, k === 'refresh-interval' ? () => this._restartTimer() : () => this._render());
        }
        this._settings.connectObject(...args, this);

        this._tick();
        this._restartTimer();
    }

    // ------------------------------------------------------------------ painel
    _buildPanel() {
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box cu-panel'});
        this._panelIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._ext.path, 'icons', 'claude-symbolic.svg'])),
            style_class: 'system-status-icon',
        });
        box.add_child(this._panelIcon);

        // formato novo: anéis + valor + tempo
        this._ringsBox = new St.BoxLayout({style_class: 'cu-bar-rings', y_align: Clutter.ActorAlign.CENTER});
        this._barRings = [];
        for (let i = 0; i < 2; i++) {
            if (i === 1)
                this._ringsBox.add_child(new St.Widget({style_class: 'cu-bar-sep', y_align: Clutter.ActorAlign.CENTER}));
            const g = new St.BoxLayout({style_class: 'cu-bar-group', y_align: Clutter.ActorAlign.CENTER});
            const ring = makeRing('cu-bar-ring');
            ring.x_expand = false;
            ring.y_expand = false;
            ring.y_align = Clutter.ActorAlign.CENTER;
            const val = label('—', 'cu-bar-val');
            const tri = label('▲', 'cu-bar-tri');
            const time = label('', 'cu-bar-time');
            g.add_child(ring);
            g.add_child(val);
            g.add_child(tri);
            g.add_child(time);
            this._ringsBox.add_child(g);
            this._barRings.push({ring, val, tri, time});
        }
        box.add_child(this._ringsBox);

        // formatos antigos (completo, só porcentagem, barras)
        this._panelLabel = label('…', 'cu-panel-label');
        box.add_child(this._panelLabel);
        this.add_child(box);
    }

    // ------------------------------------------------------------------ popup
    _buildMenu() {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'cu-item'});
        this._root = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'cu-root'});
        item.add_child(this._root);
        this.menu.addMenuItem(item);

        // cabeçalho
        const head = new St.BoxLayout({style_class: 'cu-head'});
        const av = new St.Bin({style_class: 'cu-avatar', y_align: Clutter.ActorAlign.CENTER, child: new St.Icon({
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._ext.path, 'icons', 'claude-symbolic.svg'])),
            style_class: 'cu-avatar-icon',
        })});
        const titles = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'cu-titles'});
        titles.add_child(label('Claude', 'cu-title'));
        this._ago = label('', 'cu-sub');
        titles.add_child(this._ago);
        this._plan = label('', 'cu-pill');
        head.add_child(av);
        head.add_child(titles);
        head.add_child(this._plan);
        this._root.add_child(head);

        // estado (login/expirado/indisponível)
        this._status = label('', 'cu-status');
        this._status.clutter_text.set_line_wrap(true);
        this._status.visible = false;
        this._root.add_child(this._status);

        // anéis
        const rings = new St.BoxLayout({style_class: 'cu-rings', x_expand: true});
        this._cards = [this._makeCard(_('Sessão · 5 h')), this._makeCard(_('Semana'))];
        for (const c of this._cards)
            rings.add_child(c.box);
        this._root.add_child(rings);
        this._paceHint = label('', 'cu-hint');
        this._paceHint.clutter_text.set_line_wrap(true);
        this._root.add_child(this._paceHint);

        // blocos dinâmicos
        this._modelsBlock = this._makeSection(_('Consumo por modelo'));
        this._agentsBlock = this._makeSection(_('Agentes do OpenBot'));
        this._root.add_child(this._modelsBlock.box);
        this._root.add_child(this._agentsBlock.box);

        // rodapé
        const foot = new St.BoxLayout({style_class: 'cu-foot'});
        for (const [text, fn] of [[_('Atualizar agora'), () => this._tick(true)],
            [_('Preferências'), () => { this.menu.close(); this._ext.openPreferences(); }]]) {
            const b = new St.Button({label: text, can_focus: true, x_expand: true, style_class: 'cu-btn'});
            b.connect('clicked', fn);
            foot.add_child(b);
        }
        this._root.add_child(foot);
    }

    _makeCard(title) {
        const box = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'cu-card cu-off'});
        const t = label(title, 'cu-card-title', {x_align: Clutter.ActorAlign.CENTER});
        const wrap = new St.Widget({style_class: 'cu-gauge', layout_manager: new Clutter.BinLayout(), x_align: Clutter.ActorAlign.CENTER});
        const ring = makeRing('cu-gauge-ring');
        const center = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const val = label('—', 'cu-gauge-val', {x_align: Clutter.ActorAlign.CENTER});
        const cap = label('', 'cu-gauge-cap', {x_align: Clutter.ActorAlign.CENTER});
        center.add_child(val);
        center.add_child(cap);
        wrap.add_child(ring);
        wrap.add_child(center);
        const reset = label('', 'cu-card-reset', {x_align: Clutter.ActorAlign.CENTER});
        const chip = label('', 'cu-chip', {x_align: Clutter.ActorAlign.CENTER});
        box.add_child(t);
        box.add_child(wrap);
        box.add_child(reset);
        box.add_child(chip);
        return {box, ring, val, cap, reset, chip};
    }

    _makeSection(title) {
        const box = new St.BoxLayout({vertical: true, style_class: 'cu-section'});
        const head = new St.BoxLayout({style_class: 'cu-section-head'});
        head.add_child(label(title, 'cu-section-title', {x_expand: true}));
        const note = label('', 'cu-section-note');
        head.add_child(note);
        const body = new St.BoxLayout({vertical: true, style_class: 'cu-section-body'});
        box.add_child(head);
        box.add_child(body);
        return {box, note, body};
    }

    // ------------------------------------------------------------------ dados
    _restartTimer() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        const iv = Math.max(15, this._settings.get_int('refresh-interval'));
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, iv, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        if (!this._cdTimer) {
            // só reescreve os textos de contagem (sem I/O)
            this._cdTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                if (this._data)
                    this._render();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _tick(force = false) {
        const script = GLib.build_filenamev([this._ext.path, 'claude-usage-tracker.py']);
        const argv = ['python3', script];
        if (force)
            argv.push('--force');
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE)
                .wait_async(this._cancel, () => {
                    if (!this._destroyed)
                        this._loadData();
                });
        } catch (_e) {
            this._loadData();
        }
    }

    _loadData() {
        if (this._destroyed)
            return;
        Gio.File.new_for_path(USAGE_FILE).load_contents_async(this._cancel, (f, res) => {
            if (this._destroyed)
                return;
            try {
                const [ok, raw] = f.load_contents_finish(res);
                if (ok) {
                    this._data = JSON.parse(new TextDecoder().decode(raw));
                    this._render();
                }
            } catch (_e) {
                if (!this._destroyed)
                    this._panelLabel.text = '—';
            }
        });
    }

    _cfg() {
        const s = this._settings;
        const fmt = s.get_string('label-format');
        return {
            valueMode: s.get_string('value-mode'),
            format: fmt === 'pct-only' ? 'compact' : fmt,
            showReset: s.get_boolean('show-reset'),
            showPace: s.get_boolean('show-pace'),
            warnAt: s.get_int('warn-at'),
            critAt: s.get_int('crit-at'),
            modelsVisible: s.get_boolean('models-visible'),
            modelsMode: s.get_string('models-mode'),
            modelsWindow: s.get_string('models-window'),
            agentsVisible: s.get_boolean('agents-visible'),
            agentsMode: s.get_string('agents-mode'),
        };
    }

    // ------------------------------------------------------------------ desenho
    _render() {
        const d = this._data;
        if (!d || this._destroyed)
            return;
        const cfg = this._cfg();
        const nowMs = Date.now();
        const session = d.session ?? {}, week = d.week ?? {};

        this._panelIcon.visible = this._settings.get_boolean('show-icon');
        this._plan.text = L.planLabel(d.plan).toUpperCase();
        const gen = d.generated_at ? new Date(d.generated_at).getTime() : 0;
        this._ago.text = (d.stale ? '⏳ ' : '') + L.agoLabel(gen, nowMs);

        let status = '';
        if (!d.has_credentials)
            status = _('Faça login no Claude Code para ver o uso.');
        else if (d.token_expired)
            status = _('Sessão expirada — reabra o Claude Code.');
        else if (!d.api_source)
            status = _('Uso indisponível no momento.');
        this._status.visible = status !== '';
        this._status.text = status;

        const levels = [L.level(session.pct, cfg.warnAt, cfg.critAt, session.severity),
            L.level(week.pct, cfg.warnAt, cfg.critAt, week.severity)];

        this._renderBar(cfg, session, week, nowMs, levels);
        this._renderCards(cfg, [session, week], [L.SESSION_SEC, L.WEEK_SEC], nowMs, levels);
        this._renderModels(cfg, d.consumption);
        this._renderAgents(cfg, d.consumption);
    }

    _renderBar(cfg, session, week, nowMs, levels) {
        const rings = cfg.format === 'rings';
        this._ringsBox.visible = rings;
        this._panelLabel.visible = !rings;
        if (rings) {
            const info = L.barRings({session, week, cfg, nowMs});
            info.forEach((r, i) => {
                const w = this._barRings[i];
                if (r.empty) {
                    w.val.text = '—';
                    w.tri.visible = false;
                    w.time.text = '';
                    w.ring.cu.empty = true;
                    w.ring.style_class = 'cu-ring cu-bar-ring cu-off';
                } else {
                    w.val.text = `${r.value}%`;
                    w.val.style_class = `cu-bar-val cu-${r.level}`;
                    w.tri.visible = r.alert;
                    w.time.text = r.reset;
                    w.time.visible = r.reset !== '';
                    w.ring.cu.empty = false;
                    w.ring.cu.frac = r.ringFrac;
                    w.ring.style_class = `cu-ring cu-bar-ring cu-${r.level}`;
                }
                w.ring.queue_repaint();
            });
        } else {
            this._panelLabel.text = L.legacyBar({session, week, cfg, nowMs});
            this._panelLabel.style_class = `cu-panel-label cu-${L.worstLevel(levels)}`;
        }
    }

    _renderCards(cfg, wins, windowSecs, nowMs, levels) {
        wins.forEach((w, i) => {
            const c = this._cards[i];
            if (w.pct === null || w.pct === undefined) {
                c.box.style_class = 'cu-card cu-off';
                c.val.text = '—';
                c.cap.text = '';
                c.reset.text = '';
                c.chip.text = '';
                c.ring.cu.empty = true;
                c.ring.cu.tick = null;
                c.ring.queue_repaint();
                return;
            }
            const used = cfg.valueMode === 'used';
            const resetMs = w.reset_at ? new Date(w.reset_at).getTime() : 0;
            const p = L.pace({usedPct: w.pct, resetAtMs: resetMs, windowSec: windowSecs[i], nowMs});
            c.box.style_class = `cu-card cu-${levels[i]}`;
            c.val.text = `${L.shown(w.pct, cfg.valueMode)}%`;
            c.cap.text = used ? _('USADO') : _('RESTAM');
            c.reset.text = resetMs ? _('reinicia em %s').format(L.countdown((resetMs - nowMs) / 1000)) : '';
            c.chip.text = cfg.showPace && L.paceAlert(p) ? L.paceText(p) : '';
            c.chip.visible = c.chip.text !== '';
            c.ring.cu.empty = false;
            c.ring.cu.frac = used ? w.pct / 100 : (100 - w.pct) / 100;
            c.ring.cu.tick = p ? (used ? p.expectedUsed : 100 - p.expectedUsed) / 100 : null;
            c.ring.queue_repaint();
        });
        const hints = [];
        wins.forEach((w, i) => {
            const p = w.pct == null ? null : L.pace({usedPct: w.pct, resetAtMs: w.reset_at ? new Date(w.reset_at).getTime() : 0,
                windowSec: windowSecs[i], nowMs});
            if (cfg.showPace && L.paceAlert(p) && p.emptyInSec)
                hints.push(`${i === 0 ? _('Sessão') : _('Semana')}: ${_('acaba em ≈ %s').format(L.countdown(p.emptyInSec))}`);
        });
        this._paceHint.text = hints.length
            ? `${_('Traço branco = onde deveria estar.')} ${hints.join(' · ')} (${_('estimativa')})`
            : _('Traço branco = onde deveria estar.');
    }

    _renderModels(cfg, cons) {
        const sec = this._modelsBlock;
        sec.box.visible = cfg.modelsVisible;
        if (!cfg.modelsVisible)
            return;
        sec.body.destroy_all_children();
        const win = cfg.modelsWindow === 'session' ? 'session' : 'week';
        sec.note.text = win === 'week' ? _('semana') : _('sessão');
        if (!cons?.[win]) {
            sec.body.add_child(hint(_('Sem dados de consumo ainda.')));
            return;
        }
        if (cfg.modelsMode === 'list') {
            const mr = L.modelRows(cons.models?.[win]);
            for (const r of mr.rows) {
                const row = new St.BoxLayout({style_class: 'cu-row'});
                row.add_child(label(r.name, 'cu-row-name'));
                const bar = makeBar(r.cc, mr.max, r.ob);
                row.add_child(bar);
                row.add_child(label(L.fmtTokens(r.total), 'cu-row-val'));
                sec.body.add_child(row);
            }
            const legend = new St.BoxLayout({style_class: 'cu-legend'});
            for (const [cls, text] of [['cu-dot-cc', 'Claude Code'], ['cu-dot-ob', 'OpenBot']]) {
                legend.add_child(dot(cls));
                legend.add_child(label(text, 'cu-legend-text'));
            }
            sec.body.add_child(legend);
            sec.body.add_child(hint(`Claude Code ${Math.round(mr.ccShare * 100)}% · OpenBot ${Math.round(mr.obShare * 100)}%`));
        } else {
            sec.body.add_child(makeCumChart(cons[win].slots, win));
            const legend = new St.BoxLayout({style_class: 'cu-legend'});
            for (const [cls, text] of [['cu-dot-s', 'Sonnet'], ['cu-dot-h', 'Haiku'], ['cu-dot-o', 'Opus'], ['cu-dot-t', _('total')]]) {
                legend.add_child(dot(cls));
                legend.add_child(label(text, 'cu-legend-text'));
            }
            sec.body.add_child(legend);
            sec.body.add_child(hint(_('Soma acumulada desde o início da janela, até agora.')));
        }
        const ex = Object.entries(cons.excluded ?? {});
        if (ex.length)
            sec.body.add_child(hint(_('%s fica fora da cota do Claude (não entra no gráfico).').format(ex.map(([m]) => m).join(', '))));
        sec.body.add_child(hint(_('Tokens novos (sem leitura de cache). Mostra onde foi o uso, não a % exata da cota.')));
    }

    _renderAgents(cfg, cons) {
        const sec = this._agentsBlock;
        const agents = cons?.agents ?? [];
        sec.box.visible = cfg.agentsVisible && agents.length > 0;
        if (!sec.box.visible)
            return;
        sec.body.destroy_all_children();
        sec.note.text = _('tokens novos');
        const v = L.agentsView(agents, 4);
        if (cfg.agentsMode === 'donut') {
            const row = new St.BoxLayout({style_class: 'cu-donut-row'});
            row.add_child(makeDonut(v.donut));
            const legend = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'cu-donut-legend'});
            v.donut.forEach((a, i) => {
                const li = new St.BoxLayout({style_class: 'cu-row'});
                li.add_child(dot(`cu-dot-a${Math.min(i, 5)}`));
                li.add_child(label(a.name, 'cu-row-name cu-ellipsis', {x_expand: true}));
                li.add_child(label(`${Math.round(a.tokens / (v.total || 1) * 100)}%`, 'cu-row-val'));
                legend.add_child(li);
            });
            row.add_child(legend);
            sec.body.add_child(row);
        } else {
            for (const a of v.top) {
                const row = new St.BoxLayout({style_class: 'cu-row'});
                row.add_child(label(a.name, 'cu-row-name cu-ellipsis', {x_expand: true}));
                row.add_child(makeBar(a.tokens, v.max, 0, true));
                row.add_child(label(`${L.fmtTokens(a.tokens)} · ${a.turns} t`, 'cu-row-val cu-row-val-wide'));
                sec.body.add_child(row);
            }
        }
        sec.body.add_child(hint(_('Desde o início da semana. O Claude Code está no bloco por modelo.')));
    }

    destroy() {
        this._destroyed = true;
        this._cancel.cancel();
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        if (this._cdTimer) {
            GLib.source_remove(this._cdTimer);
            this._cdTimer = 0;
        }
        this._settings.disconnectObject(this);
        super.destroy();
    }
});

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._posHandler = this._settings.connect('changed::panel-position', () => this._reposition());
        this._create();
    }

    _create() {
        this._indicator = new ClaudeIndicator(this);
        switch (this._settings.get_string('panel-position')) {
        case 'left':
            Main.panel.addToStatusArea(this.uuid, this._indicator, -1, 'left');
            break;
        case 'left-edge':
            Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'left');
            break;
        default:
            Main.panel.addToStatusArea(this.uuid, this._indicator);
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
