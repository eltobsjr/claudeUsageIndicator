# -*- coding: utf-8 -*-
"""
Consumo por modelo e por agente (Claude Code + OpenBot).

Soma "tokens novos" (saída + criação de cache + entrada não cacheada) por modelo, nas janelas da sessão (5 h) e da
semana (7 dias), de duas fontes locais:

* Claude Code: os registros de sessão em ``~/.claude/projects/**/*.jsonl`` (inclui subagentes). O mesmo ``message.id``
  aparece em várias linhas (uma por bloco de conteúdo), então cada mensagem é contada UMA vez (a linha com mais saída).
  A leitura é incremental (guarda o deslocamento por arquivo), para não reler arquivos de dezenas de MB a cada ciclo.
* OpenBot: a tabela ``agent_usage_records`` do ``openbot.db``, aberta só para leitura.

Isto mostra ONDE foi o uso. A cota do plano não é proporcional a tokens e o peso de cada modelo não é público.
Qualquer falha de uma fonte só tira essa fonte do resultado; nunca levanta erro para quem chama.
"""
import json
import os
import sqlite3
import time
from datetime import datetime, timezone

MODEL_KEYS = (("opus", "O"), ("sonnet", "S"), ("haiku", "H"))
SESSION_STEP = 1800  # 30 min
SESSION_SLOTS = 10   # 5 h
WEEK_STEP = 86400    # 1 dia
WEEK_SLOTS = 7
MAX_AGENTS = 12


def model_key(name):
    n = (name or "").lower()
    for sub, key in MODEL_KEYS:
        if sub in n:
            return key
    return None


def _epoch(iso):
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()


def parse_usage_line(line):
    """(id, instante, modelo, tokens) de uma linha do registro do Claude Code, ou None."""
    if '"usage"' not in line:
        return None
    try:
        o = json.loads(line)
    except ValueError:
        return None
    m = o.get("message") if isinstance(o, dict) else None
    if not isinstance(m, dict):
        return None
    u, mid, key, ts = m.get("usage"), m.get("id"), model_key(m.get("model")), o.get("timestamp")
    if not (isinstance(u, dict) and mid and key and ts):
        return None
    try:
        t = _epoch(ts)
    except ValueError:
        return None
    tokens = sum(int(u.get(k, 0) or 0) for k in ("output_tokens", "cache_creation_input_tokens", "input_tokens"))
    return mid, t, key, tokens


class Scanner:
    """Leitura incremental dos registros do Claude Code, com cache por arquivo."""

    def __init__(self, cache_path):
        self.cache_path = cache_path
        self.files = {}
        self._dirty = False
        try:
            with open(cache_path, encoding="utf-8") as f:
                self.files = json.load(f).get("files", {})
        except (OSError, ValueError):
            self.files = {}

    def scan(self, root, since):
        seen = set()
        for dirpath, _dirs, names in os.walk(root):
            for name in names:
                if not name.endswith(".jsonl"):
                    continue
                path = os.path.join(dirpath, name)
                try:
                    st = os.stat(path)
                except OSError:
                    continue
                if st.st_mtime < since:
                    continue
                seen.add(path)
                self._scan_file(path, st.st_size)
        for path in [p for p in self.files if p not in seen]:
            del self.files[path]  # arquivo antigo ou removido
            self._dirty = True
        self._save()

    def _scan_file(self, path, size):
        ent = self.files.get(path) or {"offset": 0, "msgs": {}}
        if size < ent["offset"]:
            ent = {"offset": 0, "msgs": {}}  # arquivo recriado
        if size == ent["offset"] and path in self.files:
            return
        try:
            with open(path, "rb") as f:
                f.seek(ent["offset"])
                chunk = f.read(size - ent["offset"])
        except OSError:
            return
        end = chunk.rfind(b"\n")
        if end < 0:
            return  # linha ainda incompleta
        for raw in chunk[: end + 1].decode("utf-8", errors="ignore").splitlines():
            r = parse_usage_line(raw)
            if r:
                mid, t, key, tokens = r
                old = ent["msgs"].get(mid)
                if not old or tokens > old[2]:
                    ent["msgs"][mid] = [t, key, tokens]
        ent["offset"] += end + 1
        self.files[path] = ent
        self._dirty = True

    def messages(self):
        """Mensagens distintas de todos os arquivos (mesmo id = uma só, com o maior valor)."""
        out = {}
        for ent in self.files.values():
            for mid, (t, key, tokens) in ent["msgs"].items():
                old = out.get(mid)
                if not old or tokens > old[2]:
                    out[mid] = (t, key, tokens)
        return list(out.values())

    def _save(self):
        if not self._dirty:
            return
        os.makedirs(os.path.dirname(self.cache_path), exist_ok=True)
        tmp = self.cache_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"files": self.files}, f)
        os.replace(tmp, self.cache_path)
        self._dirty = False


def openbot_rows(db_path, since_epoch):
    """[(instante, modelo, provedor, tokens, agente)] do OpenBot, só leitura. Falha vira lista vazia."""
    if not db_path or not os.path.exists(db_path):
        return []
    since = datetime.fromtimestamp(since_epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    con = None
    try:
        con = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True, timeout=2)
        names = {}
        for (aj,) in con.execute("select agent_json from projection_agents"):
            try:
                a = json.loads(aj)
                names[a["id"]] = a.get("name") or a["id"]
            except (ValueError, KeyError, TypeError):
                pass
        rows = []
        for ts, model, prov, tj, aid in con.execute(
            "select occurred_at, model, provider, tokens_json, agent_id from agent_usage_records where occurred_at >= ?",
            (since,),
        ):
            try:
                tk = json.loads(tj)
                tokens = sum(int(tk.get(k, 0) or 0) for k in ("output", "cacheCreation", "uncachedInput"))
                rows.append((_epoch(ts), model, prov, tokens, names.get(aid, aid)))
            except (ValueError, TypeError):
                continue
        return rows
    except (sqlite3.Error, OSError):
        return []
    finally:
        if con is not None:
            con.close()


def make_slots(events, start, step, n, now):
    """events: [(t, chave, tokens)] -> n janelas de `step` s a partir de `start`; marca as que ainda não aconteceram."""
    slots = [{"t": start + i * step, "S": 0, "H": 0, "O": 0, "future": start + i * step > now} for i in range(n)]
    for t, key, tokens in events:
        i = int((t - start) // step)
        if 0 <= i < n and key in ("S", "H", "O"):
            slots[i][key] += tokens
    return slots


def _totals(cc, ob, start):
    out = {"S": {"cc": 0, "ob": 0, "cc_turns": 0, "ob_turns": 0}, "H": {"cc": 0, "ob": 0, "cc_turns": 0, "ob_turns": 0},
           "O": {"cc": 0, "ob": 0, "cc_turns": 0, "ob_turns": 0}}
    for t, key, tokens in cc:
        if t >= start:
            out[key]["cc"] += tokens
            out[key]["cc_turns"] += 1
    for t, key, tokens in ob:
        if t >= start:
            out[key]["ob"] += tokens
            out[key]["ob_turns"] += 1
    return out


def compute(cc_msgs, ob_rows, session_start, week_start, now):
    """Parte pura (testável): junta as duas fontes nas janelas e nos totais."""
    cc = [(t, key, tk) for (t, key, tk) in cc_msgs]
    ob, excluded, agents = [], {}, {}
    for t, model, prov, tokens, agent in ob_rows:
        key = model_key(model) if prov == "claude" else None
        if key:
            ob.append((t, key, tokens))
            if t >= week_start:
                a = agents.setdefault(agent, {"name": agent, "tokens": 0, "turns": 0})
                a["tokens"] += tokens
                a["turns"] += 1
        elif t >= week_start:
            excluded[model] = excluded.get(model, 0) + tokens  # ex.: GPT (OpenAI): fora da cota do Claude
    both = cc + ob
    return {
        "session": {"start": session_start, "step": SESSION_STEP,
                    "slots": make_slots(both, session_start, SESSION_STEP, SESSION_SLOTS, now)},
        "week": {"start": week_start, "step": WEEK_STEP, "slots": make_slots(both, week_start, WEEK_STEP, WEEK_SLOTS, now)},
        "models": {"session": _totals(cc, ob, session_start), "week": _totals(cc, ob, week_start)},
        "agents": sorted(agents.values(), key=lambda a: -a["tokens"])[:MAX_AGENTS],
        "excluded": excluded,
    }


def collect(summary, claude_root, openbot_db, cache_path, now=None):
    """Consumo por modelo/agente nas janelas de `summary` (do usage.json). None se não der para calcular."""
    try:
        now = now or time.time()
        s_reset = (summary.get("session") or {}).get("reset_at")
        w_reset = (summary.get("week") or {}).get("reset_at")
        if not s_reset or not w_reset:
            return None
        session_start = _epoch(s_reset) - SESSION_SLOTS * SESSION_STEP
        week_start = _epoch(w_reset) - WEEK_SLOTS * WEEK_STEP
        cc_msgs, sources = [], {"claude_code": False, "openbot": False}
        try:
            sc = Scanner(cache_path)
            sc.scan(claude_root, week_start)
            cc_msgs = [m for m in sc.messages() if m[0] >= week_start]
            sources["claude_code"] = True
        except OSError:
            pass
        ob = openbot_rows(openbot_db, week_start)
        sources["openbot"] = bool(ob) or bool(openbot_db and os.path.exists(openbot_db))
        out = compute(cc_msgs, ob, session_start, week_start, now)
        out["sources"] = sources
        out["generated_at"] = now
        return out
    except Exception:  # nunca derruba o resumo de uso por causa disto
        return None
