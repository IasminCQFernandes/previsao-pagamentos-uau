# Painel de Previsão de Pagamentos — versão Streamlit

O mesmo painel da versão HTML (mesmo layout, filtros e funções), empacotado
como app Streamlit para hospedar. O Python consulta o UAU pelo
**ODBC Driver 17 for SQL Server** e entrega os dados para a interface, que roda
como um componente dentro da página.

## Estrutura

```
previsao-pagamentos-streamlit/
├── app.py                         página Streamlit (senha, cache, botão Atualizar)
├── dados_uau.py                   conexão ODBC 17 e consulta
├── componente/                    a interface (index.html, style.css, app.js)
├── sql/previsao_pagamentos.sql    a consulta (pagamento de hoje em diante;
│                                   filtros de empresa/obra comentados)
├── dados/exemplo.json             parcelas de exemplo para o modo demonstração
├── .streamlit/config.toml         tema e opções do Streamlit
├── .streamlit/secrets.toml.exemplo
├── Dockerfile                     imagem com o driver ODBC 17 instalado
└── requirements.txt
```

## Rodar na sua máquina

1. Tenha o **ODBC Driver 17 for SQL Server** instalado.
2. `pip install -r requirements.txt`
3. Copie `.streamlit/secrets.toml.exemplo` para `.streamlit/secrets.toml` e
   preencha a seção `[banco]`.
4. `streamlit run app.py` e abra http://localhost:8501

Sem servidor configurado (ou com `modo_demo = "sim"`), o app mostra as
parcelas de `dados/exemplo.json`.

## Configuração

Tudo pode vir do `secrets.toml` **ou** de variáveis de ambiente (que têm
prioridade — é o jeito usual em Docker e no Render):

| secrets.toml        | variável de ambiente | para quê                                   |
|---------------------|----------------------|--------------------------------------------|
| `[banco] driver`    | `DB_DRIVER`          | padrão: ODBC Driver 17 for SQL Server       |
| `[banco] server`    | `DB_SERVER`          | servidor do UAU (`host,porta` ou `host\instância`) |
| `[banco] database`  | `DB_NAME`            | banco do UAU                               |
| `[banco] user`      | `DB_USER`            | usuário (de preferência só leitura)        |
| `[banco] password`  | `DB_PASSWORD`        | senha                                      |
| `[banco] trusted`   | `DB_TRUSTED`         | `sim` = login do Windows                   |
| `[banco] encrypt`   | `DB_ENCRYPT`         | `sim` = conexão criptografada              |
| `[banco] timeout`   | `DB_TIMEOUT`         | segundos máximos da consulta               |
| `[app] senha`       | `APP_SENHA`          | pede senha ao abrir o painel               |
| `[app] cache_minutos` | `CACHE_MINUTOS`    | por quanto tempo a consulta é reaproveitada (padrão 10) |
| `[app] modo_demo`   | `MODO_DEMO`          | `sim` = usa os dados de exemplo            |

## Como os dados se atualizam

- A consulta roda na primeira abertura e o resultado fica em cache por
  `cache_minutos` (10 por padrão), compartilhado entre quem estiver usando.
- O botão **Atualizar** do painel limpa o cache e consulta o banco na hora.
- O SQL é lido do arquivo a cada consulta: dá para ajustar sem reiniciar.

## Hospedar

### Num servidor da empresa (mais simples)

Numa máquina da rede que já enxerga o SQL Server do UAU:

```
pip install -r requirements.txt
streamlit run app.py --server.port 8501 --server.address 0.0.0.0
```

O painel fica em `http://<máquina>:8501` para quem estiver na rede.

### Com Docker (Render, VPS, servidor Linux)

```
docker build -t previsao-pagamentos .
docker run -p 8501:8501 \
  -e DB_SERVER="host,1433" -e DB_NAME="UAU" \
  -e DB_USER="leitura" -e DB_PASSWORD="..." \
  -e APP_SENHA="..." previsao-pagamentos
```

No Render: crie um Web Service a partir do repositório (ele detecta o
Dockerfile) e coloque as variáveis acima em *Environment*. O Render define
`PORT` sozinho.

**Atenção:** o servidor que hospeda o app precisa alcançar o SQL Server do UAU.
Se o banco só existe na rede interna, uma hospedagem externa (Render, nuvem)
não vai conseguir conectar sem uma VPN ou sem liberar a porta do SQL para os
IPs de saída do serviço. Nesse caso, hospedar num servidor da empresa é o
caminho mais seguro.

## Segurança

- Defina `APP_SENHA` sempre que o painel ficar acessível fora da sua máquina:
  ele mostra valores, fornecedores e contas.
- Use um usuário do SQL Server só com leitura nas tabelas/views da consulta.
- Não versione `.streamlit/secrets.toml` (já está no `.gitignore`).
