/* Painel de Previsão de Pagamentos — interface (JS puro, sem dependências) */
(() => {
  'use strict';

  // ---------- Formatação ----------
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const num1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const dmy = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const dm = (s) => dmy(s).slice(0, 5);
  const isoDe = (ms) => new Date(ms).toISOString().slice(0, 10);
  const msDe = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const hojeISO = () => { const t = new Date(); return isoDe(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())); };
  const addDias = (iso, n) => isoDe(msDe(iso) + n * 86400000);
  const compacto = (v) => (Math.abs(v) >= 1e6 ? `R$ ${num1.format(v / 1e6)} mi` : Math.abs(v) >= 1e3 ? `R$ ${num1.format(v / 1e3)} mil` : `R$ ${Math.round(v)}`);
  const $ = (sel) => document.querySelector(sel);
  const h = (tag, attrs = {}, ...filhos) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f != null) el.append(f instanceof Node ? f : String(f));
    return el;
  };
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  // ---------- Faixas, natureza, agrupamentos ----------
  const FAIXAS = [
    { k: 'd0_7', nome: '0–7 dias', cor: 'var(--c-d0_7)' },
    { k: 'd8_14', nome: '8–14 dias', cor: 'var(--c-d8_14)' },
    { k: 'd15', nome: '15+ dias', cor: 'var(--c-d15)' },
  ];
  const FX = Object.fromEntries(FAIXAS.map((f) => [f.k, f]));
  const faixaDe = (dias) => (dias <= 7 ? 'd0_7' : dias <= 14 ? 'd8_14' : 'd15');

  const naturezaDe = (r) => {
    const cat = String(r.cat_cod || '');
    if (cat.startsWith('TRB')) return 'Impostos retidos';
    if (cat === 'MOD0003') return 'Encargos (FGTS)';
    if (/^EC\d{3}\b/.test(String(r.fornecedor || ''))) return 'Rateio interno (centros EC)';
    return 'Fornecedores e despesas';
  };
  const empresaRot = (r) => `${r.empresa} · ${r.empresa_desc || 'sem descrição'}`;
  const obraRot = (r) => `${r.obra} · ${r.obra_desc || 'sem descrição'}`;
  const DIMS = {
    fornecedor: (r) => r.fornecedor,
    favorecido: (r) => r.favorecido,
    empresa: empresaRot,
    obra: obraRot,
    planejamento: (r) => r.planejamento,
    insumo: (r) => r.insumo,
    item: (r) => r.item_desc,
    categoria: (r) => r.categoria,
    natureza: (r) => r._natureza,
    conta: (r) => [r.conta, r.conta_desc].filter(Boolean).join(' · '),
    mes_pl: (r) => (r.mes_pl ? String(r.mes_pl).slice(0, 7).split('-').reverse().join('/') : null),
    forma: (r) => r.forma_pag,
    aprovacao: (r) => (Number(r.conf_emissao) === 1 ? 'ConfEmissao = 1' : 'ConfEmissao = 0'),
  };
  const grupoDe = (dim, r) => { const v = DIMS[dim](r); return v == null || v === '' ? '(vazio)' : String(v); };

  // ---------- Estado ----------
  const salvo = (() => { try { return JSON.parse(localStorage.getItem('pp-filtros') || '{}'); } catch { return {}; } })();
  const S = {
    linhas: [],
    ref: hojeISO(),
    empresas: salvo.empresas ? new Set(salvo.empresas) : null, // null = todas
    obras: salvo.obras ? new Set(salvo.obras) : null,
    dim: salvo.dim || 'fornecedor',
    faixa: ['d0_7', 'd8_14', 'd15'].includes(salvo.faixa) ? salvo.faixa : 'todas',
    sel: null,
    busca: '',
    ordem: { col: 'pagamento', dir: 1 },
    verTodos: false,
    alertaTipo: null,
    meta: null,
  };
  const guardar = () => {
    try {
      localStorage.setItem('pp-filtros', JSON.stringify({
        empresas: S.empresas ? [...S.empresas] : null, obras: S.obras ? [...S.obras] : null, dim: S.dim, faixa: S.faixa,
      }));
    } catch { /* armazenamento indisponível: segue sem lembrar */ }
  };

  const prepararLinhas = () => {
    S.linhas.forEach((r, i) => {
      r._i = i;
      r._valor = Number(r.valor_liquido) || 0;
      r._dias = Math.round((msDe(r.pagamento) - msDe(S.ref)) / 86400000);
      r._faixa = faixaDe(r._dias);
      r._natureza = naturezaDe(r);
      r._empresa = String(r.empresa);
      r._obra = `${r.empresa}|${r.obra}`;
      r._parcela = `${r.empresa}|${r.obra}|${r.processo}|${r.parcela}`;
    });
  };

  // Linhas após filtro de empresa/obra
  const base = () => S.linhas.filter((r) => (!S.empresas || S.empresas.has(r._empresa)) && (!S.obras || S.obras.has(r._obra)));
  // Linhas após horizonte + barra selecionada + busca (lista de parcelas)
  const lista = (rows) => {
    const q = S.busca.trim().toLowerCase();
    return rows.filter((r) => (S.faixa === 'todas' || r._faixa === S.faixa)
      && (!S.sel || grupoDe(S.dim, r) === S.sel)
      && (!q || [r.obra, r.obra_desc, r.processo, r.fornecedor, r.favorecido, r.planejamento, r.insumo, r.historico, r.doc_fiscal]
        .join(' ').toLowerCase().includes(q)));
  };
  const soma = (rows) => rows.reduce((s, r) => s + r._valor, 0);

  // ---------- Tooltip ----------
  const tip = $('#tip');
  const mostrarTip = (ev, titulo, linhas) => {
    tip.replaceChildren(h('div', { class: 't' }, titulo), ...linhas.map(([cor, txt]) => h('div', {}, cor ? h('span', { class: 'sw', style: `background:${cor}` }) : null, txt)));
    tip.style.display = 'block';
    const w = tip.offsetWidth, hh = tip.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + hh > window.innerHeight - 8) y = ev.clientY - hh - 14;
    tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
  };
  const esconderTip = () => { tip.style.display = 'none'; };

  // ---------- Filtro multi-seleção ----------
  function multiSelect(raiz, { rotulo, plural, opcoes, selecionados, aoMudar }) {
    const pop = h('div', { class: 'ms-pop', hidden: true });
    const botao = h('button', { class: 'ms-btn', type: 'button', 'aria-haspopup': 'listbox' });
    raiz.replaceChildren(botao, pop);
    let busca = '';
    const desenharBotao = () => {
      const ops = opcoes(), sel = selecionados();
      let val = `Todas`;
      if (sel) val = sel.size === 0 ? 'Nenhuma' : sel.size === 1 ? (ops.find((o) => sel.has(o.valor))?.rotulo || [...sel][0]) : `${sel.size} ${plural}`;
      botao.replaceChildren(h('span', { class: 'rot' }, rotulo), h('span', { class: 'val' }, val));
      raiz.classList.toggle('ativo', !!sel);
    };
    const desenharPop = () => {
      const ops = opcoes(), sel = selecionados();
      const vis = ops.filter((o) => !busca || o.rotulo.toLowerCase().includes(busca));
      const campo = h('input', { type: 'search', placeholder: `Buscar ${rotulo.toLowerCase()}…`, value: busca });
      campo.addEventListener('input', () => { busca = campo.value.trim().toLowerCase(); desenharPop(); const c = pop.querySelector('input[type=search]'); c.focus(); c.setSelectionRange(c.value.length, c.value.length); });
      const lista = h('div', { class: 'ms-lista', role: 'listbox', 'aria-multiselectable': 'true' },
        vis.length ? vis.map((o) => {
          const marcado = !sel || sel.has(o.valor);
          const cb = h('input', { type: 'checkbox', checked: marcado });
          cb.addEventListener('change', () => {
            const atual = new Set(sel || ops.map((x) => x.valor));
            if (cb.checked) atual.add(o.valor); else atual.delete(o.valor);
            aoMudar(atual.size === ops.length ? null : atual);
          });
          return h('label', { class: 'ms-op' }, cb, h('span', { class: 'txt', title: o.rotulo }, o.rotulo), h('span', { class: 'qtd' }, `${o.n} · ${compacto(o.valor_total)}`));
        }) : h('div', { class: 'ms-vazio' }, 'Nada encontrado'));
      const acoes = h('div', { class: 'ms-acoes' },
        h('button', { class: 'btn btn-link', type: 'button', onclick: () => aoMudar(null) }, 'Marcar todas'),
        h('button', { class: 'btn btn-link', type: 'button', onclick: () => aoMudar(new Set()) }, 'Desmarcar todas'),
        busca && vis.length ? h('button', { class: 'btn btn-link', type: 'button', onclick: () => aoMudar(new Set(vis.map((o) => o.valor))) }, 'Só as encontradas') : null);
      pop.replaceChildren(campo, acoes, lista);
    };
    botao.addEventListener('click', () => {
      const abrir = pop.hidden;
      document.querySelectorAll('.ms-pop').forEach((p) => { p.hidden = true; });
      pop.hidden = !abrir;
      if (abrir) { busca = ''; desenharPop(); pop.querySelector('input').focus(); }
    });
    document.addEventListener('click', (ev) => { if (!ev.composedPath().includes(raiz)) pop.hidden = true; });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') pop.hidden = true; });
    return { atualizar: () => { desenharBotao(); if (!pop.hidden) desenharPop(); } };
  }

  const opcoesEmpresa = () => {
    const m = new Map();
    for (const r of S.linhas) {
      const o = m.get(r._empresa) || { valor: r._empresa, rotulo: empresaRot(r), n: 0, valor_total: 0 };
      o.n += 1; o.valor_total += r._valor; m.set(r._empresa, o);
    }
    return [...m.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true }));
  };
  const opcoesObra = () => {
    const m = new Map();
    for (const r of S.linhas) {
      if (S.empresas && !S.empresas.has(r._empresa)) continue;
      const rot = (S.empresas && S.empresas.size === 1) ? obraRot(r) : `${obraRot(r)} (emp. ${r.empresa})`;
      const o = m.get(r._obra) || { valor: r._obra, rotulo: rot, n: 0, valor_total: 0 };
      o.n += 1; o.valor_total += r._valor; m.set(r._obra, o);
    }
    return [...m.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true }));
  };

  const fEmpresa = multiSelect($('#f-empresa'), {
    rotulo: 'Empresa', plural: 'empresas', opcoes: opcoesEmpresa, selecionados: () => S.empresas,
    aoMudar: (sel) => { S.empresas = sel; podarObras(); S.sel = null; guardar(); desenhar(); },
  });
  const fObra = multiSelect($('#f-obra'), {
    rotulo: 'Obra', plural: 'obras', opcoes: opcoesObra, selecionados: () => S.obras,
    aoMudar: (sel) => { S.obras = sel; S.sel = null; guardar(); desenhar(); },
  });
  // Ao trocar empresas, mantém só obras que ainda existem nelas
  function podarObras() {
    if (!S.obras) return;
    const validas = new Set(opcoesObra().map((o) => o.valor));
    S.obras = new Set([...S.obras].filter((v) => validas.has(v)));
    if (S.obras.size === validas.size) S.obras = null;
  }
  // Seleções salvas que não existem mais nos dados voltam a "todas"
  function validarSelecoes() {
    const emp = new Set(opcoesEmpresa().map((o) => o.valor));
    if (S.empresas && ![...S.empresas].some((v) => emp.has(v))) S.empresas = null;
    const obr = new Set(opcoesObra().map((o) => o.valor));
    if (S.obras && ![...S.obras].some((v) => obr.has(v))) S.obras = null;
  }

  // ---------- Desenho ----------
  function desenhar() {
    esconderTip();
    const rows = base();
    fEmpresa.atualizar(); fObra.atualizar();
    $('#limpar').hidden = !S.empresas && !S.obras;
    desenharKpis(rows);
    desenharResumo(rows);
    desenharAgenda(rows);
    desenharBarras($('#natureza'), rows, 'natureza', 'todas', false, Infinity);
    desenharChips(rows);
    desenharGrupos(rows);
    desenharTabela(rows);
    desenharAlertas(rows);
  }

  function totaisFaixa(rows) {
    const t = Object.fromEntries(FAIXAS.map((f) => [f.k, { n: 0, v: 0 }]));
    const vistos = Object.fromEntries(FAIXAS.map((f) => [f.k, new Set()]));
    for (const r of rows) { vistos[r._faixa].add(r._parcela); t[r._faixa].v += r._valor; }
    for (const f of FAIXAS) t[f.k].n = vistos[f.k].size;
    return t;
  }

  function desenharKpis(rows) {
    const t = totaisFaixa(rows);
    const total = { n: new Set(rows.map((r) => r._parcela)).size, v: soma(rows) };
    const win = {
      total: `a partir de ${dm(S.ref)}`,
      d0_7: `${dm(S.ref)} a ${dm(addDias(S.ref, 7))}`,
      d8_14: `${dm(addDias(S.ref, 8))} a ${dm(addDias(S.ref, 14))}`,
      d15: `a partir de ${dm(addDias(S.ref, 15))}`,
    };
    document.querySelectorAll('.kpi').forEach((card) => {
      const k = card.dataset.k;
      const v = k === 'total' ? total : t[k];
      card.querySelector('.kpi-win').textContent = win[k];
      card.querySelector('.kpi-val').textContent = brl.format(v.v);
      card.querySelector('.kpi-n').textContent = `${v.n} ${v.n === 1 ? 'parcela' : 'parcelas'}`;
      card.classList.toggle('sel', S.faixa === k);
    });
    const ate14 = t.d0_7.v + t.d8_14.v;
    $('#strip').replaceChildren(
      h('span', {}, 'Até 14 dias (acumulado): ', h('b', {}, brl.format(ate14))),
      h('span', {}, 'Valores líquidos (parcela + acréscimo − desconto)'),
    );
  }

  function desenharResumo(rows) {
    const el = $('#resumo');
    if (!rows.length) { el.textContent = 'Nenhuma parcela para os filtros escolhidos.'; return; }
    const prox = rows.filter((r) => r._faixa === 'd0_7');
    const partes = [];
    if (prox.length) {
      const tot = soma(prox);
      const maior = prox.reduce((a, r) => (r._valor > a._valor ? r : a));
      const share = tot ? (maior._valor / tot) * 100 : 0;
      partes.push('Nos próximos 7 dias saem ', h('b', {}, brl.format(tot)), ` em ${prox.length} ${prox.length === 1 ? 'parcela' : 'parcelas'}`);
      if (prox.length > 1 && share >= 40) partes.push('; ', h('b', {}, `${num1.format(share)}%`), ` disso é um único pagamento a ${maior.fornecedor} (obra ${maior.obra}, processo ${maior.processo})`);
      partes.push('. ');
    } else partes.push('Nada previsto para os próximos 7 dias. ');
    partes.push('No total, ', h('b', {}, brl.format(soma(rows))), ` a pagar de ${dmy(S.ref)} em diante.`);
    el.replaceChildren(...partes);
  }

  function desenharAgenda(rows) {
    const box = $('#agenda');
    const DIAS = 30;
    const porDia = new Map();
    for (const r of rows) {
      if (r._dias > DIAS) continue;
      const d = porDia.get(r._dias) || { dias: r._dias, data: String(r.pagamento).slice(0, 10), v: 0, n: 0 };
      d.v += r._valor; d.n += 1; porDia.set(r._dias, d);
    }
    const alem = rows.filter((r) => r._dias > DIAS);
    $('#agenda-extra').textContent = alem.length ? `Além disso, ${brl.format(soma(alem))} em ${alem.length} parcelas depois de ${dmy(addDias(S.ref, DIAS))}.` : '';
    const dados = [...porDia.values()];
    if (!dados.length) { box.replaceChildren(h('div', { class: 'vazio' }, 'Nenhum pagamento previsto nos próximos 30 dias.')); return; }

    const W = Math.max(320, box.clientWidth || 640), H = 260, base = H - 28, topo = 16;
    const max = Math.max(...dados.map((d) => d.v));
    const passo = Math.pow(10, Math.floor(Math.log10(max)));
    const teto = Math.ceil(max / passo) * passo;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * teto);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Agenda de pagamentos dos próximos 30 dias' });
    box.replaceChildren(s);
    // margem esquerda medida pelo maior rótulo
    const prova = svg('text', { 'font-size': 11 }); prova.textContent = compacto(teto); s.append(prova);
    const esq = prova.getComputedTextLength() + 12; prova.remove();
    const larg = (W - esq - 4) / (DIAS + 1);
    const x = (d) => esq + d * larg;
    const y = (v) => base - (v / teto) * (base - topo);
    for (const t of ticks) {
      s.append(svg('line', { x1: esq, x2: W - 4, y1: y(t), y2: y(t), stroke: 'var(--grid)' }));
      const tx = svg('text', { x: esq - 8, y: y(t), dy: '0.32em', 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }); tx.textContent = compacto(t); s.append(tx);
    }
    const cada = Math.max(1, Math.ceil(44 / larg));
    for (let d = 0; d <= DIAS; d += cada) {
      const tx = svg('text', { x: x(d) + larg / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' });
      tx.textContent = d === 0 && S.ref === hojeISO() ? 'hoje' : dm(addDias(S.ref, d)); s.append(tx);
    }
    for (const [lim, rot] of [[8, '7 dias'], [15, '14 dias']]) {
      const xx = x(lim);
      s.append(svg('line', { x1: xx, x2: xx, y1: topo - 6, y2: base, stroke: 'var(--muted)', 'stroke-dasharray': '4 4', opacity: '.6' }));
      const tx = svg('text', { x: xx - 5, y: topo - 2, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }); tx.textContent = rot; s.append(tx);
    }
    s.append(svg('line', { x1: esq, x2: W - 4, y1: base, y2: base, stroke: 'var(--line)' }));
    const bw = Math.max(3, Math.min(28, larg * 0.72));
    for (const d of dados) {
      const hgt = Math.max(3, base - y(d.v));
      const r = svg('rect', { x: x(d.dias) + (larg - bw) / 2, y: base - hgt, width: bw, height: hgt, rx: 4, style: `fill:${FX[faixaDe(d.dias)].cor}` });
      r.addEventListener('mousemove', (ev) => mostrarTip(ev, `${dmy(d.data)} — ${d.dias === 0 ? 'hoje' : `em ${d.dias} dia${d.dias > 1 ? 's' : ''}`}`, [[FX[faixaDe(d.dias)].cor, `${brl.format(d.v)} · ${d.n} ${d.n === 1 ? 'parcela' : 'parcelas'}`]]));
      r.addEventListener('mouseleave', esconderTip);
      s.append(r);
    }
  }

  function agrupar(rows, dim) {
    const m = new Map();
    for (const r of rows) {
      const g = grupoDe(dim, r);
      const o = m.get(g) || { grupo: g, n: 0, v: 0, fx: Object.fromEntries(FAIXAS.map((f) => [f.k, { n: 0, v: 0 }])) };
      o.n += 1; o.v += r._valor; o.fx[r._faixa].n += 1; o.fx[r._faixa].v += r._valor; m.set(g, o);
    }
    return [...m.values()];
  }

  function desenharBarras(el, rows, dim, faixa, clicavel, limite) {
    let grupos = agrupar(rows, dim).map((g) => (faixa === 'todas' ? g : { ...g, n: g.fx[faixa].n, v: g.fx[faixa].v })).filter((g) => g.n > 0);
    grupos.sort((a, b) => b.v - a.v);
    const total = grupos.length;
    if (grupos.length > limite) {
      const resto = grupos.slice(limite);
      const outros = { grupo: `Outros (${resto.length})`, n: 0, v: 0, outros: true, fx: Object.fromEntries(FAIXAS.map((f) => [f.k, { n: 0, v: 0 }])) };
      for (const g of resto) { outros.n += g.n; outros.v += g.v; for (const f of FAIXAS) { outros.fx[f.k].n += g.fx[f.k].n; outros.fx[f.k].v += g.fx[f.k].v; } }
      grupos = [...grupos.slice(0, limite), outros];
    }
    if (!grupos.length) { el.replaceChildren(h('div', { class: 'vazio' }, 'Nenhuma parcela nesse horizonte.')); return total; }
    const max = Math.max(...grupos.map((g) => g.v), 1);
    el.replaceChildren(...grupos.map((g) => {
      const segs = (faixa === 'todas' ? FAIXAS : [FX[faixa]]).filter((f) => g.fx[f.k].n > 0).map((f) => {
        const s = h('div', { class: 'seg', style: `width:${(g.fx[f.k].v / max) * 100}%;background:${f.cor}` });
        s.addEventListener('mousemove', (ev) => mostrarTip(ev, g.grupo, [[f.cor, `${f.nome}: ${brl.format(g.fx[f.k].v)} (${g.fx[f.k].n})`]]));
        s.addEventListener('mouseleave', esconderTip);
        return s;
      });
      const pode = clicavel && !g.outros;
      return h('div', {
        class: `linha${pode ? ' clica' : ''}${pode && S.sel === g.grupo ? ' sel' : ''}`,
        onclick: pode ? () => { S.sel = S.sel === g.grupo ? null : g.grupo; desenhar(); } : null,
      },
      h('div', { class: 'top' }, h('span', { class: 'nm', title: g.grupo }, g.grupo), h('span', { class: 'vl' }, h('b', {}, brl.format(g.v)), ` · ${g.n}`)),
      h('div', { class: 'trilho' }, segs));
    }));
    return total;
  }

  function desenharChips(rows) {
    const t = totaisFaixa(rows);
    $('#chips').replaceChildren(...[{ k: 'todas', nome: 'Todos os horizontes' }, ...FAIXAS].map((f) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(S.faixa === f.k),
      onclick: () => { S.faixa = f.k; S.sel = null; guardar(); desenhar(); },
    }, f.cor ? h('span', { class: 'sw', style: `background:${f.cor}` }) : null, f.nome, f.cor ? h('span', { class: 'n' }, t[f.k].n) : null)));
    $('#legenda').replaceChildren(...FAIXAS.map((f) => h('span', {}, h('i', { style: `background:${f.cor}` }), f.nome)));
  }

  function desenharGrupos(rows) {
    $('#dim').value = S.dim;
    const limite = S.verTodos ? Infinity : 15;
    const total = desenharBarras($('#grupos'), rows, S.dim, S.faixa, true, limite);
    const btn = $('#ver-todos');
    btn.hidden = total <= 15;
    btn.textContent = S.verTodos ? 'Mostrar só os 15 maiores' : `Ver todos os ${total} grupos`;
  }

  const LIMITE_TABELA = 500;
  function desenharTabela(rows) {
    const sel = lista(rows);
    const { col, dir } = S.ordem;
    const val = (r) => (['processo', 'valor_liquido', '_dias'].includes(col) ? Number(r[col]) : col === '_faixa' ? r._dias : String(r[col] ?? '').toLowerCase());
    sel.sort((a, b) => { const A = val(a), B = val(b); return (A < B ? -1 : A > B ? 1 : a._i - b._i) * dir; });
    document.querySelectorAll('#tabela th').forEach((th) => th.setAttribute('aria-sort', th.dataset.col === col ? (dir > 0 ? 'ascending' : 'descending') : 'none'));
    const mostrar = sel.slice(0, LIMITE_TABELA);
    $('#tabela tbody').replaceChildren(...(mostrar.length ? mostrar.map((r) => h('tr', {},
      h('td', { class: 'obra' }, r.obra, h('small', { title: r.obra_desc || '' }, r.obra_desc || '')),
      h('td', { class: 'num' }, `${r.processo}${Number(r.parcela) > 1 ? `/${r.parcela}` : ''}`),
      h('td', {}, dmy(r.pagamento)),
      h('td', { class: 'num' }, r._dias),
      h('td', {}, h('span', { class: 'hz' }, h('i', { style: `background:${FX[r._faixa].cor}` }), FX[r._faixa].nome)),
      h('td', { class: 'corta', title: r.fornecedor || '' }, r.fornecedor || ''),
      h('td', { class: 'corta opc', title: r.favorecido || '' }, r.favorecido || ''),
      h('td', { class: 'opc' }, r.planejamento || ''),
      h('td', { class: 'corta opc', title: r.insumo || '' }, r.insumo || ''),
      h('td', { class: 'num' }, brl.format(r._valor)),
      h('td', { class: 'hist opc' }, r.historico || ''),
    )) : [h('tr', {}, h('td', { colspan: 11, class: 'vazio' }, 'Nenhuma parcela com esses filtros.'))]));
    const filtros = [S.faixa !== 'todas' ? FX[S.faixa].nome : null, S.sel ? `“${S.sel}”` : null, S.busca ? `busca “${S.busca}”` : null].filter(Boolean);
    $('#tab-info').textContent = `${sel.length} de ${rows.length} linhas · ${brl.format(soma(sel))}${filtros.length ? ` · ${filtros.join(' · ')}` : ''}`;
    $('#tab-limite').textContent = sel.length > LIMITE_TABELA ? `Mostrando as primeiras ${LIMITE_TABELA}. Use a busca ou os filtros para refinar, ou exporte o CSV com todas.` : '';
    const pill = $('#sel-pill');
    pill.hidden = !S.sel;
    pill.textContent = S.sel ? `${S.sel} ×` : '';
  }

  function calcularAlertas(rows) {
    const out = [];
    const br = (v) => v.toFixed(2).replace('.', ',');
    const dif = (a, b) => (a && b ? Math.round((msDe(a) - msDe(b)) / 86400000) : 0);
    const add = (r, tipo, detalhe) => out.push({ r, tipo, detalhe });
    for (const r of rows) {
      const aliq = Number(r.aliquota), nf = Number(r.valor_nf), v = Number(r.valor_parcela);
      if (aliq > 0 && nf > 0) {
        const esperado = Math.round(nf * aliq) / 100;
        if (Math.abs(esperado - v) > 0.02) add(r, 'Retenção ≠ NF × alíquota', `Retido ${br(v)}; NF ${br(nf)} × ${br(aliq)}% = ${br(esperado)}`);
      }
      const atraso = dif(r.pagamento, r.vencimento);
      if (atraso > 0) add(r, 'Pagamento depois do vencimento', `${atraso} dia(s) após vencer${Number(r.acrescimo) > 0 ? `; acréscimo de ${br(Number(r.acrescimo))}` : ''}`);
      const aprov = dif(r.dt_aprovacao, r.vencimento);
      if (aprov > 0) add(r, 'Aprovado depois do vencimento', `Aprovado${r.aprovado_por ? ` por ${r.aprovado_por}` : ''} ${aprov} dia(s) após vencer`);
    }
    const guias = new Map();
    for (const r of rows) if (r.cod_barras) guias.set(r.cod_barras, [...(guias.get(r.cod_barras) || []), r]);
    for (const ps of guias.values()) {
      const procs = [...new Set(ps.map((p) => `${p.obra}/${p.processo}`))];
      if (procs.length > 1) for (const r of ps) add(r, 'Mesma guia de outras parcelas', `Código de barras de ${procs.length} processos: ${procs.join(', ')}`);
    }
    return out;
  }

  const LIMITE_ALERTAS = 300;
  function desenharAlertas(rows) {
    const todos = calcularAlertas(rows);
    const tipos = new Map();
    for (const a of todos) tipos.set(a.tipo, (tipos.get(a.tipo) || 0) + 1);
    if (S.alertaTipo && !tipos.has(S.alertaTipo)) S.alertaTipo = null;
    $('#alerta-chips').replaceChildren(
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!S.alertaTipo), onclick: () => { S.alertaTipo = null; desenharAlertas(base()); } }, 'Todos', h('span', { class: 'n' }, todos.length)),
      ...[...tipos].map(([t, n]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.alertaTipo === t), onclick: () => { S.alertaTipo = t; desenharAlertas(base()); } }, t, h('span', { class: 'n' }, n))),
    );
    const sel = todos.filter((a) => !S.alertaTipo || a.tipo === S.alertaTipo).sort((a, b) => a.tipo.localeCompare(b.tipo) || b.r._valor - a.r._valor);
    const mostrar = sel.slice(0, LIMITE_ALERTAS);
    $('#alertas tbody').replaceChildren(...(mostrar.length ? mostrar.map((a) => h('tr', {},
      h('td', { class: 'obra' }, a.r.obra),
      h('td', { class: 'num' }, a.r.processo),
      h('td', {}, a.tipo),
      h('td', { class: 'hist' }, a.detalhe),
      h('td', { class: 'num' }, brl.format(a.r._valor)),
    )) : [h('tr', {}, h('td', { colspan: 5, class: 'vazio' }, 'Nenhum ponto de atenção com esses filtros.'))]));
    $('#alerta-limite').textContent = sel.length > LIMITE_ALERTAS ? `Mostrando ${LIMITE_ALERTAS} de ${sel.length}.` : '';
  }

  // ---------- Exportar CSV ----------
  function exportar() {
    const rows = lista(base());
    const cols = [
      ['Empresa', (r) => r.empresa], ['Obra', (r) => r.obra], ['Descrição da obra', (r) => r.obra_desc], ['Processo', (r) => r.processo], ['Parcela', (r) => r.parcela],
      ['Vencimento', (r) => dmy(r.vencimento)], ['Pagamento', (r) => dmy(r.pagamento)], ['Dias', (r) => r._dias], ['Horizonte', (r) => FX[r._faixa].nome],
      ['Fornecedor', (r) => r.fornecedor], ['Favorecido', (r) => r.favorecido], ['Natureza', (r) => r._natureza], ['Planejamento', (r) => r.planejamento],
      ['Insumo', (r) => r.insumo], ['Categoria', (r) => r.categoria], ['Conta', (r) => [r.conta, r.conta_desc].filter(Boolean).join(' - ')], ['Forma de pagamento', (r) => r.forma_pag],
      ['Valor da parcela', (r) => r.valor_parcela], ['Acréscimo', (r) => r.acrescimo], ['Desconto', (r) => r.desconto], ['Valor líquido', (r) => r.valor_liquido],
      ['Documento fiscal', (r) => r.doc_fiscal], ['Histórico', (r) => r.historico],
    ];
    const cel = (v) => {
      if (v == null) return '';
      if (typeof v === 'number') return String(v).replace('.', ',');
      const s = String(v).replace(/\r?\n/g, ' ');
      return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.map((c) => c[0]).join(';'), ...rows.map((r) => cols.map(([, f]) => cel(f(r))).join(';'))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `previsao_pagamentos_${S.ref}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Comunicação com o Streamlit ----------
  // Protocolo dos componentes do Streamlit: os dados chegam pela mensagem
  // "streamlit:render" e o componente avisa a altura e o clique em Atualizar.
  const enviar = (type, extra = {}) => window.parent.postMessage({ isStreamlitMessage: true, type, ...extra }, '*');
  const aviso = $('#aviso');
  function mostrarAviso(texto, demo = false) { aviso.hidden = !texto; aviso.textContent = texto || ''; aviso.classList.toggle('demo', demo); }

  let ultimaAltura = 0;
  const ajustarAltura = () => {
    const alt = Math.ceil(document.documentElement.getBoundingClientRect().height) + 4;
    if (Math.abs(alt - ultimaAltura) > 2) { ultimaAltura = alt; enviar('streamlit:setFrameHeight', { height: alt }); }
  };
  new ResizeObserver(ajustarAltura).observe(document.body);

  function aplicarTema(tema) {
    if (!tema) return;
    const raiz = document.documentElement;
    raiz.dataset.tema = tema.base === 'dark' ? 'dark' : 'light';
    if (tema.backgroundColor) raiz.style.setProperty('--bg', tema.backgroundColor);
    if (tema.font) raiz.style.setProperty('--sans', `${tema.font}, "Segoe UI", system-ui, sans-serif`);
  }

  let versao = null;
  function receberDados(dados) {
    const btn = $('#atualizar');
    btn.disabled = false; btn.textContent = 'Atualizar';
    document.body.classList.remove('carregando');
    if (!dados) return;
    if (dados.erro) {
      mostrarAviso(`Não foi possível carregar as parcelas. ${dados.erro}`);
      if (!S.linhas.length) $('#origem').textContent = 'Sem dados';
      return;
    }
    if (dados.gerado_em === versao) return; // mesmos dados: mantém a tela como está
    versao = dados.gerado_em;
    S.linhas = dados.linhas || [];
    S.meta = dados;
    S.ref = dados.hoje || hojeISO();
    prepararLinhas();
    validarSelecoes();
    const hora = new Date(dados.gerado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    $('#origem').textContent = `${dados.total} linhas com pagamento de ${dmy(S.ref)} em diante · consultado às ${hora}`;
    mostrarAviso(dados.demo ? 'Modo demonstração: mostrando os dados de exemplo (dados/exemplo.json). Configure o banco nos secrets para ler o UAU.' : '', true);
    desenhar();
  }

  window.addEventListener('message', (ev) => {
    if (ev.data?.type !== 'streamlit:render') return;
    aplicarTema(ev.data.theme);
    receberDados(ev.data.args?.dados);
    ajustarAltura();
  });

  function pedirAtualizacao() {
    const btn = $('#atualizar');
    btn.disabled = true; btn.textContent = 'Atualizando…';
    document.body.classList.add('carregando');
    enviar('streamlit:setComponentValue', { value: { acao: 'atualizar', t: Date.now() }, dataType: 'json' });
  }

  // ---------- Eventos ----------
  $('#atualizar').addEventListener('click', pedirAtualizacao);
  $('#exportar').addEventListener('click', exportar);
  $('#limpar').addEventListener('click', () => { S.empresas = null; S.obras = null; S.sel = null; guardar(); desenhar(); });
  $('#dim').addEventListener('change', (ev) => { S.dim = ev.target.value; S.sel = null; S.verTodos = false; guardar(); desenhar(); });
  $('#ver-todos').addEventListener('click', () => { S.verTodos = !S.verTodos; desenharGrupos(base()); });
  $('#sel-pill').addEventListener('click', () => { S.sel = null; desenhar(); });
  $('#busca').addEventListener('input', (ev) => { S.busca = ev.target.value; desenharTabela(base()); });
  document.querySelectorAll('.kpi:not([data-k=total])').forEach((card) => card.addEventListener('click', () => {
    S.faixa = S.faixa === card.dataset.k ? 'todas' : card.dataset.k; S.sel = null; guardar(); desenhar();
    $('#agrupamento').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('#tabela th').forEach((th) => th.addEventListener('click', () => {
    const c = th.dataset.col;
    S.ordem = S.ordem.col === c ? { col: c, dir: -S.ordem.dir } : { col: c, dir: 1 };
    desenharTabela(base());
  }));
  let espera;
  window.addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(() => desenharAgenda(base()), 150); });

  // ---------- Início ----------
  enviar('streamlit:componentReady', { apiVersion: 1 });
})();
