# NotebookLM Classificacao Runner

Userscript para Tampermonkey que recebe um JSON com itens de entrada, envia ao NotebookLM em lotes de 3, espera 90 segundos por lote, captura a resposta nova e mantém um histórico no painel lateral.

## Formatos aceitos

- `["texto 1", "texto 2"]`
- `[{"text":"texto 1"},{"text":"texto 2"}]`
- Também aceito: objetos com `message`, `prompt`, `content`, `value` ou `title`

## Fluxo

1. Cole o JSON no painel.
2. Clique em `Carregar JSON` ou `Start`.
3. O script envia os itens em grupos de 3.
4. Após 90 segundos, ele captura a nova resposta e guarda no histórico.
5. `Copiar tudo` copia o histórico de respostas em uma única vez.
6. `Esc` pausa a execução e recolhe o painel.

## Desenvolvimento

```bash
npm install
npm run build
```

Ou execute `build_and_copy.bat` para compilar e copiar o userscript final.
