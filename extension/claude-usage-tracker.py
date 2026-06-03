#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Claude Usage Tracker
====================
Lê os arquivos de transcrição (JSONL) gerados localmente pelo Claude Code em
``~/.claude/projects`` e produz um resumo de uso (tokens, custo estimado e
janelas de reset) em ``~/.local/share/claude-usage/usage.json``.

Não faz nenhuma chamada de rede e não consome tokens: tudo é calculado a partir
dos arquivos que o Claude Code já grava no disco.

Pode ser usado de duas formas:
  * Como biblioteca/daemon disparado pela extensão GNOME (gera o usage.json).
  * Como CLI:  ``python3 claude-usage-tracker.py``         -> grava o JSON
               ``python3 claude-usage-tracker.py --print`` -> imprime resumo
"""

import json
import os
import sys
import time
import glob
import argparse
from datetime import datetime, timezone, timedelta

# ---------------------------------------------------------------------------
# Caminhos
# ---------------------------------------------------------------------------
HOME = os.path.expanduser("~")
PROJECTS_DIRS = [
    os.path.join(HOME, ".claude", "projects"),
    os.path.join(HOME, ".config", "claude", "projects"),
]
DATA_DIR = os.path.join(
    os.environ.get("XDG_DATA_HOME", os.path.join(HOME, ".local", "share")),
    "claude-usage",
)
OUTPUT_FILE = os.path.join(DATA_DIR, "usage.json")
CACHE_FILE = os.path.join(DATA_DIR, "cache.json")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")

# ---------------------------------------------------------------------------
# Preços públicos (USD por 1 milhão de tokens). Usados só para *estimar* custo.
# Correspondência por substring no nome do modelo.
# ---------------------------------------------------------------------------
PRICING = [
    # (substring, input, output, cache_write, cache_read)
    ("opus",        15.00, 75.00, 18.75, 1.50),
    ("sonnet",       3.00, 15.00,  3.75, 0.30),
    ("haiku-3",      0.80,  4.00,  1.00, 0.08),
    ("haiku-4",      1.00,  5.00,  1.25, 0.10),
    ("haiku",        1.00,  5.00,  1.25, 0.10),
]
DEFAULT_PRICE = (3.00, 15.00, 3.75, 0.30)  # fallback = sonnet

# Janela rolante de sessão da Anthropic (5 horas).
SESSION_WINDOW_H = 5

DEFAULT_CONFIG = {
    # Limites do plano (em tokens) para cálculo de %. 0 = desconhecido.
    "session_token_limit": 0,
    "daily_token_limit": 0,
    "weekly_token_limit": 0,
    # Reset semanal: dia da semana (0=segunda ... 6=domingo) e hora local.
    "weekly_reset_weekday": 0,
    "weekly_reset_hour": 0,
}


def price_for(model):
    if not model:
        return DEFAULT_PRICE
    m = model.lower()
    for sub, i, o, cw, cr in PRICING:
        if sub in m:
            return (i, o, cw, cr)
    return DEFAULT_PRICE


def cost_of(model, usage):
    i, o, cw, cr = price_for(model)
    inp = usage.get("input_tokens", 0) or 0
    out = usage.get("output_tokens", 0) or 0
    cwt = usage.get("cache_creation_input_tokens", 0) or 0
    crt = usage.get("cache_read_input_tokens", 0) or 0
    return (inp * i + out * o + cwt * cw + crt * cr) / 1_000_000.0


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(load_json(CONFIG_FILE, {}))
    return cfg


# ---------------------------------------------------------------------------
# Leitura incremental dos JSONL
# ---------------------------------------------------------------------------
def find_jsonl_files():
    files = []
    for base in PROJECTS_DIRS:
        if os.path.isdir(base):
            files.extend(glob.glob(os.path.join(base, "**", "*.jsonl"), recursive=True))
    return files


def parse_file(path):
    """Extrai registros de uso de um arquivo. Retorna lista de dicts compactos."""
    records = []
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or '"usage"' not in line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                msg = obj.get("message") or {}
                usage = msg.get("usage")
                if not isinstance(usage, dict):
                    continue
                ts = obj.get("timestamp")
                if not ts:
                    continue
                model = msg.get("model") or obj.get("model") or ""
                # chave de deduplicação
                uid = "{}:{}".format(msg.get("id", ""), obj.get("requestId", ""))
                records.append({
                    "ts": ts,
                    "model": model,
                    "uid": uid,
                    "in": usage.get("input_tokens", 0) or 0,
                    "out": usage.get("output_tokens", 0) or 0,
                    "cw": usage.get("cache_creation_input_tokens", 0) or 0,
                    "cr": usage.get("cache_read_input_tokens", 0) or 0,
                    "cost": cost_of(model, usage),
                })
    except Exception:
        return []
    return records


def collect_records():
    """Lê todos os arquivos usando cache por mtime+size; retorna lista de registros."""
    cache = load_json(CACHE_FILE, {})
    new_cache = {}
    all_records = []
    for path in find_jsonl_files():
        try:
            st = os.stat(path)
        except OSError:
            continue
        sig = "{}:{}".format(int(st.st_mtime), st.st_size)
        entry = cache.get(path)
        if entry and entry.get("sig") == sig:
            recs = entry.get("records", [])
        else:
            recs = parse_file(path)
        new_cache[path] = {"sig": sig, "records": recs}
        all_records.extend(recs)
    # grava cache atualizado
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(new_cache, f)
    except Exception:
        pass
    return all_records


def parse_ts(ts):
    """ISO 8601 -> datetime aware (UTC)."""
    try:
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Agregação
# ---------------------------------------------------------------------------
def empty_bucket():
    return {"in": 0, "out": 0, "cw": 0, "cr": 0, "cost": 0.0, "tokens": 0, "count": 0}


def add_to(bucket, r):
    bucket["in"] += r["in"]
    bucket["out"] += r["out"]
    bucket["cw"] += r["cw"]
    bucket["cr"] += r["cr"]
    bucket["cost"] += r["cost"]
    bucket["tokens"] += r["in"] + r["out"] + r["cw"] + r["cr"]
    bucket["count"] += 1


def weekly_reset_bounds(now_local, weekday, hour):
    """Retorna (inicio_da_semana, proximo_reset) como datetimes locais."""
    # Encontra o último instante de reset <= now.
    candidate = now_local.replace(hour=hour, minute=0, second=0, microsecond=0)
    days_back = (now_local.weekday() - weekday) % 7
    start = candidate - timedelta(days=days_back)
    if start > now_local:
        start -= timedelta(days=7)
    return start, start + timedelta(days=7)


def build_summary(records, cfg):
    now = datetime.now(timezone.utc)
    now_local = datetime.now().astimezone()
    tz = now_local.tzinfo

    # dedup
    seen = set()
    deduped = []
    for r in records:
        uid = r.get("uid") or ""
        if uid and uid != ":" :
            if uid in seen:
                continue
            seen.add(uid)
        dt = parse_ts(r["ts"])
        if dt is None:
            continue
        r = dict(r)
        r["_dt"] = dt
        deduped.append(r)
    deduped.sort(key=lambda x: x["_dt"])

    # janelas
    today = empty_bucket()
    week = empty_bucket()
    session = empty_bucket()
    total = empty_bucket()
    by_model = {}
    daily = {}  # 'YYYY-MM-DD' -> bucket (últimos 14 dias)

    # limites de tempo
    midnight_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_local, week_reset_local = weekly_reset_bounds(
        now_local, cfg["weekly_reset_weekday"], cfg["weekly_reset_hour"])

    # ---- janela de sessão de 5h (rolante, ancorada na 1ª msg do bloco) ----
    block_start = None
    for r in deduped:
        dt = r["_dt"]
        if block_start is None or (dt - block_start) >= timedelta(hours=SESSION_WINDOW_H):
            block_start = dt
    session_reset = None
    if block_start is not None:
        session_end = block_start + timedelta(hours=SESSION_WINDOW_H)
        if now < session_end:
            session_reset = session_end
        else:
            block_start = None  # bloco expirou -> sessão zerada

    for r in deduped:
        dt = r["_dt"]
        dt_local = dt.astimezone(tz)
        add_to(total, r)

        # por modelo
        m = r["model"] or "desconhecido"
        by_model.setdefault(m, empty_bucket())
        add_to(by_model[m], r)

        # hoje
        if dt_local >= midnight_local:
            add_to(today, r)

        # semana (janela do reset configurado)
        if week_start_local <= dt_local < week_reset_local:
            add_to(week, r)

        # sessão de 5h
        if block_start is not None and dt >= block_start:
            add_to(session, r)

        # diário (últimos 14 dias)
        key = dt_local.strftime("%Y-%m-%d")
        daily.setdefault(key, empty_bucket())
        add_to(daily[key], r)

    # mantém só os últimos 14 dias
    cutoff = (now_local - timedelta(days=14)).strftime("%Y-%m-%d")
    daily = {k: v for k, v in daily.items() if k >= cutoff}

    def pct(used, limit):
        if not limit:
            return None
        return round(min(used / limit, 1.0) * 100, 1)

    summary = {
        "generated_at": now.isoformat(),
        "session": {
            **session,
            "reset_at": session_reset.isoformat() if session_reset else None,
            "limit": cfg["session_token_limit"],
            "pct": pct(session["tokens"], cfg["session_token_limit"]),
            "window_hours": SESSION_WINDOW_H,
        },
        "today": {
            **today,
            "reset_at": (midnight_local + timedelta(days=1)).isoformat(),
            "limit": cfg["daily_token_limit"],
            "pct": pct(today["tokens"], cfg["daily_token_limit"]),
        },
        "week": {
            **week,
            "start_at": week_start_local.isoformat(),
            "reset_at": week_reset_local.isoformat(),
            "limit": cfg["weekly_token_limit"],
            "pct": pct(week["tokens"], cfg["weekly_token_limit"]),
        },
        "total": total,
        "by_model": dict(sorted(by_model.items(), key=lambda kv: -kv[1]["cost"])),
        "daily": dict(sorted(daily.items())),
        "config": cfg,
    }
    return summary


def write_summary(summary):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = OUTPUT_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False)
    os.replace(tmp, OUTPUT_FILE)


def human_tokens(n):
    if n >= 1_000_000:
        return "{:.1f}M".format(n / 1_000_000)
    if n >= 1_000:
        return "{:.1f}k".format(n / 1_000)
    return str(n)


def print_summary(s):
    def fmt(b):
        return "{} tokens  ${:.2f}  ({} reqs)".format(
            human_tokens(b["tokens"]), b["cost"], b["count"])
    print("Claude Usage  —  gerado em", s["generated_at"])
    print("  Sessão 5h :", fmt(s["session"]), "| reset:", s["session"]["reset_at"])
    print("  Hoje      :", fmt(s["today"]))
    print("  Semana    :", fmt(s["week"]), "| reset:", s["week"]["reset_at"])
    print("  Total     :", fmt(s["total"]))
    print("  Por modelo:")
    for m, b in s["by_model"].items():
        print("     - {:24} {}".format(m, fmt(b)))


def main():
    ap = argparse.ArgumentParser(description="Claude Usage Tracker")
    ap.add_argument("--print", action="store_true", help="imprime resumo no terminal")
    ap.add_argument("--watch", type=int, metavar="SEG", default=0,
                    help="roda em loop a cada SEG segundos")
    args = ap.parse_args()

    def run_once():
        cfg = load_config()
        records = collect_records()
        summary = build_summary(records, cfg)
        write_summary(summary)
        return summary

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
        s = run_once()
        if args.print:
            print_summary(s)


if __name__ == "__main__":
    main()
