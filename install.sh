#!/usr/bin/env bash
# Instalador do Claude Usage Indicator (extensão GNOME Shell)
set -euo pipefail

UUID="claude-usage@eltobsjr.gmail.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/extension"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

echo "==> Instalando Claude Usage Indicator"

# 1) checa dependências
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERRO: python3 não encontrado. Instale com: sudo dnf install python3" >&2
    exit 1
fi
if ! command -v glib-compile-schemas >/dev/null 2>&1; then
    echo "ERRO: glib-compile-schemas não encontrado. Instale glib2-devel / libglib2.0-bin." >&2
    exit 1
fi

# 2) copia arquivos
# 0) tema e opções: pergunta no terminal (use --yes para aceitar os padrões e
#    --reconfigure para perguntar de novo; também aceita --palette, --accent, --system-accent)
command -v python3 >/dev/null 2>&1 || { echo "ERRO: python3 não encontrado. Instale com: sudo dnf install python3" >&2; exit 1; }
SETUP="$ROOT/scripts/eltob-setup.py"
ANSWERS="$(mktemp)"
trap 'rm -f "$ANSWERS"' EXIT
python3 "$SETUP" ask --uuid "$UUID" --options "$ROOT/scripts/options.json" \
    --schema-dir "$ROOT/extension/schemas" --answers "$ANSWERS" "$@"

echo "==> Copiando para $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/." "$DEST/"

# 3) compila o schema
echo "==> Compilando GSettings schema"
glib-compile-schemas "$DEST/schemas"

echo "==> Aplicando tema e opções"
python3 "$SETUP" apply --uuid "$UUID" --answers "$ANSWERS" --dest "$DEST" \
    --options "$ROOT/scripts/options.json" --schema "org.gnome.shell.extensions.claude-usage" --title "Claude Usage Indicator"

# 4) torna o tracker executável
chmod +x "$DEST/claude-usage-tracker.py"

# 5) primeira coleta
echo "==> Gerando dados iniciais"
python3 "$DEST/claude-usage-tracker.py" || true

echo ""
echo "✅ Instalado!"
echo ""
echo "Agora ative a extensão:"
echo "  • Wayland: faça logout/login e rode  gnome-extensions enable $UUID"
echo "  • X11:     pressione Alt+F2, digite 'r', Enter, depois ative"
echo ""
echo "Ou use:  gnome-extensions enable $UUID"
