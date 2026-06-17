UUID = claude-usage@eltobsjr.gmail.com
EXT  = extension
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all install uninstall enable disable schema pack clean run

all: install

# Instala localmente (link + compila schema)
install: schema
	@rm -rf "$(DEST)"
	@mkdir -p "$(DEST)"
	@cp -r $(EXT)/. "$(DEST)/"
	@glib-compile-schemas "$(DEST)/schemas"
	@chmod +x "$(DEST)/claude-usage-tracker.py"
	@echo "Instalado em $(DEST)"

schema:
	@glib-compile-schemas $(EXT)/schemas

enable:
	@gnome-extensions enable $(UUID)

disable:
	@gnome-extensions disable $(UUID)

uninstall:
	@rm -rf "$(DEST)"
	@echo "Removido."

# Gera o .zip para enviar ao extensions.gnome.org
pack: schema
	@cd $(EXT) && zip -r -FS ../$(UUID).shell-extension.zip . \
		-x '__pycache__/*' '*/__pycache__/*' '*.pyc' 'schemas/gschemas.compiled'
	@echo "Pacote: $(UUID).shell-extension.zip"

# Roda o tracker manualmente e imprime resumo
run:
	@python3 $(EXT)/claude-usage-tracker.py --print

clean:
	@rm -f $(UUID).shell-extension.zip
	@rm -f $(EXT)/schemas/gschemas.compiled
	@find $(EXT) -name '__pycache__' -type d -prune -exec rm -rf {} +
