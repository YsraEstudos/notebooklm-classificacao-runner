# NotebookLM Classificacao Runner

Userscript para Tampermonkey que recebe um JSON com itens de entrada, envia ao NotebookLM em lotes de 3, espera 90 segundos por lote, captura diretamente as respostas da IA no DOM e mantém um histórico no painel lateral.

## Formatos aceitos

- `["texto 1", "texto 2"]`
- `[{"text":"texto 1"},{"text":"texto 2"}]`
- Também aceito: objetos com `message`, `prompt`, `content`, `value` ou `title`

## Fluxo

1. Cole o JSON no painel.
2. Clique em `Carregar JSON` ou `Start`.
3. O script envia os itens em grupos de 3.
4. Após 90 segundos, ele captura apenas a nova resposta da IA e guarda no histórico.
5. `Copiar tudo` revarre o chat, reconcilia o histórico e copia apenas respostas da IA.
6. `Esc` pausa a execução e recolhe o painel.

## Desenvolvimento

```bash
npm install
npm run build
```

Ou execute `build_and_copy.bat` para compilar e copiar o userscript final.

## Testes

```bash
npm test
```

Os testes cobrem:

- descoberta do composer correto
- envio em lote
- captura assistant-only no transcript
- reconciliação do histórico antes da cópia
- launcher recolhido

Para validar ao vivo com Playwright, use uma URL explícita de notebook e uma sessão autenticada exportada para `storageState`:

```bash
$env:NOTEBOOKLM_E2E_URL="https://notebooklm.google.com/notebook/SEU-NOTEBOOK"
$env:NOTEBOOKLM_STORAGE_STATE="C:\caminho\para\notebooklm-storage-state.json"
npm run test:e2e
```

A suíte `test:e2e` é opt-in e não roda dentro do `npm test`.

Quando alterar seletores do NotebookLM, valide também o notebook de exemplo vivo:
https://notebooklm.google.com/notebook/03d58f37-56b7-4576-9e34-b6010fc553e9
