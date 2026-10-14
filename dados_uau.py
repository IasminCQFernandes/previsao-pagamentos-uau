"""
Leitura das parcelas no banco do UAU pelo "ODBC Driver 17 for SQL Server".

A configuração vem de variáveis de ambiente (DB_SERVER, DB_NAME, ...) ou, se
não houver, da seção [banco] do .streamlit/secrets.toml.
"""
from __future__ import annotations

import datetime as dt
import decimal
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import streamlit as st

BASE = Path(__file__).resolve().parent
SQL_FILE = BASE / "sql" / "previsao_pagamentos.sql"
EXEMPLO = BASE / "dados" / "exemplo.json"
FUSO = ZoneInfo("America/Sao_Paulo")


def segredo(secao: str, chave: str, env: str, padrao: str = "") -> str:
    """Variável de ambiente primeiro (Docker/Render); depois st.secrets."""
    valor = os.getenv(env)
    if valor is not None:
        return valor
    try:
        return str(st.secrets[secao][chave])
    except Exception:  # noqa: BLE001 — sem secrets.toml ou sem a chave
        return padrao


def _sim(valor: str) -> bool:
    return str(valor).strip().lower() in ("1", "sim", "yes", "true")


def config() -> dict:
    return {
        "driver": segredo("banco", "driver", "DB_DRIVER", "ODBC Driver 17 for SQL Server"),
        "server": segredo("banco", "server", "DB_SERVER"),
        "database": segredo("banco", "database", "DB_NAME"),
        "user": segredo("banco", "user", "DB_USER"),
        "password": segredo("banco", "password", "DB_PASSWORD"),
        "trusted": _sim(segredo("banco", "trusted", "DB_TRUSTED", "nao")),
        "encrypt": _sim(segredo("banco", "encrypt", "DB_ENCRYPT", "nao")),
        "timeout": int(segredo("banco", "timeout", "DB_TIMEOUT", "60") or 60),
        "demo": _sim(segredo("app", "modo_demo", "MODO_DEMO", "nao")),
    }


def modo_demo() -> bool:
    cfg = config()
    return cfg["demo"] or not cfg["server"]


def _conn_string(cfg: dict) -> str:
    partes = [f"DRIVER={{{cfg['driver']}}}", f"SERVER={cfg['server']}", f"DATABASE={cfg['database']}"]
    if cfg["trusted"]:
        partes.append("Trusted_Connection=yes")
    else:
        partes += [f"UID={cfg['user']}", f"PWD={cfg['password']}"]
    partes += ["Encrypt=yes" if cfg["encrypt"] else "Encrypt=no", "TrustServerCertificate=yes", "ApplicationIntent=ReadOnly"]
    return ";".join(partes) + ";"


def _para_json(v):
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()[:10]
    if isinstance(v, str):
        return v.strip()
    return v


def hoje() -> dt.date:
    return dt.datetime.now(FUSO).date()


def _consultar_banco(cfg: dict) -> list[dict]:
    import pyodbc  # só é necessário fora do modo demonstração

    sql = SQL_FILE.read_text(encoding="utf-8")
    with pyodbc.connect(_conn_string(cfg), timeout=15, autocommit=True) as cn:
        cn.timeout = cfg["timeout"]
        cur = cn.cursor()
        cur.execute(sql)
        colunas = [c[0] for c in cur.description]
        return [{c: _para_json(v) for c, v in zip(colunas, linha)} for linha in cur.fetchall()]


def _exemplo() -> list[dict]:
    """Mesmo critério do SQL: pagamento de hoje em diante."""
    corte = hoje().isoformat()
    linhas = json.loads(EXEMPLO.read_text(encoding="utf-8"))
    return [r for r in linhas if r["pagamento"] >= corte]


def _ttl() -> int:
    try:
        return int(segredo("app", "cache_minutos", "CACHE_MINUTOS", "10")) * 60
    except ValueError:
        return 600


@st.cache_data(ttl=_ttl(), show_spinner="Consultando o UAU…")
def carregar_parcelas() -> dict:
    """Roda a consulta (ou lê o exemplo) e devolve o pacote que o painel espera."""
    cfg = config()
    demo = cfg["demo"] or not cfg["server"]
    linhas = _exemplo() if demo else _consultar_banco(cfg)
    agora = dt.datetime.now(FUSO)
    return {
        "linhas": linhas,
        "total": len(linhas),
        "hoje": agora.date().isoformat(),
        "demo": demo,
        "gerado_em": agora.isoformat(timespec="seconds"),
    }
