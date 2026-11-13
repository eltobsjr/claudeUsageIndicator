import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {clampThresholds} from './logic.js';

// ComboRow ligado a uma chave enum do GSettings (opções: [[nick, rótulo], ...])
function comboRow(settings, key, title, options, subtitle = '') {
    const row = new Adw.ComboRow({title, subtitle, model: Gtk.StringList.new(options.map(o => o[1]))});
    row.selected = Math.max(0, options.findIndex(o => o[0] === settings.get_string(key)));
    row.connect('notify::selected', () => settings.set_string(key, options[row.selected][0]));
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export default class ClaudeUsagePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 720);

        // =================== Página: Exibição ===================
        const page = new Adw.PreferencesPage({
            title: _('Exibição'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        window.add(page);

        const panelGroup = new Adw.PreferencesGroup({
            title: _('Barra superior'),
            description: _('O que aparece no painel do GNOME'),
        });
        page.add(panelGroup);

        // formato do label
        const formatos = [
            ['rings',    _('Anéis — ◔ 86% 4h38 · ◔ 60% ▲ 4d21h')],
            ['full',     _('Completo — S 62% 1h52m · W 35% 5d')],
            ['pct-only', _('Só porcentagem — S 62% · W 35%')],
            ['spark',    _('Mini barras — ▓▓▓░░ 62% · ▓▓░░░ 35%')],
        ];
        const formatoRow = new Adw.ComboRow({
            title: _('Formato do label'),
            subtitle: _('Como o uso aparece na barra superior'),
            model: Gtk.StringList.new(formatos.map(f => f[1])),
        });
        const currentFormato = settings.get_string('label-format');
        formatoRow.selected = Math.max(0, formatos.findIndex(f => f[0] === currentFormato));
        formatoRow.connect('notify::selected', () => {
            settings.set_string('label-format', formatos[formatoRow.selected][0]);
        });
        panelGroup.add(formatoRow);
        panelGroup.add(comboRow(settings, 'value-mode', _('Mostrar valores como'),
            [['remaining', _('Restante (padrão, como no OpenBot)')], ['used', _('Usado')]],
            _('O anel esvazia quando mostra o restante e enche quando mostra o usado')));
        const resetRow = switchRow(settings, 'show-reset', _('Tempo até reiniciar na barra'),
            _('Só no formato anéis'));
        panelGroup.add(resetRow);
        panelGroup.add(switchRow(settings, 'show-pace', _('Aviso de ritmo (▲)'),
            _('Quando o consumo está acima de 1,2× e a projeção acaba antes do reset')));

        // mostrar ícone
        const iconRow = new Adw.SwitchRow({
            title: _('Mostrar ícone'),
            subtitle: _('Exibe o ícone do Claude na barra'),
        });
        settings.bind('show-icon', iconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(iconRow);

        // intervalo
        const intervalRow = new Adw.SpinRow({
            title: _('Intervalo de atualização'),
            subtitle: _('Frequência de leitura dos dados (segundos)'),
            adjustment: new Gtk.Adjustment({ lower: 15, upper: 600, step_increment: 5, page_increment: 30 }),
        });
        settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(intervalRow);

        // =================== Posição na barra (seletor visual) ===================
        const posGroup = new Adw.PreferencesGroup({
            title: _('Posição na barra'),
        });
        page.add(posGroup);

        // Migra configuração legada 'right-edge' → 'right'
        let currentPosicao = settings.get_string('panel-position');
        if (currentPosicao === 'right-edge') {
            currentPosicao = 'right';
            settings.set_string('panel-position', 'right');
        }

        // CSS para o badge de posição na mini-barra
        const posCSS = new Gtk.CssProvider();
        posCSS.load_from_string(
            '.cu-badge{background-color:alpha(@accent_bg_color,.9);color:@accent_fg_color;' +
            'border-radius:4px;padding:1px 7px;font-size:.78em;font-weight:bold;}'
        );
        Gtk.StyleContext.add_provider_for_display(
            window.get_display(), posCSS, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );

        const posRow = new Adw.PreferencesRow({ activatable: false, focusable: false });
        const posContainer = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 12,
            margin_bottom: 14,
            margin_start: 12,
            margin_end: 12,
        });
        posRow.set_child(posContainer);
        posGroup.add(posRow);

        // Mini barra de preview
        const miniBar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            css_classes: ['card'],
            height_request: 34,
            overflow: Gtk.Overflow.HIDDEN,
        });

        const barLeft = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            margin_start: 10,
            valign: Gtk.Align.CENTER,
        });
        const leftEdgeBadge = new Gtk.Label({
            label: 'Claude',
            css_classes: ['cu-badge'],
            visible: currentPosicao === 'left-edge',
        });
        barLeft.append(leftEdgeBadge);
        barLeft.append(new Gtk.Label({ label: 'Ativid.', css_classes: ['dim-label', 'caption'] }));
        const leftBadge = new Gtk.Label({
            label: 'Claude',
            css_classes: ['cu-badge'],
            visible: currentPosicao === 'left',
        });
        barLeft.append(leftBadge);
        miniBar.append(barLeft);

        const barCenter = new Gtk.Box({ hexpand: true, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER });
        barCenter.append(new Gtk.Label({ label: '12:00', css_classes: ['caption'] }));
        miniBar.append(barCenter);

        const barRight = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            margin_end: 10,
            valign: Gtk.Align.CENTER,
        });
        const rightBadge = new Gtk.Label({
            label: 'Claude',
            css_classes: ['cu-badge'],
            visible: currentPosicao === 'right',
        });
        barRight.append(rightBadge);
        barRight.append(new Gtk.Label({ label: '🔊 ◉ ◉ ☰', css_classes: ['dim-label', 'caption'] }));
        miniBar.append(barRight);

        posContainer.append(miniBar);

        const posBadges = { 'left-edge': leftEdgeBadge, 'left': leftBadge, 'right': rightBadge };
        const updatePosPreview = (pos) => {
            Object.entries(posBadges).forEach(([k, b]) => { b.visible = k === pos; });
        };

        // Botões de seleção estilo segmented control
        const posicoes = [
            { id: 'left-edge', label: _('Borda esquerda') },
            { id: 'left',      label: _('Esquerda') },
            { id: 'right',     label: _('Direita') },
        ];

        const btnBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            homogeneous: true,
            css_classes: ['linked'],
        });

        const toggleBtns = [];
        posicoes.forEach(p => {
            const btn = new Gtk.ToggleButton({ label: p.label, active: currentPosicao === p.id });
            if (currentPosicao === p.id) btn.add_css_class('suggested-action');
            btn.connect('toggled', () => {
                if (btn.active) {
                    toggleBtns.forEach(b => {
                        if (b !== btn) { b.active = false; b.remove_css_class('suggested-action'); }
                    });
                    btn.add_css_class('suggested-action');
                    settings.set_string('panel-position', p.id);
                    updatePosPreview(p.id);
                } else if (!toggleBtns.some(b => b.active)) {
                    btn.active = true;
                    btn.add_css_class('suggested-action');
                }
            });
            btnBox.append(btn);
            toggleBtns.push(btn);
        });

        posContainer.append(btnBox);

        // =================== Página: Consumo ===================
        const consPage = new Adw.PreferencesPage({
            title: _('Consumo'),
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(consPage);

        const modelsGroup = new Adw.PreferencesGroup({
            title: _('Consumo por modelo'),
            description: _('Tokens novos por modelo, somando o Claude Code e o OpenBot. Mostra onde foi o uso, não a % exata da cota.'),
        });
        consPage.add(modelsGroup);
        const mVis = switchRow(settings, 'models-visible', _('Mostrar no popup'));
        const mMode = comboRow(settings, 'models-mode', _('Modo'),
            [['list', _('Lista')], ['chart', _('Gráfico acumulado')]]);
        const mWin = comboRow(settings, 'models-window', _('Janela'),
            [['session', _('Sessão (5 h)')], ['week', _('Semana')]]);
        for (const r of [mVis, mMode, mWin])
            modelsGroup.add(r);
        for (const r of [mMode, mWin])
            settings.bind('models-visible', r, 'sensitive', Gio.SettingsBindFlags.GET);

        const agentsGroup = new Adw.PreferencesGroup({
            title: _('Agentes do OpenBot'),
            description: _('Quais agentes mais consomem tokens novos desde o início da semana.'),
        });
        consPage.add(agentsGroup);
        const aVis = switchRow(settings, 'agents-visible', _('Mostrar no popup'));
        const aMode = comboRow(settings, 'agents-mode', _('Modo'), [['list', _('Lista')], ['donut', _('Rosca')]]);
        agentsGroup.add(aVis);
        agentsGroup.add(aMode);
        settings.bind('agents-visible', aMode, 'sensitive', Gio.SettingsBindFlags.GET);

        // =================== Página: Alertas ===================
        const alertPage = new Adw.PreferencesPage({
            title: _('Alertas'),
            icon_name: 'dialog-warning-symbolic',
        });
        window.add(alertPage);
        const alertGroup = new Adw.PreferencesGroup({
            title: _('Quando o restante chega a'),
            description: _('O card e o anel mudam de cor: verde, amarelo (atenção) e vermelho (crítico).'),
        });
        alertPage.add(alertGroup);
        const mkSpin = (title, key) => new Adw.SpinRow({
            title,
            adjustment: new Gtk.Adjustment({lower: 5, upper: 95, step_increment: 5, page_increment: 10, value: settings.get_int(key)}),
        });
        const warnRow = mkSpin(_('Atenção (amarelo), %'), 'warn-at');
        const critRow = mkSpin(_('Crítico (vermelho), %'), 'crit-at');
        let busy = false;
        const apply = () => {
            if (busy)
                return;
            busy = true;
            const t = clampThresholds(warnRow.value, critRow.value);   // o crítico nunca passa do atenção
            settings.set_int('warn-at', t.warn);
            settings.set_int('crit-at', t.crit);
            warnRow.value = t.warn;
            critRow.value = t.crit;
            busy = false;
        };
        warnRow.connect('notify::value', apply);
        critRow.connect('notify::value', apply);
        alertGroup.add(warnRow);
        alertGroup.add(critRow);

        // =================== Página: Sobre ===================
        const aboutPage = new Adw.PreferencesPage({
            title: _('Sobre'),
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);
        const aboutGroup = new Adw.PreferencesGroup();
        aboutPage.add(aboutGroup);
        aboutGroup.add(new Adw.ActionRow({
            title: _('Dados em tempo real'),
            subtitle: _('Plano, % de uso e horários de reset vêm do claude.ai via as credenciais OAuth do Claude Code ' +
                '(~/.claude/.credentials.json). O consumo por modelo e por agente é calculado dos registros locais ' +
                'do Claude Code e do banco do OpenBot, só para leitura.'),
        }));
        aboutGroup.add(new Adw.ActionRow({
            title: _('Claude Usage Indicator'),
            subtitle: _('Uso do Claude Code em tempo real. Lê os percentuais direto do ' +
                'claude.ai via OAuth do Claude Code; nenhum token é consumido.'),
        }));
    }
}
