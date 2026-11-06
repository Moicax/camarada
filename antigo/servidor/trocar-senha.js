// Troca a senha de uma conta da prévia. Quem já está dentro continua dentro.
// Uso: node servidor/trocar-senha.js NOME NOVA_SENHA
import { writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSenha } from './nucleo.js';
import { armazemArquivos } from './armazem-arquivos.js';
import { contaPorNome, migrarContaUnica, NOME_DO_DONO } from './contas.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = process.env.CAMARADA_DADOS || path.join(RAIZ, 'dados');
const [nome, nova = ''] = process.argv.slice(2);

if (!nome || nova.length < 6) {
  console.error('Uso: node servidor/trocar-senha.js NOME NOVA_SENHA   (senha com pelo menos 6 caracteres)');
  process.exit(1);
}

const armazem = armazemArquivos(PASTA);
await migrarContaUnica(armazem);
const conta = await contaPorNome(armazem, nome);
if (!conta) {
  console.error('Não existe conta com o nome', nome);
  process.exit(1);
}
conta.acesso.senha = await hashSenha(nova);
delete conta.acesso.erros;
await conta.u.gravar('acesso', conta.acesso);

// Na prévia, o arquivo de lembrete acompanha a senha do dono.
const lembrete = path.join(PASTA, 'senha-da-previa.txt');
if (conta.acesso.login === NOME_DO_DONO && await access(lembrete).then(() => true, () => false)) await writeFile(lembrete, nova + '\r\n');
console.log('Senha de', conta.acesso.login, 'trocada.');
