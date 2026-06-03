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
            ['full',     _('Completo — S 62% 1h52m · H 46% · W 35%')],
            ['pct-only', _('Só porcentagem — S 62% · H 46% · W 35%')],
            ['spark',    _('Mini barras — ▓▓▓░░ 62% · ▓▓░░░ 46% · ▓▓░░░ 35%')],
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

        // posição na barra
        const posicoes = [
            ['right',      _('Direita (padrão)')],
            ['right-edge', _('Direita — 1° da borda direita')],
            ['left',       _('Esquerda')],
            ['left-edge',  _('Esquerda — 1° da borda esquerda')],
        ];
        const posicaoRow = new Adw.ComboRow({
            title: _('Posição na barra'),
            subtitle: _('Onde o indicador aparece na barra superior'),
            model: Gtk.StringList.new(posicoes.map(p => p[1])),
        });
        const currentPosicao = settings.get_string('panel-position');
        posicaoRow.selected = Math.max(0, posicoes.findIndex(p => p[0] === currentPosicao));
        posicaoRow.connect('notify::selected', () => {
            settings.set_string('panel-position', posicoes[posicaoRow.selected][0]);
        });
        panelGroup.add(posicaoRow);

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
            adjustment: new Gtk.Adjustment({ lower: 10, upper: 600, step_increment: 5, page_increment: 30 }),
        });
        settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(intervalRow);

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
            subtitle: _('Uso do Claude Code em tempo real, 100% local. Nenhum dado sai da máquina e nenhum token é consumido.'),
        }));
    }
}
