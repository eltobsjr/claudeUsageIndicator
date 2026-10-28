#!/usr/bin/env python3
"""Assistente de instalação das extensões Eltob Indicator: escolhe tema e opções no terminal.

  ask    pergunta (ou lê o que foi salvo) e grava as respostas num JSON
  apply  gera o stylesheet.css do tema escolhido e grava as opções no GSettings
  render gera um stylesheet.css sem perguntar (usado por `make pack` e `make check`)
  list   mostra paletas e cores de destaque

Só usa a biblioteca padrão do Python 3. Sem terminal interativo (ou com --yes) usa o
tema salvo ou o padrão e não altera nenhuma opção.
"""
import argparse, json, os, re, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / 'palettes.json').read_text())
CONF_DIR = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'eltob-indicators'

# ---------------------------------------------------------------- tema

def hex_rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def rgb_hex(c): return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)
def mix(a, b, t): return rgb_hex([x + (y - x) * t for x, y in zip(hex_rgb(a), hex_rgb(b))])

def swatch(h): r, g, b = hex_rgb(h); return f'\x1b[48;2;{r};{g};{b}m  \x1b[0m'

def theme_values(theme):
    colors = dict(DATA['palettes'][theme['palette']]['colors'])
    accent = colors[theme['accent']]
    vals = dict(colors, accent=accent, accent_ink=colors['base'], accent_press=mix(accent, colors['base'], .18),
                ok=colors['green'], warn=colors['yellow'], crit=colors['red'], off=colors['overlay1'])
    rgb = {k: ', '.join(map(str, hex_rgb(v))) for k, v in vals.items()}
    out = dict(vals)
    if theme.get('follow_system_accent'):  # GNOME 47+: o Shell resolve a cor do acento do sistema
        out.update(accent='-st-accent-color', accent_ink='-st-accent-fg-color', accent_press='-st-accent-color')
    geo = DATA['geometry']
    out.update({f'radius.{k}': v for k, v in geo['radius'].items()}, menu_width=geo['menu_width'])
    return out, rgb

def render_css(template, theme, title):
    vals, rgb = theme_values(theme)
    def sub(m):
        key = m.group(1)
        if key.endswith('.rgb'): return rgb[key[:-4]]
        if key not in vals: raise SystemExit(f'token desconhecido no template: {{{{{key}}}}}')
        return str(vals[key])
    body = re.sub(r'\{\{([\w.]+)\}\}', sub, template)
    mode = 'acento do sistema' if theme.get('follow_system_accent') else theme['accent']
    head = (f"/* {title} — gerado pelo instalador (eltob-setup.py).\n"
            f"   Paleta: {DATA['palettes'][theme['palette']]['label']} · destaque: {mode}.\n"
            f"   Não edite as cores aqui: rode ./install.sh --reconfigure. */\n\n")
    return head + body

def saved_theme(uuid):
    try:
        t = json.loads((CONF_DIR / f'{uuid}.json').read_text())
        if t.get('palette') in DATA['palettes'] and (t.get('accent') in DATA['accents']):
            return t
    except (OSError, ValueError):
        pass
    return None

def save_theme(uuid, theme):
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    (CONF_DIR / f'{uuid}.json').write_text(json.dumps(theme, indent=1))

# ---------------------------------------------------------------- perguntas

class Ui:
    def __init__(self, interactive): self.on = interactive
    def say(self, text=''): print(text)
    def pick(self, title, items, default, note=None):
        """items: [(valor, rótulo, dica)] -> valor escolhido."""
        if not self.on: return default
        self.say(f'\n\x1b[1m{title}\x1b[0m' + (f'  \x1b[2m{note}\x1b[0m' if note else ''))
        di = next((i for i, it in enumerate(items) if it[0] == default), 0)
        for i, (_, label, hint) in enumerate(items, 1):
            mark = '›' if i - 1 == di else ' '
            self.say(f' {mark} {i:>2}) {label}' + (f'  \x1b[2m{hint}\x1b[0m' if hint else ''))
        while True:
            raw = input(f'   Escolha [1-{len(items)}] (Enter = {di + 1}): ').strip()
            if not raw: return items[di][0]
            if raw.isdigit() and 1 <= int(raw) <= len(items): return items[int(raw) - 1][0]
            self.say('   Número inválido.')
    def yesno(self, title, default):
        if not self.on: return default
        d = 'S/n' if default else 's/N'
        while True:
            raw = input(f'\n\x1b[1m{title}\x1b[0m [{d}]: ').strip().lower()
            if not raw: return default
            if raw in ('s', 'sim', 'y', 'yes'): return True
            if raw in ('n', 'nao', 'não', 'no'): return False
    def text(self, title, default, check=None):
        if not self.on: return default
        while True:
            raw = input(f'\n\x1b[1m{title}\x1b[0m [{default}]: ').strip()
            val = raw or default
            if check is None or check(val): return val
            self.say('   Valor inválido.')

def gs(schemadir, *args):
    return subprocess.run(['gsettings', '--schemadir', str(schemadir), *args], capture_output=True, text=True)

def gs_value(raw, kind):
    raw = raw.strip()
    if kind == 'bool': return raw == 'true'
    if kind == 'int': return int(raw.split()[-1])
    if kind == 'enum': return raw.strip("'")
    if kind == 'strv': return re.findall(r"'([^']*)'", raw)
    return raw.strip("'")

def to_gs(value, kind):
    if kind == 'bool': return 'true' if value else 'false'
    if kind == 'int': return str(int(value))
    if kind == 'strv': return '[' + ', '.join("'%s'" % v for v in value) + ']'
    return "'%s'" % value

def cmd_ask(a):
    options = json.loads(Path(a.options).read_text()) if a.options and Path(a.options).exists() else {'settings': [], 'extras': []}
    interactive = sys.stdin.isatty() and sys.stdout.isatty() and not a.yes and os.environ.get('ELTOB_YES') != '1'
    ui = Ui(interactive)
    title = options.get('title', a.uuid)
    ui.say(f'\n\x1b[1m── {title} ──\x1b[0m')
    prior = saved_theme(a.uuid)
    ask_theme = interactive and (a.reconfigure or prior is None)
    theme = dict(prior or DATA['default'])
    if a.palette: theme['palette'] = a.palette
    if a.accent: theme['accent'] = a.accent
    if a.system_accent: theme['follow_system_accent'] = True
    if ask_theme and not (a.palette and a.accent):
        ui.say('\nTema: o visual é gerado agora a partir da paleta que você escolher.')
        theme['palette'] = ui.pick('Paleta', [(k, v['label'] + '  ' + ''.join(swatch(v['colors'][c]) for c in ('base', 'surface0', 'blue', 'green', 'yellow', 'red')), v['hint'])
                                              for k, v in DATA['palettes'].items()], theme['palette'])
        pal = DATA['palettes'][theme['palette']]['colors']
        items = [('system', 'Seguir o destaque do GNOME (47+)', 'muda junto com Ajustes › Aparência')]
        items += [(k, f'{label}  {swatch(pal[k])}', None) for k, label in DATA['accents'].items()]
        cur = 'system' if theme.get('follow_system_accent') else theme['accent']
        pick = ui.pick('Cor de destaque', items, cur)
        theme['follow_system_accent'] = pick == 'system'
        if pick != 'system': theme['accent'] = pick
    ui.say(f"\n  Tema: {DATA['palettes'][theme['palette']]['label']}, destaque "
           + ('do sistema' if theme.get('follow_system_accent') else DATA['accents'][theme['accent']]))

    settings, extras = {}, {}
    schema_id, sdir = options.get('schema'), a.schema_dir
    for q in options.get('extras', []):
        extras[q['key']] = ui.yesno(q['label'], q.get('default', True)) if interactive else q.get('default', True)
    if interactive and options.get('settings') and (a.reconfigure or prior is None):
        tmp = None
        if sdir and schema_id and not (Path(sdir) / 'gschemas.compiled').exists():
            tmp = tempfile.mkdtemp(); subprocess.run(['glib-compile-schemas', '--targetdir', tmp, sdir], check=False); sdir = tmp
        ui.say('\nOpções (Enter mantém o valor atual):')
        section = None
        for q in options['settings']:
            if q.get('section') and q['section'] != section:
                section = q['section']; ui.say(f'\n\x1b[1;34m{section}\x1b[0m')
            cur = None
            if schema_id and sdir:
                r = gs(sdir, 'get', schema_id, q['key'])
                if r.returncode == 0: cur = gs_value(r.stdout, q['type'])
            if cur is None: cur = q.get('default')
            kind = q['type']
            if kind == 'bool': val = ui.yesno(q['label'], bool(cur))
            elif kind == 'enum' or q.get('choices'):
                ch = [(c[0], c[1], None) for c in q['choices']]
                val = ui.pick(q['label'], ch, cur if cur in [c[0] for c in ch] else ch[0][0])
            elif kind == 'int':
                val = int(ui.text(q['label'] + (f" ({q['min']}–{q['max']})" if 'min' in q else ''), str(cur),
                                  lambda v: v.lstrip('-').isdigit() and q.get('min', -10**9) <= int(v) <= q.get('max', 10**9)))
            elif kind == 'strv':
                val = [s.strip() for s in ui.text(q['label'] + ' (separe por vírgula)', ', '.join(cur or []) or '', None).split(',') if s.strip()]
            else: val = ui.text(q['label'], str(cur or ''))
            if val != cur: settings[q['key']] = val
    Path(a.answers).write_text(json.dumps({'theme': theme, 'settings': settings, 'extras': extras, 'interactive': interactive}))
    return 0

def cmd_apply(a):
    ans = json.loads(Path(a.answers).read_text())
    dest = Path(a.dest)
    tpl = dest / 'stylesheet.tpl.css'
    if tpl.exists():
        (dest / 'stylesheet.css').write_text(render_css(tpl.read_text(), ans['theme'], a.title or a.uuid))
        tpl.unlink()
        print(f"  tema aplicado: {DATA['palettes'][ans['theme']['palette']]['label']}")
    save_theme(a.uuid, ans['theme'])
    schema_id = a.schema
    for key, val in ans['settings'].items():
        opt = next((q for q in json.loads(Path(a.options).read_text())['settings'] if q['key'] == key), None)
        r = gs(dest / 'schemas', 'set', schema_id, key, to_gs(val, opt['type'] if opt else 'str'))
        print(f"  {key} = {val}" + ('' if r.returncode == 0 else f"  (falhou: {r.stderr.strip()})"))
    return 0

def cmd_render(a):
    theme = {'palette': a.palette, 'accent': a.accent, 'follow_system_accent': a.system_accent}
    Path(a.out).write_text(render_css(Path(a.template).read_text(), theme, a.title or 'Extensão'))
    return 0

def cmd_extra(a):
    print('true' if json.loads(Path(a.answers).read_text())['extras'].get(a.key, True) else 'false')
    return 0

def cmd_list(_):
    for k, v in DATA['palettes'].items(): print(k, '-', v['label'])
    print('destaques:', ', '.join(DATA['accents']))
    return 0

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest='cmd', required=True)
    c = sp.add_parser('ask'); c.set_defaults(fn=cmd_ask)
    c.add_argument('--uuid', required=True); c.add_argument('--options'); c.add_argument('--schema-dir')
    c.add_argument('--answers', required=True); c.add_argument('--yes', action='store_true'); c.add_argument('--reconfigure', action='store_true')
    c.add_argument('--palette', choices=list(DATA['palettes'])); c.add_argument('--accent', choices=list(DATA['accents'])); c.add_argument('--system-accent', action='store_true')
    c = sp.add_parser('apply'); c.set_defaults(fn=cmd_apply)
    c.add_argument('--uuid', required=True); c.add_argument('--answers', required=True); c.add_argument('--dest', required=True)
    c.add_argument('--options'); c.add_argument('--schema'); c.add_argument('--title')
    c = sp.add_parser('render'); c.set_defaults(fn=cmd_render)
    c.add_argument('--template', required=True); c.add_argument('--out', required=True); c.add_argument('--title')
    c.add_argument('--palette', default=DATA['default']['palette'], choices=list(DATA['palettes']))
    c.add_argument('--accent', default=DATA['default']['accent'], choices=list(DATA['accents'])); c.add_argument('--system-accent', action='store_true')
    c = sp.add_parser('extra'); c.set_defaults(fn=cmd_extra); c.add_argument('--answers', required=True); c.add_argument('key')
    c = sp.add_parser('list'); c.set_defaults(fn=cmd_list)
    a = p.parse_args()
    try: return a.fn(a)
    except (KeyboardInterrupt, EOFError): print('\nCancelado.'); return 130

if __name__ == '__main__':
    sys.exit(main())
