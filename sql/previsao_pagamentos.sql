/* =====================================================================
   Previsão de pagamentos — parcelas em status 1 (emissão)
   Lida pelo server.py a cada atualização do painel (pode editar sem reiniciar).

   Período: só parcelas com pagamento previsto de hoje em diante
   (DtPagParc_Proc >= data de hoje no servidor SQL).

   Empresa e obra: os filtros estão COMENTADOS para trazer todas.
   A escolha de empresa/obra é feita no próprio painel.
   ===================================================================== */

SELECT
    p.Empresa_proc                                  AS empresa,
    d.DescEmp_Des                                   AS empresa_desc,
    p.Obra_Proc                                     AS obra,
    d.DescObra_Des                                  AS obra_desc,
    p.Num_Proc                                      AS processo,
    p.NumParc_Proc                                  AS parcela,
    CONVERT(char(10), p.DtVencParc_Proc, 23)        AS vencimento,
    CONVERT(char(10), p.DtPagParc_Proc, 23)         AS pagamento,

    -- Valores por linha de desembolso (rateio por item). Somar TotalLiq_Des
    -- nunca duplica; ValorParc_Proc se repete quando a parcela tem vários itens.
    COALESCE(d.TotalBruto_Des, p.ValorParc_Proc)    AS valor_parcela,
    COALESCE(d.Acrescimo_Des, p.AcrescParc_Proc)    AS acrescimo,
    COALESCE(d.Desconto_Des,  p.descParc_Proc)      AS desconto,
    COALESCE(d.TotalLiq_Des,
             p.ValorParc_Proc + p.AcrescParc_Proc - p.descParc_Proc) AS valor_liquido,
    p.VlDocFisc_Proc                                AS valor_nf,

    p.banContParc_proc                              AS banco,
    p.Conta_Proc                                    AS conta,
    d.DescContaCorr_Des                             AS conta_desc,
    p.TipoChq_Proc                                  AS forma_pag,
    p.ChqNome_Proc                                  AS favorecido,
    p.ConfEmissao_Proc                              AS conf_emissao,
    p.CodigoBarra_Proc                              AS cod_barras,
    p.Grupo_Proc                                    AS grupo_pag,
    p.DocFiscal_Proc                                AS doc_fiscal,
    CONVERT(char(10), p.DtDocFisc_Proc, 23)         AS dt_doc_fiscal,
    CONVERT(char(10), d.PlMes_Des, 23)              AS mes_pl,
    CONVERT(char(10), d.DtGeracao_Des, 23)          AS dt_geracao,

    d.CodForn_Des                                   AS cod_forn,
    d.DescForn_Des                                  AS fornecedor,
    d.ItemProc_Des                                  AS item_cod,
    d.DescItemProc_Des                              AS item_desc,
    d.CompPl_Des                                    AS comp_cod,
    d.DescCompPl_Des                                AS planejamento,
    d.InsumoPl_Des                                  AS insumo_cod,
    d.DescInsPl_Des                                 AS insumo,
    d.CatIns_Des                                    AS cat_cod,
    d.DescCatIns_Des                                AS categoria,
    d.Cap_Des                                       AS cap_cod,
    d.DescCap_Des                                   AS capitulo,
    d.ItemPl_Des                                    AS item_pl,
    d.Aliquota_ProcPar                              AS aliquota,

    p.UsrAprovEmissao_proc                          AS aprovado_por,
    CONVERT(char(10), p.DataAprovEmissao_proc, 23)  AS dt_aprovacao,
    c.Comentario_Com                                AS historico
FROM Parc_Proc p
LEFT JOIN VwDesembolso d
       ON d.Empresa_Des = p.Empresa_proc
      AND d.Obra_Des    = p.Obra_Proc
      AND d.NumProc_Des = p.Num_Proc
      AND d.NumParc_Des = p.NumParc_Proc
OUTER APPLY (
    SELECT TOP (1) cm.Comentario_Com
    FROM Comentario cm
    WHERE cm.Empresa_Com  = p.Empresa_proc
      AND cm.NumDoc_Com   = 'Processo ' + CAST(p.Num_Proc AS varchar(20)) + '-' + p.Obra_Proc
      AND cm.Tipo_Com     = 0
      AND cm.Excluido_Com = 0
) c
WHERE p.StatusParc_proc IN (1)                  -- filtro emissão
  -- AND p.Empresa_proc = 1                     -- filtro de empresa (comentado: traz todas)
  -- AND p.Obra_Proc    = 'EC010'               -- filtro de obra    (comentado: traz todas)
  AND p.DtPagParc_Proc >= CAST(GETDATE() AS date)  -- de hoje em diante (use > para começar amanhã)
ORDER BY p.DtPagParc_Proc, p.Empresa_proc, p.Obra_Proc, p.Num_Proc, p.NumParc_Proc;
