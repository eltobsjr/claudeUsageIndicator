#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Claude Usage Tracker
====================
Lê o uso real do Claude Code direto do endpoint de uso do claude.ai
(``GET /api/oauth/usage``) usando o token OAuth que o Claude Code já guarda em
``~/.claude/.credentials.json`` e grava um resumo em
``~/.local/share/claude-usage/usage.json``.

Esse endpoint **não** é de completions: ele só devolve estatísticas de uso
(percentuais de sessão/semana e horários de reset). Portanto **não consome
tokens**. É a mesma fonte que o ``/usage`` do Claude Code usa.

Rate-limit
----------
O endpoint é agressivamente limitado: ~2 chamadas e depois ``HTTP 429`` por
alguns minutos (header ``retry-after``). Por isso a chamada HTTP é **cacheada**:
a extensão pode rodar este script de 15 em 15s sem problema — o HTTP real só
acontece a cada ``POLL_INTERVAL`` segundos, e em caso de 429 respeitamos o
``retry-after``. Enquanto isso, servimos o último valor bom (marcado ``stale``).
Nunca inventamos números.

Uso:
  python3 claude-usage-tracker.py           -> grava o usage.json
  python3 claude-usage-tracker.py --print   -> grava e imprime o resumo
  python3 claude-usage-tracker.py --watch N -> roda em loop a cada N segundos
"""

import json
import os
import sys
import time
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Caminhos / constantes
# ---------------------------------------------------------------------------
HOME = os.path.expanduser("~")
DATA_DIR = os.path.join(
    os.environ.get("XDG_DATA_HOME", os.path.join(HOME, ".local", "share")),
    "claude-usage",
)
OUTPUT_FILE = os.path.join(DATA_DIR, "usage.json")
CACHE_FILE = os.path.join(DATA_DIR, "api-cache.json")
CREDENTIALS_FILE = os.path.join(HOME, ".claude", ".credentials.json")
CLAUDE_USAGE_API = "https://api.anthropic.com/api/oauth/usage"

# Intervalo mínimo entre chamadas HTTP reais à Anthropic (segundos).
# Bem acima do necessário para nunca tomar 429 em uso normal.
POLL_INTERVAL = 180
# Back-off padrão quando tomamos 429 sem header retry-after.
DEFAULT_BACKOFF = 300


# ---------------------------------------------------------------------------
# Credenciais
# ---------------------------------------------------------------------------
def load_credentials():
    """Lê o token OAuth do Claude Code (~/.claude/.credentials.json)."""
    try:
        with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
            creds = json.load(f)
        oauth = creds.get("claudeAiOauth", {})
        return {
            "access_token": oauth.get("accessToken", ""),
            "subscription_type": oauth.get("subscriptionType", "unknown"),
            "expires_at": oauth.get("expiresAt", 0),
        }
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Chamada à API (com cache + back-off no 429)
# ---------------------------------------------------------------------------
def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _http_get_usage(access_token):
    """
    Faz o GET cru. Retorna (status, data_or_None, retry_after_seconds_or_None).
    """
    req = urllib.request.Request(
        CLAUDE_USAGE_API,
        headers={
            "Authorization": "Bearer {}".format(access_token),
            "Content-Type": "application/json",
            "User-Agent": "claude-code/2.1.161",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        retry = None
        try:
            retry = int(e.headers.get("retry-after", "")) if e.headers else None
        except (ValueError, TypeError):
            retry = None
        return e.code, None, retry
    except Exception:
        return None, None, None


def get_api_usage(creds, force=False):
    """
    Devolve (api_data, meta) respeitando o cache.

    force=True ignora a janela de poll (botão "Atualizar agora"), mas ainda
    grava o back-off para não martelar a API em cliques repetidos.

    meta = {
        "fetched_at": epoch da última coleta bem-sucedida (ou None),
        "stale": True se servimos do cache porque a chamada falhou/foi pulada,
        "ok": True se temos qualquer dado (fresco ou do cache),
        "token_expired": True se o token OAuth está vencido/revogado,
    }
    """
    now = time.time()
    access_token = creds.get("access_token", "")

    # expires_at vem em ms (epoch). Normaliza para segundos.
    exp = creds.get("expires_at", 0) or 0
    exp_s = exp / 1000.0 if exp > 1e12 else exp
    token_expired = bool(exp_s) and now >= exp_s

    cache = load_json(CACHE_FILE, {})
    cached_data = cache.get("data")
    cached_fetched = cache.get("fetched_at")
    next_allowed = cache.get("next_allowed", 0)

    def served(expired=False):
        return cached_data, {
            "fetched_at": cached_fetched,
            "stale": True,
            "ok": cached_data is not None,
            "token_expired": expired,
        }

    # Sem token: só podemos servir o que houver em cache.
    if not access_token:
        return served()

    # Token vencido: chamar só renderia 401. Serve cache e sinaliza.
    if token_expired:
        return served(expired=True)

    # Dentro da janela de back-off / poll (e sem forçar): usa o cache.
    if not force and now < next_allowed and cached_data is not None:
        return served()

    status, data, retry_after = _http_get_usage(access_token)

    if status == 200 and data is not None:
        _save_cache({
            "data": data,
            "fetched_at": now,
            "next_allowed": now + POLL_INTERVAL,
        })
        return data, {"fetched_at": now, "stale": False, "ok": True,
                      "token_expired": False}

    # 401: token expirado/revogado.
    if status == 401:
        cache["next_allowed"] = now + DEFAULT_BACKOFF
        _save_cache(cache)
        return served(expired=True)

    # Outras falhas (429, rede...). Recua e mantém o último valor bom.
    backoff = retry_after if retry_after else (
        DEFAULT_BACKOFF if status == 429 else 60
    )
    cache["next_allowed"] = now + backoff
    _save_cache(cache)
    return served()


def _save_cache(cache):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f)
        os.replace(tmp, CACHE_FILE)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Montagem do resumo
# ---------------------------------------------------------------------------
def _severity_for(api_data, group):
    """Extrai a severidade ('normal'/'warning'/...) do array `limits` por grupo."""
    for lim in (api_data or {}).get("limits", []) or []:
        if lim.get("group") == group:
            return lim.get("severity")
    return None


def _window(api_data, key, sev_group):
    block = (api_data or {}).get(key) or {}
    if not block:
        return None
    return {
        "pct": block.get("utilization"),
        "reset_at": block.get("resets_at"),
        "severity": _severity_for(api_data, sev_group),
    }


def build_summary(force=False):
    creds = load_credentials()
    api_data, meta = get_api_usage(creds, force=force)
    now = datetime.now(timezone.utc)

    summary = {
        "generated_at": now.isoformat(),
        "plan": creds.get("subscription_type", "unknown"),
        "has_credentials": bool(creds.get("access_token")),
        "token_expired": meta.get("token_expired", False),
        "api_source": meta["ok"],
        "stale": meta["stale"],
        "fetched_at": (
            datetime.fromtimestamp(meta["fetched_at"], timezone.utc).isoformat()
            if meta["fetched_at"] else None
        ),
        "session": _window(api_data, "five_hour", "session"),
        "week": _window(api_data, "seven_day", "weekly"),
    }

    # Limite semanal específico de Opus (planos Max). Só inclui se existir.
    opus = (api_data or {}).get("seven_day_opus")
    if isinstance(opus, dict) and opus.get("utilization") is not None:
        summary["week_opus"] = {
            "pct": opus.get("utilization"),
            "reset_at": opus.get("resets_at"),
            "severity": _severity_for(api_data, "weekly_opus"),
        }

    return summary


def write_summary(summary):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = OUTPUT_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False)
    os.replace(tmp, OUTPUT_FILE)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def print_summary(s):
    def fmt(w):
        if not w or w.get("pct") is None:
            return "—"
        return "{:.0f}%  | reset: {}".format(w["pct"], w.get("reset_at") or "?")
    flag = " (cache/stale)" if s.get("stale") else ""
    print("Claude Usage — gerado em", s["generated_at"], flag)
    print("  Plano   :", s.get("plan"))
    print("  Sessão  :", fmt(s.get("session")))
    print("  Semana  :", fmt(s.get("week")))
    if s.get("week_opus"):
        print("  Sem.Opus:", fmt(s["week_opus"]))


def main():
    ap = argparse.ArgumentParser(description="Claude Usage Tracker (puro-API)")
    ap.add_argument("--print", action="store_true", help="imprime o resumo")
    ap.add_argument("--force", action="store_true",
                    help="ignora o cache e força uma chamada à API")
    ap.add_argument("--watch", type=int, metavar="SEG", default=0,
                    help="roda em loop a cada SEG segundos")
    args = ap.parse_args()

    def run_once(force=False):
        s = build_summary(force=force)
        write_summary(s)
        return s

    if args.watch > 0:
        while True:
            try:
                s = run_once()
                if args.print:
                    print_summary(s)
            except Exception as e:
                sys.stderr.write("erro: {}\n".format(e))
            time.sleep(args.watch)
    else:
        s = run_once(force=args.force)
        if args.print:
            print_summary(s)


if __name__ == "__main__":
    main()
