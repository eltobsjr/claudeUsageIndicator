import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extension"))
import consumption as c  # noqa: E402


def line(mid, ts, model, out, cache=0, inp=0):
    return json.dumps({"timestamp": ts, "message": {"id": mid, "model": model,
                       "usage": {"output_tokens": out, "cache_creation_input_tokens": cache, "input_tokens": inp}}}) + "\n"


class Parse(unittest.TestCase):
    def test_modelos(self):
        self.assertEqual(c.model_key("claude-sonnet-5-5"), "S")
        self.assertEqual(c.model_key("claude-haiku-5-5"), "H")
        self.assertEqual(c.model_key("claude-opus-5-5"), "O")
        self.assertIsNone(c.model_key("gpt-6-luna"))
        self.assertIsNone(c.model_key(None))

    def test_linha(self):
        r = c.parse_usage_line(line("m1", "2026-11-13T03:40:00Z", "claude-sonnet-5-5", 10, 5, 1))
        self.assertEqual((r[0], r[2], r[3]), ("m1", "S", 16))
        self.assertIsNone(c.parse_usage_line("lixo"))
        self.assertIsNone(c.parse_usage_line('{"message": {"usage": {}}}'))
        self.assertIsNone(c.parse_usage_line(line("m", "2026-11-13T03:40:00Z", "gpt-x", 1)))


class ScannerTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.root = os.path.join(self.d, "p")
        os.makedirs(os.path.join(self.root, "sess", "subagents"))
        self.cache = os.path.join(self.d, "cache.json")

    def write(self, rel, text, mode="a"):
        p = os.path.join(self.root, rel)
        with open(p, mode) as f:
            f.write(text)
        return p

    def test_mensagem_repetida_conta_uma_vez_com_o_maior_valor(self):
        self.write("a.jsonl", line("m1", "2026-11-13T03:40:00Z", "claude-sonnet-5-5", 5)
                   + line("m1", "2026-11-13T03:40:01Z", "claude-sonnet-5-5", 50)
                   + line("m1", "2026-11-13T03:40:02Z", "claude-sonnet-5-5", 50))
        sc = c.Scanner(self.cache)
        sc.scan(self.root, 0)
        self.assertEqual(sorted(m[2] for m in sc.messages()), [50])

    def test_mesma_mensagem_em_dois_arquivos_conta_uma_vez_e_subagente_entra(self):
        self.write("a.jsonl", line("m1", "2026-11-13T03:40:00Z", "claude-sonnet-5-5", 50))
        self.write("sess/subagents/b.jsonl", line("m1", "2026-11-13T03:40:00Z", "claude-sonnet-5-5", 50)
                   + line("m2", "2026-11-13T03:41:00Z", "claude-haiku-5-5", 7))
        sc = c.Scanner(self.cache)
        sc.scan(self.root, 0)
        self.assertEqual(sorted((m[1], m[2]) for m in sc.messages()), [("H", 7), ("S", 50)])

    def test_leitura_incremental_e_linha_incompleta(self):
        p = self.write("a.jsonl", line("m1", "2026-11-13T03:40:00Z", "claude-sonnet-5-5", 10))
        sc = c.Scanner(self.cache)
        sc.scan(self.root, 0)
        off1 = sc.files[p]["offset"]
        self.write("a.jsonl", line("m2", "2026-11-13T03:41:00Z", "claude-sonnet-5-5", 20)[:-15])  # sem \n final
        sc = c.Scanner(self.cache)  # recarrega do cache
        sc.scan(self.root, 0)
        self.assertEqual(sc.files[p]["offset"], off1)  # linha incompleta fica para a próxima
        self.write("a.jsonl", line("m2", "2026-11-13T03:41:00Z", "claude-sonnet-5-5", 20)[-15:])
        sc.scan(self.root, 0)
        self.assertEqual(sorted(m[2] for m in sc.messages()), [10, 20])

    def test_arquivo_recriado_e_antigo_sao_descartados(self):
        p = self.write("a.jsonl", line("m1", "2026-11-13T03:40:00Z", "claude-sonnet-5-5", 10) * 3)
        sc = c.Scanner(self.cache)
        sc.scan(self.root, 0)
        self.write("a.jsonl", line("m9", "2026-11-13T03:50:00Z", "claude-haiku-5-5", 4), mode="w")
        sc.scan(self.root, 0)
        self.assertEqual([m[2] for m in sc.messages()], [4])
        sc.scan(self.root, os.stat(p).st_mtime + 1000)  # tudo mais velho que a janela
        self.assertEqual(sc.messages(), [])


class Compute(unittest.TestCase):
    def test_janelas_totais_agentes_e_excluidos(self):
        start_s, start_w, now = 1000.0, 0.0, 1000.0 + 1900
        cc = [(1100.0, "S", 100), (3000.0, "S", 50), (500.0, "H", 10)]
        ob = [(1200.0, "claude-sonnet-5-5", "claude", 30, "Auditor"), (1300.0, "gpt-6-luna", "codex", 9, "Revisor"),
              (1400.0, "claude-haiku-5-5", "claude", 5, "Auditor")]
        r = c.compute(cc, ob, start_s, start_w, now)
        self.assertEqual(r["session"]["slots"][0]["S"], 130)   # 100 (cc) + 30 (ob) em 1000..2800
        self.assertEqual(r["session"]["slots"][0]["H"], 5)
        self.assertEqual(r["session"]["slots"][1]["S"], 50)    # 3000 cai na janela 2800..4600
        self.assertEqual(r["models"]["week"]["S"]["cc"], 150)
        self.assertEqual(r["models"]["week"]["S"]["ob"], 30)
        self.assertEqual(r["models"]["session"]["H"]["cc"], 0)  # o H de cc (500) é anterior à sessão
        self.assertEqual(r["agents"], [{"name": "Auditor", "tokens": 35, "turns": 2}])
        self.assertEqual(r["excluded"], {"gpt-6-luna": 9})
        self.assertTrue(r["session"]["slots"][5]["future"])


class OpenBot(unittest.TestCase):
    def test_banco_somente_leitura_e_falha_vira_vazio(self):
        d = tempfile.mkdtemp()
        db = os.path.join(d, "o.db")
        con = sqlite3.connect(db)
        con.execute("create table projection_agents (agent_id text, agent_json text)")
        con.execute("create table agent_usage_records (occurred_at text, model text, provider text, tokens_json text, agent_id text)")
        con.execute("insert into projection_agents values ('a1', ?)", (json.dumps({"id": "a1", "name": "Auditor"}),))
        con.execute("insert into agent_usage_records values ('2026-11-13T03:40:00.000Z','claude-sonnet-5-5','claude',?,'a1')",
                    (json.dumps({"output": 10, "cacheCreation": 5, "uncachedInput": 1, "cachedInput": 99999}),))
        con.commit()
        con.close()
        rows = c.openbot_rows(db, 0)
        self.assertEqual([(r[1], r[3], r[4]) for r in rows], [("claude-sonnet-5-5", 16, "Auditor")])  # cache lido fica de fora
        self.assertEqual(c.openbot_rows(os.path.join(d, "nao-existe.db"), 0), [])
        with open(os.path.join(d, "ruim.db"), "w") as f:
            f.write("isto não é sqlite")
        self.assertEqual(c.openbot_rows(os.path.join(d, "ruim.db"), 0), [])

    def test_collect_sem_janelas_devolve_none(self):
        self.assertIsNone(c.collect({}, "/tmp", None, "/tmp/x.json"))


if __name__ == "__main__":
    unittest.main()
