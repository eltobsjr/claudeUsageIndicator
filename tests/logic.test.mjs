import test from 'node:test';
import assert from 'node:assert/strict';

import {
    shown, level, countdown, countdownLegacy, pace, paceAlert, paceText, fmtTokens, agoLabel, planLabel,
    slotLabel, cumulative, modelRows, agentsView, barRings, legacyBar, worstLevel, clampThresholds,
    SESSION_SEC, WEEK_SEC,
} from '../extension/logic.js';

test('shown: restante (padrão) e usado', () => {
    assert.equal(shown(14, 'remaining'), 86);
    assert.equal(shown(14, 'used'), 14);
    assert.equal(shown(40.4, 'remaining'), 60);
    assert.equal(shown(null, 'remaining'), 100);
    assert.equal(shown(150, 'remaining'), 0);
});

test('level: limites de restante e gravidade da API só piora', () => {
    assert.equal(level(14), 'ok');
    assert.equal(level(70), 'warn');   // restam 30
    assert.equal(level(69.9), 'ok');
    assert.equal(level(90), 'crit');   // restam 10
    assert.equal(level(95, 30, 10), 'crit');
    assert.equal(level(50, 60, 20), 'warn');        // limites configuráveis: restam 50 <= 60
    assert.equal(level(10, 30, 10, 'warning'), 'warn');  // API avisa mesmo com folga
    assert.equal(level(10, 30, 10, 'critical'), 'crit');
    assert.equal(level(95, 30, 10, 'normal'), 'crit');   // API normal não rebaixa
    assert.equal(level(null), 'ok');
});

test('countdown: 4d21h, 4h38, 40m, agora', () => {
    assert.equal(countdown(4 * 86400 + 21 * 3600 + 120), '4d21h');
    assert.equal(countdown(4 * 3600 + 38 * 60 + 5), '4h38');
    assert.equal(countdown(40 * 60), '40m');
    assert.equal(countdown(20), '1m');
    assert.equal(countdown(0), 'agora');
    assert.equal(countdown(-5), 'agora');
    assert.equal(countdown(null), '');
    assert.equal(countdown(86400), '1d00h');
    assert.equal(countdownLegacy(4 * 3600 + 38 * 60), '4h38m');
    assert.equal(countdownLegacy(6 * 86400 + 11 * 3600), '6d11h');
});

const H = 3600 * 1000;
test('pace: semana com 40% em 2 dos 7 dias = 1,4x e acaba antes do reset', () => {
    const now = 1_000_000_000_000;
    const reset = now + 5 * 86400 * 1000;
    const p = pace({usedPct: 40, resetAtMs: reset, windowSec: WEEK_SEC, nowMs: now});
    assert.ok(Math.abs(p.elapsed - 2 / 7) < 1e-9);
    assert.ok(Math.abs(p.ratio - 1.4) < 1e-9);
    assert.ok(p.runsOut);
    assert.ok(p.emptyInSec < 5 * 86400);
    assert.ok(paceAlert(p));
    assert.equal(paceText(p), '1,4× o ritmo');
});

test('pace: ritmo baixo, início da janela e sem dados', () => {
    const now = 1_000_000_000_000;
    const baixo = pace({usedPct: 10, resetAtMs: now + 5 * 86400 * 1000, windowSec: WEEK_SEC, nowMs: now});
    assert.ok(baixo.ratio < 1 && !baixo.runsOut && !paceAlert(baixo));
    const inicio = pace({usedPct: 5, resetAtMs: now + SESSION_SEC * 1000 - 1000, windowSec: SESSION_SEC, nowMs: now});
    assert.equal(inicio.ratio, null);          // menos de 2% da janela: sem base para projetar
    assert.ok(!paceAlert(inicio));
    assert.equal(pace({usedPct: null, resetAtMs: now, windowSec: 10, nowMs: now}), null);
    assert.equal(pace({usedPct: 10, resetAtMs: 0, windowSec: 10, nowMs: now}), null);
    const exato = pace({usedPct: 50, resetAtMs: now + 2.5 * H, windowSec: SESSION_SEC, nowMs: now});
    assert.ok(Math.abs(exato.ratio - 1) < 1e-9 && !paceAlert(exato));   // exatamente no ritmo: sem alerta
});

test('fmtTokens, agoLabel, planLabel', () => {
    assert.equal(fmtTokens(10_780_000), '10,8 M');
    assert.equal(fmtTokens(710_000), '710 mil');
    assert.equal(fmtTokens(950), '950');
    assert.equal(agoLabel(0, 1), '');
    assert.equal(agoLabel(1000, 1000 + 10_000), 'atualizado agora');
    assert.equal(agoLabel(1000, 1000 + 120_000), 'atualizado há 2 min');
    assert.equal(agoLabel(1000, 1000 + 2 * 3600 * 1000), 'atualizado há 2 h');
    assert.equal(planLabel('max_5x'), 'Max');
    assert.equal(planLabel('pro'), 'Pro');
    assert.equal(planLabel('unknown'), '?');
});

test('cumulative: soma até a última janela que aconteceu e ignora as futuras', () => {
    const slots = [
        {t: 0, S: 10, H: 0, O: 0, future: false},
        {t: 1, S: 5, H: 3, O: 0, future: false},
        {t: 2, S: 99, H: 99, O: 99, future: true},
    ];
    const c = cumulative(slots);
    assert.equal(c.last, 1);
    assert.deepEqual(c.series.S, [[0, 10], [1, 15]]);
    assert.deepEqual(c.series.T, [[0, 10], [1, 18]]);
    assert.equal(c.max, 18);
    assert.equal(cumulative([]).max, 0);
});

test('modelRows: ordena, soma origens e calcula participação', () => {
    const r = modelRows({
        S: {cc: 700, ob: 100, cc_turns: 7, ob_turns: 1},
        H: {cc: 50, ob: 50, cc_turns: 2, ob_turns: 2},
        O: {cc: 0, ob: 0, cc_turns: 0, ob_turns: 0},
    });
    assert.deepEqual(r.rows.map(x => x.key), ['S', 'H']);   // Opus sem uso some
    assert.equal(r.rows[0].turns, 8);
    assert.equal(r.max, 800);
    assert.ok(Math.abs(r.ccShare - 750 / 900) < 1e-9);
    assert.equal(modelRows(null).rows.length, 0);
});

test('agentsView: top 4 e rosca com "Outros"', () => {
    const ag = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n, i) => ({name: n, tokens: 100 - i * 10, turns: i}));
    const v = agentsView(ag, 4);
    assert.equal(v.top.length, 4);
    assert.equal(v.donut.length, 6);
    assert.equal(v.donut.at(-1).name, 'Outros');
    assert.equal(v.donut.at(-1).tokens, 50 + 40);
    assert.equal(v.total, ag.reduce((s, a) => s + a.tokens, 0));
    assert.equal(agentsView([], 4).max, 0);
});

test('slotLabel: semana usa dia e sessão usa hora', () => {
    const t = new Date(2026, 10, 13, 1, 30).getTime() / 1000;   // sex 13/11 01:30 local
    assert.equal(slotLabel({t}, 'week'), 'sex 13');
    assert.equal(slotLabel({t}, 'session'), '01:30');
});

const NOW = new Date('2026-11-13T04:00:00Z').getTime();
const SESSION = {pct: 14, reset_at: '2026-11-13T08:30:00Z', severity: 'normal'};
const WEEK = {pct: 40, reset_at: '2026-11-18T04:00:00Z', severity: 'normal'};
const CFG = {valueMode: 'remaining', warnAt: 30, critAt: 10, showPace: true, showReset: true, format: 'rings'};

test('barRings: restante, tempo e alerta de ritmo só na semana', () => {
    const [a, b] = barRings({session: SESSION, week: WEEK, cfg: CFG, nowMs: NOW});
    assert.equal(a.value, 86);
    assert.ok(Math.abs(a.ringFrac - 0.86) < 1e-9);
    assert.equal(a.level, 'ok');
    assert.equal(a.reset, '4h30');
    assert.equal(b.value, 60);
    assert.equal(b.reset, '5d00h');
    assert.ok(b.alert);   // 40% usados com 2 dos 7 dias gastos
});

test('barRings: modo usado, sem tempo, sem alerta, crítico e dado ausente', () => {
    const r = barRings({session: {pct: 93, reset_at: SESSION.reset_at}, week: null,
        cfg: {...CFG, valueMode: 'used', showReset: false, showPace: false}, nowMs: NOW});
    assert.equal(r[0].value, 93);
    assert.ok(Math.abs(r[0].ringFrac - 0.93) < 1e-9);
    assert.equal(r[0].level, 'crit');
    assert.equal(r[0].reset, '');
    assert.equal(r[0].alert, false);
    assert.equal(r[1].empty, true);
});

test('legacyBar: completo, compacto, barras e sem dado', () => {
    assert.equal(legacyBar({session: SESSION, week: WEEK, cfg: {...CFG, valueMode: 'used', format: 'full'}, nowMs: NOW}), 'S 14% 4h30m · W 40% 5d0h');
    assert.equal(legacyBar({session: SESSION, week: WEEK, cfg: {...CFG, format: 'compact'}, nowMs: NOW}), 'S 86% · W 60%');
    assert.match(legacyBar({session: SESSION, week: null, cfg: {...CFG, format: 'spark'}, nowMs: NOW}), /^▓+░* 86% · W —$/u);
});

test('worstLevel e clampThresholds', () => {
    assert.equal(worstLevel(['ok', 'warn']), 'warn');
    assert.equal(worstLevel(['ok', 'crit', 'warn']), 'crit');
    assert.equal(worstLevel(['ok', 'ok']), 'ok');
    assert.deepEqual(clampThresholds(30, 10), {warn: 30, crit: 10});
    assert.deepEqual(clampThresholds(20, 25), {warn: 20, crit: 15});   // crítico nunca >= atenção
    assert.deepEqual(clampThresholds(5, 5), {warn: 10, crit: 5});
    assert.deepEqual(clampThresholds(200, -4), {warn: 95, crit: 5});
});
