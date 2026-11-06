// Guarda os dados em arquivos JSON numa pasta (usado na prévia do PC).
// Cada nome vira um arquivo. Os de uma conta começam com u-<id>-: u-<id>-dados.json, u-<id>-acesso.json,
// u-<id>-push.json, u-<id>-avisos.json, u-<id>-entrada-<gasto>.json e u-<id>-copia-<dia>.json.
// Os do app todo: conta-<nome>.json, atalho-<hash>.json, convite.json, chaves.json e legado.json.
import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

export function armazemArquivos(pasta) {
  let fila = Promise.resolve();
  return {
    async ler(nome, padrao) {
      try { return JSON.parse(await readFile(path.join(pasta, nome + '.json'), 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return padrao; throw e; }
    },
    // Uma gravação por vez, em arquivo temporário e depois troca: um desligamento no meio não corrompe nada.
    gravar(nome, obj) {
      const passo = fila.then(async () => {
        await mkdir(pasta, { recursive: true });
        const alvo = path.join(pasta, nome + '.json');
        await writeFile(alvo + '.tmp', JSON.stringify(obj, null, 1));
        await rename(alvo + '.tmp', alvo);
      });
      fila = passo.catch(() => {});
      return passo;
    },
    async listar(prefixo) {
      try {
        return (await readdir(pasta)).filter(f => f.startsWith(prefixo) && f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
      } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    },
    async apagar(nome) {
      try { await unlink(path.join(pasta, nome + '.json')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  };
}
