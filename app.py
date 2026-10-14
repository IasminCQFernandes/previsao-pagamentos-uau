"""
Painel de Previsão de Pagamentos — versão Streamlit

Rodar:  streamlit run app.py
"""
import hmac
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

from dados_uau import segredo, carregar_parcelas

BASE = Path(__file__).resolve().parent

st.set_page_config(
    page_title="Previsão de pagamentos",
    page_icon="📅",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Deixa a página só com o painel: sem cabeçalho, rodapé e margens do Streamlit
st.markdown(
    """
    <style>
      header[data-testid="stHeader"], footer, #MainMenu, [data-testid="stToolbar"] { display: none !important; }
      .block-container, [data-testid="stMainBlockContainer"] { padding: 1.25rem 1.5rem 1rem !important; max-width: 1380px; }
      iframe[title*="painel_pagamentos"] { border: 0; width: 100%; }
      [data-testid="stElementContainer"]:has(iframe[title*="painel_pagamentos"]) { margin-bottom: 0; }
    </style>
    """,
    unsafe_allow_html=True,
)


# ---------- Senha de acesso (ligada quando [app] senha estiver configurada) ----------
def autorizado() -> bool:
    senha = segredo("app", "senha", "APP_SENHA")
    if not senha or st.session_state.get("autorizado"):
        return True
    _, meio, _ = st.columns([1, 1.2, 1])
    with meio:
        st.markdown("### Previsão de pagamentos")
        digitada = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", use_container_width=True) or digitada:
            if hmac.compare_digest(digitada.encode(), senha.encode()):
                st.session_state["autorizado"] = True
                st.rerun()
            elif digitada:
                st.error("Senha incorreta.")
    return False


if not autorizado():
    st.stop()

# ---------- Dados ----------
try:
    dados = carregar_parcelas()
except Exception as e:  # noqa: BLE001 — o painel mostra o motivo no topo
    dados = {"erro": f"{type(e).__name__}: {e}"}

# ---------- Painel (a mesma interface HTML/CSS/JS, como componente) ----------
painel = components.declare_component("painel_pagamentos", path=str(BASE / "componente"))
pedido = painel(dados=dados, key="painel", default=None)

# Botão "Atualizar" do painel: limpa o cache e consulta de novo
if isinstance(pedido, dict) and pedido.get("acao") == "atualizar" and pedido.get("t") != st.session_state.get("ultimo_pedido"):
    st.session_state["ultimo_pedido"] = pedido.get("t")
    carregar_parcelas.clear()
    st.rerun()
