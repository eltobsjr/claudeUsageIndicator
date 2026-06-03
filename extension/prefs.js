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

        // modo do painel
        const modes = [
            ['session-tokens', _('Sessão · tokens')],
            ['session-pct', _('Sessão · porcentagem')],
            ['week-pct', _('Semana · porcentagem')],
            ['session-cost', _('Sessão · custo ($)')],
            ['today-cost', _('Hoje · custo ($)')],
            ['session-reset', _('Sessão · tempo até reset')],
        ];
        const modeRow = new Adw.ComboRow({
            title: _('Conteúdo do painel'),
            subtitle: _('Informação principal exibida na barra'),
            model: Gtk.StringList.new(modes.map(m => m[1])),
        });
        const current = settings.get_string('panel-mode');
        modeRow.selected = Math.max(0, modes.findIndex(m => m[0] === current));
        modeRow.connect('notify::selected', () => {
            settings.set_string('panel-mode', modes[modeRow.selected][0]);
        });
        panelGroup.add(modeRow);

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

        // =================== Página: Limites do plano ===================
        const limitsPage = new Adw.PreferencesPage({
            title: _('Limites'),
            icon_name: 'speedometer-symbolic',
        });
        window.add(limitsPage);

        const infoGroup = new Adw.PreferencesGroup({
            description: _('A Anthropic não publica os limites exatos em tokens. ' +
                'Informe valores aproximados do seu plano para ver a porcentagem de uso. ' +
                'Deixe em 0 para mostrar apenas tokens e custo.'),
        });
        limitsPage.add(infoGroup);

        const limitGroup = new Adw.PreferencesGroup({ title: _('Limites de tokens') });
        limitsPage.add(limitGroup);

        const sessionLimit = new Adw.SpinRow({
            title: _('Limite da sessão (5h)'),
            subtitle: _('Tokens por janela rolante de 5 horas'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 2000000000, step_increment: 100000, page_increment: 1000000 }),
        });
        settings.bind('session-token-limit', sessionLimit, 'value', Gio.SettingsBindFlags.DEFAULT);
        limitGroup.add(sessionLimit);

        const dailyLimit = new Adw.SpinRow({
            title: _('Limite diário'),
            subtitle: _('Tokens por dia (desde a meia-noite). 0 = não exibir %'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 2000000000, step_increment: 100000, page_increment: 1000000 }),
        });
        settings.bind('daily-token-limit', dailyLimit, 'value', Gio.SettingsBindFlags.DEFAULT);
        limitGroup.add(dailyLimit);

        const weekLimit = new Adw.SpinRow({
            title: _('Limite semanal'),
            subtitle: _('Tokens por semana'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 2000000000, step_increment: 1000000, page_increment: 10000000 }),
        });
        settings.bind('weekly-token-limit', weekLimit, 'value', Gio.SettingsBindFlags.DEFAULT);
        limitGroup.add(weekLimit);

        // reset semanal
        const resetGroup = new Adw.PreferencesGroup({
            title: _('Reset semanal'),
            description: _('Quando sua semana de uso reinicia'),
        });
        limitsPage.add(resetGroup);

        const days = [_('Segunda'), _('Terça'), _('Quarta'), _('Quinta'),
                      _('Sexta'), _('Sábado'), _('Domingo')];
        const dayRow = new Adw.ComboRow({
            title: _('Dia do reset'),
            model: Gtk.StringList.new(days),
        });
        dayRow.selected = settings.get_int('weekly-reset-weekday');
        dayRow.connect('notify::selected', () => {
            settings.set_int('weekly-reset-weekday', dayRow.selected);
        });
        resetGroup.add(dayRow);

        const hourRow = new Adw.SpinRow({
            title: _('Hora do reset'),
            subtitle: _('Hora local (0–23)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 23, step_increment: 1, page_increment: 1 }),
        });
        settings.bind('weekly-reset-hour', hourRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        resetGroup.add(hourRow);

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
