// Prepara a prévia: conta do dono ("moises") com itens de exemplo e senha sorteada (dados/senha-da-previa.txt).
// Uso: node servidor/semear-previa.js [--forcar]   (sem --forcar, não mexe numa conta que já existe;
// com --forcar, troca só os itens de exemplo e mantém a senha)
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dadosIniciais } from './nucleo.js';
import { armazemArquivos } from './armazem-arquivos.js';
import { contaPorNome, criarConta, migrarContaUnica, NOME_DO_DONO } from './contas.js';
import { hojeIso, somarDias } from '../app/regras.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = process.env.CAMARADA_DADOS || path.join(RAIZ, 'dados');
const armazem = armazemArquivos(PASTA);

await migrarContaUnica(armazem);
let conta = await contaPorNome(armazem, NOME_DO_DONO);
if (conta && !process.argv.includes('--forcar')) {
  console.log('A conta', NOME_DO_DONO, 'já existe em', PASTA, '- nada foi alterado. Use --forcar para recomeçar os exemplos.');
  process.exit(0);
}

const dados = dadosIniciais();
const cat = nome => dados.categorias.find(c => c.nome === nome).id;
const hoje = hojeIso(new Date(), 'America/Sao_Paulo');
const t = new Date().toISOString();
const exemplos = [
  ['Pagar conta de luz', 'Contas', 4, 'mensal'],
  ['Pagar internet', 'Contas', 27, 'mensal'],
  ['Renovar a CNH', 'Documentos', 38],
  ['Renovar seguro do carro', 'Documentos', 70, 'anual'],
  ['Consulta no dentista', 'Saúde', 9],
  ['Renovar receita do remédio', 'Saúde', 6],
  ['Comprar filtro da caixa d’água', 'Casa', null],
  ['Chamar eletricista para o chuveiro', 'Casa', 12],
  ['Ligar para o contador', 'Trabalho', 1],
  ['Enviar orçamento ao cliente', 'Trabalho', -1],
  ['Marcar exame de sangue', 'Saúde', 3, null, -1],
  ['Levar papéis ao cartório', 'Documentos', -2, null, -5]
];
dados.itens = exemplos.map(([titulo, categoria, prazo, recorrencia, feito]) => {
  const data_limite = prazo == null ? null : somarDias(hoje, prazo);
  return {
    id: crypto.randomUUID(), titulo, categoria_id: cat(categoria), data_limite, aviso_dias: null,
    recorrencia: recorrencia || null, dia_original: recorrencia ? Number(data_limite.slice(8)) : null,
    concluido_em: feito == null ? null : somarDias(hoje, feito), proximo_id: null, gerado_de: null,
    notas: '', apagado: false, criado_em: t, atualizado_em: t
  };
});

// A senha só é sorteada quando a conta é criada; recomeçar os exemplos não tira ninguém da prévia.
if (!conta) {
  const senha = crypto.randomBytes(6).toString('base64url');
  conta = await criarConta(armazem, { nome: NOME_DO_DONO, senha, dono: true });
  await writeFile(path.join(PASTA, 'senha-da-previa.txt'), senha + '\r\n');
}
await conta.u.gravar('dados', dados);
console.log('Prévia pronta em', PASTA, '- conta', NOME_DO_DONO, '- senha em senha-da-previa.txt');
