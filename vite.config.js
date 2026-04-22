import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const repoOwner = 'YsraEstudos';
const repoName = 'notebooklm-classificacao-runner';
const baseRawUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main`;

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: 'NotebookLM Classificacao Runner',
        namespace: 'npm/vite-plugin-monkey',
        match: ['https://notebooklm.google.com/*'],
        grant: ['GM_getValue', 'GM_setValue', 'GM_setClipboard'],
        homepageURL: `https://github.com/${repoOwner}/${repoName}`,
        supportURL: `https://github.com/${repoOwner}/${repoName}/issues`,
        updateURL: `${baseRawUrl}/dist/notebooklm-classificacao-runner.meta.js`,
        downloadURL: `${baseRawUrl}/dist/notebooklm-classificacao-runner.user.js`,
      },
      build: {
        metaFileName: true,
        externalGlobals: {},
      },
    }),
  ],
});
