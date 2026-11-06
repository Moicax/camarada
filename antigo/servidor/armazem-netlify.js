// Guarda os dados no Netlify Blobs (usado na nuvem). Mesmo formato do armazem-arquivos.
import { getStore } from '@netlify/blobs';

export function armazemNetlify() {
  const loja = getStore({ name: 'camarada', consistency: 'strong' });
  return {
    async ler(nome, padrao) {
      const valor = await loja.get(nome, { type: 'json' });
      return valor ?? padrao;
    },
    async gravar(nome, obj) {
      await loja.setJSON(nome, obj);
    },
    // Nomes que começam com o prefixo (caixa de entrada do Atalhos, cópias diárias).
    async listar(prefixo) {
      const { blobs } = await loja.list({ prefix: prefixo });
      return blobs.map(b => b.key).sort();
    },
    async apagar(nome) {
      await loja.delete(nome);
    }
  };
}
