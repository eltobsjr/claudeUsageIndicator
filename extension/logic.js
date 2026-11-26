// Lógica pura do indicador (sem gi://): testável com `node --test` (tests/logic.test.mjs).
// Tudo que decide "o que mostrar" a partir dos dados fica aqui; a interface só desenha.

export const SESSION_SEC = 5 * 3600;
export const WEEK_SEC = 7 * 86400;
export const MODEL_NAME = {S: 'Sonnet', H: 'Haiku', O: 'Opus'};
export const MODEL_KEYS = ['S', 'H', 'O'];
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Valor mostrado: restante (padrão, como no OpenBot) ou usado. */
export function shown(usedPct, mode) {
    const used = Math.max(0, Math.min(100, usedPct ?? 0));
    return Math.round(mode === 'used' ? used : 100 - used);
}

/** 'ok' | 'warn' | 'crit' a partir do RESTANTE. A gravidade informada pela API só pode piorar o nível. */
export function level(usedPct, warnAt = 30, critAt = 10, severity = '') {
    let lv = 'ok';
    if (usedPct !== null && usedPct !== undefined) {
        const rem = 100 - usedPct;
        lv = rem <= critAt ? 'crit' : rem <= warnAt ? 'warn' : 'ok';
    }
    const s = String(severity ?? '').toLowerCase();
    const api = s && s !== 'normal' ? (s === 'warning' ? 'warn' : 'crit') : 'ok';
    const rank = {ok: 0, warn: 1, crit: 2};
    return rank[api] > rank[lv] ? api : lv;
}

/** Tempo até o reset: 4d21h, 4h38, 40m ou "agora". */
export function countdown(seconds) {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds))
        return '';
    const s = Math.floor(seconds);
    if (s <= 0)
        return 'agora';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d >= 1)
        return `${d}d${String(h).padStart(2, '0')}h`;
    if (h >= 1)
        return `${h}h${String(m).padStart(2, '0')}`;
    return `${Math.max(1, m)}m`;
}

/** Formato legado (completo/compacto) do tempo: 4h38m, 6d11h. */
export function countdownLegacy(seconds) {
    if (seconds === null || seconds === undefined)
        return '';
    const s = Math.floor(seconds);
    if (s <= 0)
        return 'agora';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d >= 1)
        return `${d}d${h}h`;
    if (h >= 1)
        return `${h}h${String(m).padStart(2, '0')}m`;
    return `${Math.max(1, m)}m`;
}

/**
 * Ritmo da janela. elapsed = quanto da janela já passou; ratio = (usado) / (esperado se uniforme).
 * runsOut: no ritmo atual a cota acaba antes do reset. É uma projeção linear (estimativa).
 */
export function pace({usedPct, resetAtMs, windowSec, nowMs}) {
    if (usedPct === null || usedPct === undefined || !resetAtMs)
        return null;
    const total = windowSec * 1000;
    const startMs = resetAtMs - total;
    const elapsed = Math.max(0, Math.min(1, (nowMs - startMs) / total));
    const expectedUsed = elapsed * 100;
    if (elapsed < 0.02)  // início da janela: pouca base para projetar
        return {elapsed, expectedUsed, ratio: null, runsOut: false, emptyInSec: null};
    const ratio = expectedUsed > 0 ? usedPct / expectedUsed : null;
    let emptyInSec = null;
    if (usedPct > 0) {
        const ratePerSec = usedPct / (elapsed * windowSec);
        emptyInSec = (100 - usedPct) / ratePerSec;
    }
    const remainingSec = (resetAtMs - nowMs) / 1000;
    const runsOut = emptyInSec !== null && emptyInSec < remainingSec && ratio !== null && ratio > 1;
    return {elapsed, expectedUsed, ratio, runsOut, emptyInSec};
}

/** ▲ quando o ritmo passa de 1,2× e a projeção acaba antes do reset. */
export function paceAlert(p, threshold = 1.2) {
    return !!p && p.ratio !== null && p.ratio >= threshold && p.runsOut;
}

export function paceText(p) {
    if (!p || p.ratio === null)
        return '';
    return `${p.ratio.toFixed(1).replace('.', ',')}× o ritmo`;
}

export function fmtTokens(n) {
    const v = Math.max(0, Math.round(n ?? 0));
    if (v >= 1e6)
        return `${(v / 1e6).toFixed(1).replace('.', ',')} M`;
    if (v >= 1e3)
        return `${Math.round(v / 1e3)} mil`;
    return String(v);
}

export function agoLabel(generatedAtMs, nowMs) {
    if (!generatedAtMs)
        return '';
    const s = Math.max(0, (nowMs - generatedAtMs) / 1000);
    if (s < 45)
        return 'atualizado agora';
    if (s < 3600)
        return `atualizado há ${Math.max(1, Math.round(s / 60))} min`;
    return `atualizado há ${Math.round(s / 3600)} h`;
}

export function planLabel(plan) {
    const p = String(plan ?? 'unknown').toLowerCase();
    if (p.startsWith('max'))
        return 'Max';
    if (p.startsWith('pro'))
        return 'Pro';
    if (p === 'free')
        return 'Free';
    if (p.includes('api'))
        return 'API';
    return p === 'unknown' ? '?' : plan;
}

// ---- consumo por modelo / agentes ----

export function slotLabel(slot, kind) {
    const d = new Date(slot.t * 1000);
    if (kind === 'week')
        return `${WEEKDAY[d.getDay()]} ${d.getDate()}`;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Série acumulada por modelo (e o total) até a última janela que já aconteceu. */
export function cumulative(slots) {
    const run = {S: 0, H: 0, O: 0, T: 0};
    const series = {S: [], H: [], O: [], T: []};
    let last = -1;
    slots.forEach((s, i) => {
        if (s.future)
            return;
        last = i;
        for (const k of MODEL_KEYS)
            run[k] += s[k] ?? 0;
        run.T = run.S + run.H + run.O;
        for (const k of ['S', 'H', 'O', 'T'])
            series[k].push([i, run[k]]);
    });
    return {series, last, max: run.T, totals: {...run}};
}

/** Linhas do modo lista: por modelo, partes do Claude Code e do OpenBot, e a participação de cada origem. */
export function modelRows(models) {
    const rows = [];
    let cc = 0, ob = 0;
    for (const k of MODEL_KEYS) {
        const m = models?.[k];
        if (!m)
            continue;
        const total = m.cc + m.ob;
        if (total <= 0)
            continue;
        rows.push({key: k, name: MODEL_NAME[k], cc: m.cc, ob: m.ob, total, turns: (m.cc_turns ?? 0) + (m.ob_turns ?? 0)});
        cc += m.cc;
        ob += m.ob;
    }
    rows.sort((a, b) => b.total - a.total);
    const t = cc + ob;
    return {rows, max: rows[0]?.total ?? 0, ccShare: t ? cc / t : 0, obShare: t ? ob / t : 0, total: t};
}

/** Agentes: os `n` maiores para a lista e todos (com "Outros") para a rosca. */
export function agentsView(agents, n = 4) {
    const list = [...(agents ?? [])].sort((a, b) => b.tokens - a.tokens);
    const total = list.reduce((s, a) => s + a.tokens, 0);
    const top = list.slice(0, n);
    const donutTop = list.slice(0, 5);
    const rest = list.slice(5).reduce((s, a) => s + a.tokens, 0);
    const donut = rest > 0 ? [...donutTop, {name: 'Outros', tokens: rest, turns: 0}] : donutTop;
    return {top, donut, total, max: top[0]?.tokens ?? 0};
}

// ---- texto da barra no formato "anéis" ----

/** Dados de cada anel da barra (a interface desenha o anel e escreve o texto). */
export function barRings({session, week, cfg, nowMs}) {
    const mk = (w, windowSec) => {
        if (!w || w.pct === null || w.pct === undefined)
            return {empty: true};
        const resetMs = w.reset_at ? new Date(w.reset_at).getTime() : 0;
        const p = pace({usedPct: w.pct, resetAtMs: resetMs, windowSec, nowMs});
        return {
            empty: false,
            value: shown(w.pct, cfg.valueMode),
            ringFrac: cfg.valueMode === 'used' ? w.pct / 100 : (100 - w.pct) / 100,
            level: level(w.pct, cfg.warnAt, cfg.critAt, w.severity),
            alert: cfg.showPace && paceAlert(p),
            reset: cfg.showReset && resetMs ? countdown((resetMs - nowMs) / 1000) : '',
        };
    };
    return [mk(session, SESSION_SEC), mk(week, WEEK_SEC)];
}

/** Textos dos formatos antigos da barra (completo, compacto, barras). */
export function legacyBar({session, week, cfg, nowMs}) {
    const spark = (pct, len = 5) => {
        const filled = Math.round(Math.max(0, Math.min(1, (pct ?? 0) / 100)) * len);
        return '▓'.repeat(filled) + '░'.repeat(len - filled);
    };
    const bit = (prefix, w) => {
        if (!w || w.pct === null || w.pct === undefined)
            return `${prefix} —`;
        const val = `${shown(w.pct, cfg.valueMode)}%`;
        if (cfg.format === 'spark')
            return `${spark(cfg.valueMode === 'used' ? w.pct : 100 - w.pct)} ${val}`;
        if (cfg.format === 'compact')
            return `${prefix} ${val}`;
        const cd = w.reset_at ? ` ${countdownLegacy((new Date(w.reset_at).getTime() - nowMs) / 1000)}` : '';
        return `${prefix} ${val}${cd}`;
    };
    return `${bit('S', session)} · ${bit('W', week)}`;
}

export function worstLevel(levels) {
    return levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : 'ok';
}

/** Limites coerentes: crítico sempre abaixo do atenção. */
export function clampThresholds(warn, crit) {
    let w = Math.max(5, Math.min(95, Math.round(warn)));
    let c = Math.max(5, Math.min(95, Math.round(crit)));
    if (c >= w)
        c = Math.max(5, w - 5);
    if (c >= w)
        w = c + 5;
    return {warn: w, crit: c};
}

// ---------------------------------------------------------------------------
// Ticker: manda uma mensagem mínima no horário combinado para iniciar a sessão de 5 h.
// ---------------------------------------------------------------------------
export const TICKER_GRACE_SEC = 2 * 3600;   // modo "uma vez por dia": ainda recupera depois do horário (PC desligado)
export const TICKER_RETRY_SEC = 30 * 60;    // espera entre tentativas que falharam
export const TICKER_REFIRE_SEC = 60 * 60;   // depois de um disparo, não repete antes disto (evita laço se a janela não abrir)

/** "06:30" -> {h: 6, m: 30}; inválido -> null. */
export function parseClock(text) {
    const mt = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
    if (!mt)
        return null;
    const h = Number(mt[1]), m = Number(mt[2]);
    return h <= 23 && m <= 59 ? {h, m} : null;
}

/** Instante (ms) de um horário no dia local de `nowMs`. */
export function tickerSlotMs(nowMs, clock) {
    const d = new Date(nowMs);
    d.setHours(clock.h, clock.m, 0, 0);
    return d.getTime();
}

/**
 * Decide se é hora de iniciar a sessão. Só dispara com dados frescos e sem sessão ativa, para nunca gastar cota
 * à toa. Devolve {fire, reason}; reason: off | day | early | late | done | nodata | active | weekfull | broken | retry | go.
 * Contínuo: do horário inicial até o final, sempre que a sessão acaba, abre outra. Senão, uma vez por dia.
 */
export function tickerDecision({nowMs, cfg, data, lastFiredMs = 0, lastAttemptMs = 0, strikes = 0}) {
    const no = reason => ({fire: false, reason});
    const clock = parseClock(cfg?.time);
    if (!cfg?.enabled || !clock)
        return no('off');
    if (!(cfg.days ?? []).includes(new Date(nowMs).getDay()))
        return no('day');
    const slot = tickerSlotMs(nowMs, clock);
    if (nowMs < slot)
        return no('early');
    const until = cfg.continuous ? parseClock(cfg.until) : null;
    const end = until ? tickerSlotMs(nowMs, until) : slot + TICKER_GRACE_SEC * 1000;
    if (nowMs > end)
        return no('late');
    if (!cfg.continuous && lastFiredMs >= slot)
        return no('done');
    if (!data?.has_credentials || data.token_expired || !data.api_source || data.stale)
        return no('nodata');
    const resetMs = data.session?.reset_at ? new Date(data.session.reset_at).getTime() : 0;
    if (resetMs > nowMs)
        return no('active');
    if ((data.week?.pct ?? 0) >= 100)
        return no('weekfull');
    if (strikes >= 1)   // o disparo anterior não abriu a janela: não insiste (só volta depois que houver sessão ativa)
        return no('broken');
    if (nowMs - lastAttemptMs < TICKER_RETRY_SEC * 1000 || nowMs - lastFiredMs < TICKER_REFIRE_SEC * 1000)
        return no('retry');
    return {fire: true, reason: 'go'};
}
