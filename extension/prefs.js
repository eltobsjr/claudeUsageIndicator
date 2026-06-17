import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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

        // tema de cores
        const temas = [
            ['auto',       _('Automático (acento do sistema)')],
            ['sistema',    _('Sistema — Fedora Navy (#163570)')],
            ['catppuccin', _('Catppuccin Macchiato')],
            ['verde',      _('Verde GNOME')],
            ['laranja',    _('Laranja Ubuntu')],
        ];
        const temaRow = new Adw.ComboRow({
            title: _('Tema de cores'),
            subtitle: _('Cor das barras de progresso e rótulos das seções'),
            model: Gtk.StringList.new(temas.map(t => t[1])),
        });
        const currentTema = settings.get_string('color-theme');
        temaRow.selected = Math.max(0, temas.findIndex(t => t[0] === currentTema));
        temaRow.connect('notify::selected', () => {
            settings.set_string('color-theme', temas[temaRow.selected][0]);
        });
        panelGroup.add(temaRow);

        // formato do label
        const formatos = [
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

        // =================== Página: Uso ===================
        const limitsPage = new Adw.PreferencesPage({
            title: _('Uso'),
            icon_name: 'speedometer-symbolic',
        });
        window.add(limitsPage);

        const infoGroup = new Adw.PreferencesGroup({
            title: _('Dados em tempo real'),
            description: _('Plano, % de uso e horários de reset são lidos diretamente do ' +
                'claude.ai via credenciais OAuth armazenadas em ~/.claude/.credentials.json. ' +
                'Não é necessário configurar nada manualmente.'),
        });
        limitsPage.add(infoGroup);

        // =================== Página: Sobre ===================
        const aboutPage = new Adw.PreferencesPage({
            title: _('Sobre'),
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);
        const aboutGroup = new Adw.PreferencesGroup();
        aboutPage.add(aboutGroup);
        aboutGroup.add(new Adw.ActionRow({
            title: _('Claude Usage Indicator'),
            subtitle: _('Uso do Claude Code em tempo real. Lê os percentuais direto do ' +
                'claude.ai via OAuth do Claude Code; nenhum token é consumido.'),
        }));
    }
}
